# LifeShifter 実装計画

## Context

`CODEX_LifeShifter_Implementation_Brief.md` にある要件を実装可能な工程に落とす。作るのはライフログ SaaS ではなく、**Timetracker を記録エンジンとして再利用する超低摩擦の操作 UI（Android Widget / Mac Widget）**。成功条件は機能量ではなく「数週間〜数ヶ月、活動切替を苦痛なく継続できること」なので、全工程を **tap→視覚反応の速さ** と **摩擦の少なさ** で評価する。

### 環境の実測結果（計画の前提）

| 項目 | 状態 | 影響 |
|---|---|---|
| Android SDK / Studio / gradle | **無し** | 工程 1 でセットアップが必要 |
| JDK | **11 のみ**（Corretto 11） | AGP 8 系は 17+ 必須 → JDK 17 導入 |
| Xcode / Swift | 26.3 / 6.2.4、macOS 26.3 | Mac 側は即着手可能 |
| Timetracker Mac アプリ | 未インストール | プロトコル調査は **Web 版**から行う |
| git | 未初期化 | 工程 0 で `git init` |
| ffmpeg | 無し | tap→視覚の実測に必要 → 導入 |
| ActivityWatch | 未インストール | Phase 3 まで不要 |

### 流用できる既存資産

`../勤怠管理` に **macOS 常駐アプリの完成したビルドパターン**がある。Phase 2 でそのまま踏襲する。

- `../勤怠管理/Package.swift` — SwiftPM 単体 executableTarget
- `../勤怠管理/Sources/AttendanceApp/main.swift:4` — `NSStatusItem` + `NSPopover` + `NSApp.setActivationPolicy(.accessory)` のメニューバー常駐パターン
- `../勤怠管理/Sources/AttendanceApp/main.swift:47` `AttendanceStore` — 「進行中の開始時刻を `UserDefaults` に永続化し、確定時にログへ追記」という構造。LifeShifter の `current_state` + イベントログとほぼ同型
- `../勤怠管理/run.sh` — `swift build -c release` → 無署名 `.app` 手組み → launchd `bootstrap` で自動起動
- `../勤怠管理/AppInfo.plist` — `LSUIElement: true`

### ユーザー確定事項

1. **Android 先行**（ブリーフ §16 通り）
2. 記録エンジンは **Adapter 差し替え可能にして着手** — Phase 0 の結果を待たずに UI 実装へ進む
3. Timetracker は **Web 版にログイン可能** → HAR 取得ルートが使える
4. Mac は **WidgetKit デスクトップウィジェット**
5. Android 環境は **cmdline-tools + CLI ビルド**
6. モード名・順序は**調整したい** → 設定ファイル駆動にし、確定は工程 3 の着手前

---

## 設計上の中核判断

### A. 遅延の主因はプロセスのコールドスタート（最重要）

Glance の `ActionCallback` の経路は次の通り。

```
Widget tap → PendingIntent broadcast → アプリプロセス起動 → onAction()
          → 状態書き込み → 再コンポーズ → RemoteViews 再送 → ランチャー再描画
```

プロセスが死んでいると**ここにコールドスタートが挟まる**。これが公式 Timetracker Widget が「もっさり」する最有力の原因（§26-8 の未確認事項に対する仮説）であり、Capacitor 製ならさらに悪化する。つまり **Glance を使うか否かより、プロセスを温存するかどうかが 100ms 級の成否を決める**。

対策を 3 段構えで入れる。

1. **低重要度の前景サービス + 常駐通知**を持つ。プロセスが常に温まるので broadcast がウォームディスパッチになる。副作用として通知のアクションボタンが**ロック画面から使える 2 番目の切替面**になり、ホーム画面へ戻る必要がなくなる（Widget より摩擦が低い場面が多い）
2. **書き込みを同期にする** — 状態は `SharedPreferences.commit()` 相当の同期書き込みで確定させ、DataStore の非同期完了を待たずに `update()` を呼ぶ
3. **リリースビルドで計測・運用する** — debuggable ビルドは JIT/アサーション分だけ遅い。体感評価を debug ビルドで行わない

そのうえで **Glance で実装 → 即計測 → 目標未達なら手書き RemoteViews + `partiallyUpdateAppWidget` に切り替える**（フォールバック経路を工程 4 に明記）。ブリーフ §5.1 の指定は Glance なので、まず Glance で試すのが順序として正しい。

### B. 記録エンジンを差し替え可能にする

§9.4 の pending queue は**どちらの記録先を選んでも必要**なので、ローカル追記ログは追加コストではなく必然。これを記録エンジンそのものに昇格させる。

```
core (pure Kotlin / 端末非依存)
  ModeCatalog        モード定義（shared/modes.json 由来）
  SwitchStateMachine current_state + revision + 巻き戻し防止
  EventLog           append-only JSONL（= pending queue = ローカル記録）
  interface RecordBackend { listActivities / getCurrent / switch / getEntries / observe }
        ├─ LocalRecordBackend        …EventLog のみ。常に動く
        └─ TimetrackerBackend        …Phase 0 で確定した契約を実装
```

`core` は Android 依存ゼロにするので、状態機械と巻き戻し防止ロジックが JVM 上の高速ユニットテストで検証できる。§17 の「独自 SaaS backend を作らない」には触れない — サーバーではなく端末内の追記ファイル1本。

### C. モード定義は単一ソース

`shared/modes.json` に `{id, label, icon, row, col}` を置き、Android / Mac / 集計スクリプトが同じものを読む。位置は運動記憶の根幹（§2.2）なので **`row`/`col` を固定データとして持ち、コードから座標を消す**。名前や順序の変更が1ファイルの編集で済む。

---

## リポジトリ構成

現ディレクトリ `/Users/sota/projects/apps/日々のFB管理APP` をリポジトリルートにする。

```
日々のFB管理APP/
├── IMPLEMENTATION_PLAN.md        ★この計画書そのもの（プロジェクト直下に配置）
├── README.md
├── AGENTS.md                     ブリーフ §11/§17/§20 を圧縮した不変則
├── .gitignore                    local/ *.har secrets* .build/ *.keystore
├── CODEX_LifeShifter_Implementation_Brief.md   （既存・出典として残す）
├── docs/
│   ├── timetracker-protocol.md   工程 2 の成果物
│   ├── architecture.md
│   └── measurements.md           tap→視覚の実測値ログ
├── shared/
│   └── modes.json                モード定義の単一ソース
├── local/                        ★git 管理外。HAR・トークン・計測動画
├── tools/timetracker-probe/      Node ESM・依存ゼロ
│   ├── har-analyze.mjs
│   ├── probe.mjs
│   └── README.md
├── android/
│   ├── settings.gradle.kts / gradle/wrapper/
│   ├── core/                     pure Kotlin（テスト対象）
│   │   └── src/main/kotlin/.../{ModeCatalog,SwitchStateMachine,EventLog,RecordBackend}.kt
│   │   └── src/test/kotlin/...   JUnit
│   └── app/
│       └── src/main/kotlin/.../
│           ├── widget/{LifeShifterWidget,SwitchModeAction,WidgetLayout}.kt
│           ├── state/{CurrentStateStore,PendingSyncStore,SecureTokenStore}.kt
│           ├── service/{KeepWarmService,NotificationSwitcher}.kt
│           ├── backend/{LocalRecordBackend,TimetrackerBackend,TimetrackerModels}.kt
│           ├── sync/SyncWorker.kt
│           └── settings/SettingsActivity.kt
├── macos/                        Phase 2。Xcode プロジェクト
└── scripts/
    ├── measure-tap-latency.sh    screenrecord → フレーム差分
    └── daily-aggregate.mjs       Phase 3
```

---

## 工程

### 工程 0 — リポジトリ骨組み（依存なし・すぐ終わる）

- **最初にこの計画書を `日々のFB管理APP/IMPLEMENTATION_PLAN.md` として配置する**（プロジェクト直下。以降の更新はこのファイルを正とする）
- `git init`、`.gitignore`（**`local/`・`*.har`・`secrets*` を最初に入れる**。HAR にはセッション Cookie が入るので commit 事故を先に潰す）
- `AGENTS.md` — 確認ダイアログ禁止 / 切替後にアプリを開かない / ネットワーク完了を UI が待たない / エンドポイントを推測しない / モードを増やさない、を短く列挙
- `shared/modes.json` — 暫定で §2.2 の 8 モードを 2×4 で置く。**工程 3 着手前に確定させる**
- `docs/architecture.md` — 上記 B の層構造を記述

### 工程 1 — Android ツールチェーン（工程 2 と並行実行可）

```sh
brew install openjdk@17 android-commandlinetools ffmpeg
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
sdkmanager --licenses
```

- `local.properties` に `sdk.dir`、`JAVA_HOME` を 17 に固定（`android/gradle.properties` の `org.gradle.java.home` で明示してシェル環境に依存させない）
- CMF Phone 2 Pro: 開発者オプション → USB デバッグ ON → `adb devices` で認証
- **Nothing OS のバッテリー最適化からアプリを除外**する（常駐サービスが殺されると判断 A の効果が消える）。手順を `README.md` に記録
- `settings.gradle.kts` + `core`/`app` の2モジュール雛形、`minSdk 31 / targetSdk 36`、Kotlin 2.x、Glance 1.1 系。バージョンは着手時に最新安定版を確認して決める
- `./gradlew :app:assembleRelease` → `adb install` で**空 Widget が置ける**ところまで通す

**完了条件**: ホーム画面に「Hello」だけの LifeShifter Widget を配置できる。

### 工程 2 — Phase 0 プロトコル調査（工程 1 と並行実行可）

ここは**ユーザー操作が必須**。エンドポイントを推測して実装に埋めることは絶対にしない（§7 禁止事項）。

**ユーザーにお願いする採取手順**（`tools/timetracker-probe/README.md` に手順書として置く）

1. Chrome で Timetracker Web 版にログイン
2. DevTools → Network → **Preserve log を ON**、フィルタなし
3. 次を順に実行: `/track` をリロード → 研究へ切替 → ジムへ切替 → 研究へ戻す → 履歴画面を開く
4. Network パネル右クリック → **Save all as HAR with content** → `local/har/` に保存
5. Application → Cookies / Local Storage の**キー名だけ**をメモ（値は不要）

**私が作るもの**

- `har-analyze.mjs` — HAR を読み、同一オリジンの XHR/fetch と WebSocket を抽出。method / path / status / 認証方式 / リクエスト body のキー構造 / レスポンスの形（キーと型）を表にする。**値は既定で伏せる**（`Bearer <redacted len=…>`）。出力から `docs/timetracker-protocol.md` の初稿を生成
- `probe.mjs` — `list` / `current` / `switch <mode>` / `watch`（WS）を実行する最小 CLI。認証情報は `local/secrets.json`（git 管理外）から読む

**ここで必ず確認する分岐点**

| 確認事項 | 影響先 |
|---|---|
| switch に**過去 timestamp を渡せるか** | §9.4 のオフライン完全リプレイ可否。不可なら「復帰時に current mode だけ再送、欠損区間の復元は後回し」で確定 |
| CSRF トークン / Origin 制限 / rate limit の有無 | `TimetrackerBackend` の必要ヘッダ |
| トークンの寿命と更新方法 | 再認証 UI の要否 |
| 競合時のサーバ挙動（別デバイスから同時 switch） | §13 の reconcile 方針 |

**完了条件**: `probe switch` が安定して成功し、Timetracker Web の履歴に正しい区間として現れる。結果が `docs/timetracker-protocol.md` に記録されている。

**未達だった場合**: `LocalRecordBackend` のまま工程 3 へ進む（判断 B により手戻りなし）。`docs/timetracker-protocol.md` に「何が壁だったか」を残す。

### 工程 3 — Phase 1 Android MVP

着手前に **`shared/modes.json` の最終確定**（名前・順序・固定座標）。

1. **`core` を先に書く**（端末不要、テストしながら進む）
   - `SwitchStateMachine.switchTo(modeId, now)` → 直前区間を閉じて新区間を開き `revision++`
   - `reconcile(serverState)` — `revision`/`updatedAt` を比較し、**古いレスポンスで新しいローカル状態を巻き戻さない**（§13/§18）
   - `EventLog` — JSONL 追記。`{command_id, device_id, mode_id, client_ts, revision, status, retry_count, synced_at}`
   - `LocalRecordBackend` を `RecordBackend` の完全実装として通す
   - JUnit: 状態遷移 / キュー順序 / 古いレスポンス破棄 / モード写像
2. **Widget**（Glance）
   - `modes.json` の `row`/`col` から 2×4 グリッドを組む。**位置はデータ由来、コードに座標を書かない**
   - 上段に `NOW: 研究 / started 14:37 / 1h 24m`（§12 のとおり秒更新はしない。分単位で十分）
   - 現在モードは**色だけでなく**枠線 + ウェイト + アイコンでも示す（§11）
   - `SwitchModeAction : ActionCallback` — ① 同期で状態確定 → ② `update()` で即再描画 → ③ キュー追記 → ④ WorkManager 起動。**①②で UI は完了している**
   - 確認ダイアログなし、Activity 起動なし、アニメーションなし
3. **プロセス温存**（判断 A）
   - `KeepWarmService` — `IMPORTANCE_LOW` の常駐通知。表示は `🔬 研究 1:24`
   - 通知アクションに主要モードを並べ、**ロック画面から切替できる 2 番目の面**にする
4. **同期と秘匿**
   - `SyncWorker` — `NetworkType.CONNECTED` + 指数バックオフ。UI のクリティカルパスに置かない
   - トークンは **Android Keystore の AES-GCM 鍵で暗号化して DataStore に格納**（非推奨化した `security-crypto` に依存しない）
   - 失敗表示は Widget 隅の小さな pending/error インジケータのみ。巨大ダイアログは出さない（§18）
5. **`SettingsActivity`**（最小）
   - バックエンド選択（Local / Timetracker）、認証情報入力、**モード → Timetracker activity ID の写像**、接続テスト

**非目標（作らない）**: 統計、履歴エディタ、グラフ、Goals、テーマ設定。

### 工程 4 — 実機受け入れ計測

体感を主観で判定しない。`scripts/measure-tap-latency.sh` で数値化する。

```
adb shell screenrecord --time-limit 20 /sdcard/t.mp4   （高フレームレート）
→ adb pull → ffmpeg でフレーム分解
→ タップ対象ボタン領域の画素差分が出た最初のフレーム番号 − タップフレーム番号
→ フレーム数 × (1/fps) = tap→視覚 の実測値
```

§19 の条件を全て回す: cold widget tap / 連続切替 / アプリ kill 後 / 画面ロック解除後 / Wi-Fi 低速 / Wi-Fi OFF / モバイル回線 / バッテリー最適化 ON・OFF。結果を `docs/measurements.md` に残す。

**受け入れ基準**（§16 Phase 1）

- Widget のボタン1回で切替が完了する
- Timetracker アプリが前面でなくても動く
- サーバ応答前に選択状態が変わって見える
- 「押したのに変わらない」と感じる状態が通常運用で発生しない
- アプリを開く必要がない
- Timetracker 履歴に正しく反映される（Timetracker バックエンド時）
- ネットワーク断で UI が固まらない

**目標未達時のフォールバック**: Glance を捨て、XML レイアウト + 手書き `RemoteViews` + `partiallyUpdateAppWidget` に置き換える。`core` と状態層は無変更で済むので影響は `widget/` に限定される。

**この工程を通過するまで Phase 2 に進まない。** 公式 Widget より体感が良くならないなら自作の意味がない（§20）。

### 工程 5 — Phase 2 Mac（WidgetKit）

**先に 30 分のスパイクで署名可否を確認する。** WidgetKit ウィジェットは App Extension なので、`macos/` は SwiftPM ではなく Xcode プロジェクトになり、共有状態には App Group が必要。**App Group エンタイトルメントは無料の個人 Apple ID チームでは発行できない**ため、有料 Developer Program が無いとここで詰まる可能性がある。

スパイクの内容: 最小のウィジェット拡張を作り、App Group 付きで実機ロードできるか確認する。

- **通れば** ブリーフ §10 通りに実装 — `LifeShifterWidget` + `SwitchActivityIntent`（App Intents）+ `SharedStateStore`（App Group）+ `MenuBarExtra`
- **通らなければ** 常時最前面のボーダレス `NSPanel`（`.floating` レベル・全 Space 参加）+ メニューバーに切り替える。`../勤怠管理/run.sh` の無署名 `.app` + launchd パターンがそのまま使え、署名もエンタイトルメントも不要。押した瞬間の再描画保証は WidgetKit より強い

いずれの経路でも共通で作るもの:

- Android と**同一の固定配置**（`shared/modes.json` を Swift 側でも読む）
- 常駐ヘルパー（`../勤怠管理/main.swift:9` と同じ `LSUIElement` + `.accessory` 構成）が WebSocket を保持し、状態変化時に `WidgetCenter.shared.reloadTimelines(ofKind:)`
- メニューバーに `🔬 研究 1:24` を常時表示
- トークンは Keychain

**受け入れ基準**: デスクトップから1クリックで切替 / アプリウィンドウを開かない / Android の切替が Mac に反映される / Mac の切替が Android に反映される。

### 工程 6 — Phase 3 日次 FB 自動化

Phase 1/2 の blocker にしない（§17）。着手時に**既存の日次 FB / Google Sheets のスキーマを先に確認する**（現状このリポジトリには無いので、シートの実物を見せてもらう工程が入る）。

- `scripts/daily-aggregate.mjs` — Timetracker 履歴（または `EventLog`）を日単位でモード別合計に畳む
- 既存の Google Form を自動操作せず、**回答先シート / 集計シートを互換レイヤとして扱う**（§14）
- ActivityWatch は未インストール。導入後に「人間の意図（モード）」と「PC の実コンテキスト」を**別の列として並置**する。アプリ名から意図を自動推定しない（§15）
- 任意で LLM による日次サマリ

---

## 検証方法

| 層 | 方法 |
|---|---|
| `core` ロジック | `./gradlew :core:test` — 状態遷移、キュー、古いレスポンス破棄、モード写像 |
| Timetracker 契約 | `node tools/timetracker-probe/probe.mjs list / current / switch <mode> / watch` → Web 版の履歴で目視確認 |
| Android 統合 | `./gradlew :app:assembleRelease && adb install -r` → 実機で §19 の条件行列を実行 |
| tap→視覚 | `scripts/measure-tap-latency.sh` の実測値を `docs/measurements.md` に記録。主観判定しない |
| Mac | ヘルパー起動 → Android で切替 → Mac 側の反映を確認、逆方向も確認、スリープ復帰と回線再接続も確認 |
| 秘匿情報 | `git status` / `git log -p` に HAR・トークンが混入していないことを工程ごとに確認 |

---

## 明示しておくリスク

1. **Timetracker の公開 API は存在が未確認**（§26）。非公開 API に依存する場合、仕様変更で壊れる可能性を `README.md` に明記し、利用はユーザー自身のアカウントに限定する。判断 B により壊れてもローカル記録に退避できる
2. **App Group エンタイトルメントが Mac WidgetKit の実質的な前提**。有料 Developer Program の有無で工程 5 の経路が変わる
3. **Nothing OS のバッテリー管理**が常駐サービスを殺すと判断 A の効果が失われ、体感が公式 Widget と同程度に戻る恐れがある。工程 4 でバッテリー最適化 ON/OFF の両方を計測して影響を数値で確認する
4. **`shared/modes.json` の確定が工程 3 の前提**。固定座標は運動記憶の根幹なので、後から順序を変えると学習がリセットされる
