# LifeShifter 統合実装計画

更新日: 2026-08-17

状態: Mac MVP 実装済み・9分類への移行済み

正本: この文書のみ

実装状況（2026-08-17）:

- Phase 0: 公開WebクライアントとAPI `OPTIONS` から通信契約を確認済み
- Phase 1: Mac常駐MVP、公式Web画面でのGoogle認証、権限600でのtoken保存、3×3固定パレット、30秒同期、LaunchAgentを実装済み
- 分類移行: 研究、TOEIC、就活、仕事、運動、対人・私用、娯楽、生活、睡眠の9分類を作成し、旧分類は履歴を保持して削除済み
- Phase 2候補: 継続運用で必要になった場合のみ障害系とclick-to-visual-feedbackを追加測定

## 1. 結論

LifeShifter は新しいライフログサービスではない。**Timetracker を記録元として使い続け、Mac に不足している低摩擦の操作 UI だけを追加する。**

追加調査により、スマートフォンでは Timetracker アプリを起動しておけば既存 Widget でも許容できる応答速度で記録できると分かった。このため、以前の計画にあった Android 自作 Widget は実装しない。

| 対象 | 方針 |
|---|---|
| スマートフォン | 既存の Timetracker アプリと Widget をそのまま使う |
| Mac | 固定配置の活動パレットとメニューバー UI を実装する |
| 記録・履歴・同期 | Timetracker を唯一の正本とする |
| 日次 FB 連携 | Mac UI の継続運用が確認できた後に別フェーズで判断する |

成功条件は機能数ではなく、活動が変わるたびに数週間から数か月、苦痛なく記録を続けられることとする。

## 2. 解決したい問題

後からフォームに一日分を思い出して入力する方法は摩擦と記憶誤差が大きい。入力モデルを「現在の活動を一つだけ持ち、活動が変わった瞬間に切り替える」有限状態機械へ変える。

```text
current_mode = RESEARCH

switch_to(GYM)

=> RESEARCH.end = now
=> GYM.start = now
=> current_mode = GYM
```

Mac で目指す操作は次の一連だけである。

```text
現在状態を視認 → 固定位置の活動を1クリック → 即時に選択表示が変わる
```

開始・停止・活動選択を別々に操作させない。原則として「停止」は作らず、生活・睡眠も活動として切り替える。

## 3. 確定したスコープ

### 実装するもの

- macOS ネイティブ常駐アプリ
- 現在モードと経過時間を表示するメニューバー項目
- 全モードを固定位置に並べる常時表示可能な小型パレット
- 1クリックの活動切替
- クリック直後のローカル表示更新と非同期の Timetracker 同期
- 小さな同期中・失敗表示
- 起動時、スリープ復帰時、一定間隔での Timetracker 状態更新
- Timetracker token の権限600ローカル保存
- 公式 Timetracker 画面を使った Google ログイン
- ログイン時の自動起動

### 実装しないもの

- Android アプリ、Android Widget、常駐サービス、通知 UI
- 独自アカウント、SaaS backend、データベース
- Timetracker の履歴編集、統計、Goals、Activity 管理の再実装
- 独自の端末間同期
- WidgetKit 拡張、App Group、WebSocket を最初から導入すること
- グラフ、テーマ機能、大規模な設定画面
- 日次 FB、Google Sheets、ActivityWatch、LLM 要約を Mac MVP の blocker にすること

スマートフォンと Mac の状態共有は Timetracker の既存同期に任せる。

## 4. Ponytail に基づく実装判断

### 4.1 既存 Mac クライアントを先に確認する

最初に Timetracker 公式 Mac アプリのメニューバー操作を実測する。固定配置と十分な応答速度が既に得られるなら、自作 UI は作らずそこで終了する。

自作へ進む条件は、少なくとも次のいずれかが確認された場合とする。

- 活動切替までのクリック数が多い
- 全活動の固定配置がなく、運動記憶で操作できない
- 現在状態が常時見えない
- 操作や描画の遅延が継続を妨げる

### 4.2 WidgetKit より単純な常駐アプリを先に使う

Mac MVP は SwiftPM の単一 executable とし、AppKit / SwiftUI の標準機能だけで構成する。

- `NSStatusItem` + `NSPopover`: 現在状態と補助操作
- `NSPanel`: 1クリック切替用の小型パレット
- `LSUIElement`: Dock に通常アプリとして表示しない
- `UserDefaults`: パネル位置、表示状態、活動順序など非機密設定
- Application Support: Timetracker token（ファイル権限600）
- `URLSession`: Timetracker 通信
- `WKWebView`: 公式 Timetracker の Google 認証画面のみ

WidgetKit はシステム管理の更新制約、App Extension、署名、共有状態の設計が増える。`NSPanel` で利用上の問題が実測された場合にだけ再検討する。

### 4.3 汎用基盤を作らない

記録先は Timetracker 一つなので、複数 backend 用の interface やローカル代替 DB は作らない。ただし未公開通信仕様の変更を UI へ波及させないため、通信は具体型 `TimetrackerClient` 一か所に隔離する。

## 5. UX 仕様

### 5.1 固定配置

活動は 3 列×3行の固定位置に置き、Timetracker の返却順では並べ替えない。

```text
┌──────────────────────────────────┐
│ NOW: 研究              1:24:00   │
│                                  │
│  研究       TOEIC      就活      │
│  仕事       運動       対人・私用 │
│  娯楽       生活       睡眠      │
└──────────────────────────────────┘
```

主分類は、時間の投下先を表す `研究`、`TOEIC`、`就活`、`仕事`、`運動`、`対人・私用`、`娯楽`、`生活`、`睡眠` の9個に固定する。`成果`、`成長`、`回復`、`外部拘束` などは入力ボタンにせず、将来必要になった場合の分析属性とする。

名前は完全一致で照合する。該当 Activity が不足する場合は他の Activity を表示せず、不足名を画面に示す。Activity ID はサーバーから取得するためローカル設定へ固定しない。

### 5.2 表示と操作

- 現在モードを色だけでなく枠線、太字、アイコンでも示す
- 現在モードと秒単位の経過時間を表示する
- 全モードを常時同じ位置に表示する
- 確認ダイアログを出さない
- 切替後に別ウィンドウや Timetracker アプリを前面に出さない
- 意味のないアニメーションを入れない
- キーボード操作と VoiceOver ラベルも用意する
- パレットは表示 / 非表示と位置固定を切り替えられる

### 5.3 切替処理

```text
user selects new_mode

1. local current mode を即時更新し pending 表示
2. UI を再描画
3. Timetracker へ非同期で切替要求
4. 成功時: server state で確定
5. 失敗時: 小さな error 表示を出し canonical state を再取得
```

ネットワーク応答を UI の描画前に待たない。古いレスポンスで新しいローカル操作を巻き戻さないよう、各操作にローカル revision と要求時刻を持たせる。

同じ活動を再度押した場合の扱いは Timetracker の実動作を確認して決める。推測で新しい区間を作らない。

## 6. 技術構成

隣接プロジェクト `../勤怠管理` にある次の実績済みパターンを再利用する。

- SwiftPM の単一 `executableTarget`
- `NSApplication` + `NSStatusItem` + `NSPopover`
- `NSApp.setActivationPolicy(.accessory)`
- `LSUIElement: true` の `.app` bundle
- release build と LaunchAgent によるログイン時起動

構成は必要最小限にし、UI・通信・認証の3責務だけを分ける。

```text
日々のFB管理APP/
├── IMPLEMENTATION_PLAN.md
├── README.md
├── AGENTS.md
├── .gitignore
├── Package.swift
├── AppInfo.plist
├── Sources/LifeShifter/
│   ├── main.swift
│   ├── TimetrackerClient.swift
│   └── GoogleAuthWindow.swift
├── docs/
│   ├── timetracker-protocol.md
│   └── measurements.md
├── local/                       # git 管理外。HAR、Cookie、調査用データ
└── install.sh
```

9分類は小さな静的配列としてコードに置く。設定ファイル、設定画面、独自スキーマは必要になるまで作らない。

## 7. 実装工程

### Phase 0 — 既存 UI の判定と通信契約の確認

1. Timetracker 公式 Mac アプリを導入し、次を実測する。
   - 現在状態の視認性
   - 活動切替までのクリック数
   - クリックから表示反映までの体感
   - 固定配置の有無
2. 既存 UI で十分なら、その結果をこの文書へ記録して自作を終了する。
3. 不十分なら Web / Mac クライアントの実通信から次を確認する。
   - 認証方式と更新方法
   - Activity 一覧
   - current running entry
   - activity switch request
   - history / entry 取得
   - 競合時の server semantics
   - 過去 timestamp を伴う再送の可否
4. 結果を `docs/timetracker-protocol.md` に記録し、最小の read / switch smoke test を通す。

エンドポイント、request schema、Cookie の流用可否を推測して実装しない。HAR、token、Cookie は `local/` にのみ保存し、値を文書や Git 履歴へ入れない。

**完了条件**: 公式 UI を採用するか自作するかの判断根拠が残り、自作の場合は current 取得と switch が再現可能になっている。

### Phase 1 — Mac UI MVP

1. `../勤怠管理` の最小構成を基に常駐アプリを作る。
2. 9分類の静的な固定配置で `NSPanel` と popover を描画する。
3. `TimetrackerClient` に確認済みの current / switch だけを実装する。
4. `LifeShifterStore` で optimistic update、revision、pending / error を管理する。
5. 起動時、スリープ復帰時、パネル表示時、30 秒間隔で current state を更新する。
6. 公式 Timetracker 画面で Google 認証し、Timetrackerが発行したtokenのみを権限600で Application Support に保存する。未署名MVPでは更新のたびに承認が発生するため Keychain は使わない。
7. release `.app` を作り、ログイン時起動を設定する。

WebSocket は 30 秒ポーリングで実用上の問題が確認された場合だけ追加する。履歴取得や日次集計は MVP に含めない。

**完了条件**:

- 表示中のパレットから1クリックで切り替えられる
- 切替操作で通常のアプリウィンドウを開かない
- クリック直後に選択状態が変わって見える
- Timetracker 履歴に正しい区間が残る
- スマートフォン側の変更が最大 30 秒程度で Mac に反映される
- 失敗時に無言で成功扱いせず、小さなエラー状態が見える
- ログイン後、実際の画面上で UI が利用可能になる

### Phase 2 — 信頼性と実運用検証

次の条件を release build で確認し、結果を `docs/measurements.md` に残す。

- 連続切替
- Mac アプリ再起動
- スリープ / 復帰
- Wi-Fi OFF / 復帰
- 認証期限切れ
- スマートフォン側での切替後の再同期
- Timetracker 側の一時的な server error

click-to-visual-feedback は画面収録のフレーム差分で測り、目標を 100 ms 級とする。通信完了時間は別に記録し、描画目標と混同しない。

オフライン時は Phase 0 の結果で分岐する。

- 過去 timestamp の replay が可能: 永続化した pending command を順番に再送する
- replay 不可: 最新 current mode だけを再送し、失われる可能性のある区間を UI に明示する

永続キューは必要性が確定した場合だけ追加する。

**完了条件**: 7 日以上の試用で、記録漏れ・誤切替・起動失敗がなく、操作摩擦が継続を妨げない。

### Phase 3 — 日次 FB 連携（保留）

Mac UI が継続利用できた後に、実際の既存 Google Sheets / 日次 FB のスキーマを確認して別計画を作る。

候補は Timetracker history の日単位集計であり、Google Form の画面自動操作はしない。ActivityWatch の PC context は「人間が選んだ活動」と別列にし、アプリ名から意図を自動決定しない。LLM 要約は明確な利用価値が確認されるまで追加しない。

## 8. 検証方針

| 対象 | 最小の検証 |
|---|---|
| mode 設定 | 9分類の重複、順序、名前の完全一致を `--self-check` で検査 |
| 状態管理 | optimistic update、古い response の破棄、失敗時の再取得 |
| Timetracker 契約 | current / switch の smoke test と履歴の目視確認 |
| UI | 固定配置、1クリック、VoiceOver、パネル位置の復元 |
| 常駐動作 | `.app` 起動、ログイン後表示、スリープ復帰 |
| 秘匿情報 | `git status` と `git log -p` に token / HAR / Cookie がないこと |

分岐やパーサなど非自明なロジックには、Swift 標準の `XCTest` か `--self-check` のどちらか一つ、最小の再現可能な検査を残す。

## 9. リスクと判断基準

1. **Timetracker の公開 API は未確認**

   private protocol に依存する場合は変更で壊れる。通信を `TimetrackerClient` に隔離し、本人のアカウントだけで利用する。

2. **認証情報の取得方法が未確認**

   公式の token flow がなければ、ブラウザ Cookie の安易なコピーを製品仕様にしない。安全かつ再現可能な方法が確認できなければ実装を止めて選択肢を見直す。

3. **常時最前面パネルが邪魔になる可能性**

   位置保存、非表示、全 Space 表示の切替だけを用意する。複雑なウィンドウ管理は作らない。

4. **スマートフォンで Timetracker プロセスが終了すると遅延が戻る可能性**

   これは自作 Android 開発の理由には直結させない。まず既存アプリの運用条件として記録し、許容できなくなった時だけ再評価する。

5. **ポーリングでは端末間反映に遅延がある**

   30 秒が実用上問題なら、確認済み WebSocket 契約か短い更新間隔を比較し、より単純で安定する方を選ぶ。

## 10. 実装開始時の指示

最初の実装タスクは Phase 0 のみとする。

```text
Timetracker 公式 Mac UI が LifeShifter の要求を満たすか実測し、
満たさない項目を記録する。

自作が必要と判断できた場合だけ、Web / Mac クライアントの実通信から
auth、activity list、current entry、switch request、履歴、競合挙動を確認し、
docs/timetracker-protocol.md と最小 smoke test を作る。

確認できていない endpoint や request schema を推測しない。
Android コード、独自 backend、履歴 UI、日次集計には着手しない。
```

Phase 0 の完了条件を満たすまで Phase 1 の本実装へ進まない。
