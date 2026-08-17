# LifeShifter / Timetracker UI Adapter — Codex Implementation Brief

> この文書は、Codex にそのまま与えて実装方針を共有するための要件・調査・設計ブリーフである。
> 目的は「新しいライフログサービスを作ること」ではなく、既存の Timetracker を記録エンジンとして再利用し、ユーザーが実際に継続できる超低摩擦 UI を Android / macOS に追加すること。

---

## 0. TL;DR — 最初に理解すべき結論

このプロジェクトで作るべきものは **ライフログアプリではない**。

作るのは以下だけ。

1. **CMF Phone 2 Pro (Android) の自作ホーム画面 Widget**
   - 全モードを常時表示
   - 1タップで現在モードを切替
   - タップした瞬間に UI をローカルで即時更新
   - Timetracker への同期は後段で非同期処理

2. **Mac の自作操作 UI**
   - Android と同じ固定配置
   - desktop Widget または常時表示パネル + Menu Bar の併用
   - 現在モード、開始時刻/経過時間、全モード切替を常時見える場所に配置

3. **Timetracker はそのまま使う**
   - アカウント
   - Activity 定義
   - 履歴
   - 修正 UI
   - 統計
   - クラウド同期
   - Android / Mac / Web の既存クライアント

4. 将来的に Timetracker のログを既存の Google Sheets / 日次 FB 系へ流す。

**フルスクラッチのバックエンド、独自 DB、独自履歴画面、独自分析画面は作らない。**

---

# 1. 背景 / 問題設定

ユーザーは毎日の実行内容をフィードバックとして記録したいが、フォーム入力、開始/停止、詳細記述などの摩擦が高いと運用を継続しない可能性が高い。

したがって、入力モデルそのものを次のように変える。

```text
「後からフォームへ記録」
        ↓ 廃止

「今、自分は何をしているか」を常時1状態だけ持つ
        ↓
活動が変わった瞬間に1タップで切り替える
        ↓
切替イベントから時間区間を自動生成する
```

これは timer の start / stop ではなく、**有限状態機械 (finite-state machine) としてのライフログ**である。

基本モデル:

```text
current_mode = RESEARCH

switch_to(GYM)

=> RESEARCH.end = now
=> GYM.start = now
=> current_mode = GYM
```

「停止」という概念は原則設けない。

---

# 2. UX思想 — 最重要要件

## 2.1 フリクション最小化が最優先

機能量より以下を優先する。

- アプリを開かない
- メニュー階層を辿らない
- start → stop → select のような複数操作をさせない
- 1回の活動切替につき **1タップ / 1クリック**
- 現在状態は常時視認可能
- ネットワーク応答を UI が待たない
- 読み取りより空間記憶で操作できる

目標 UX:

```text
視認 → タップ → 即時切替
```

目標体感は「通信成功後に表示が変わる」ではなく、**押した瞬間に選択状態が変わる**こと。

---

## 2.2 H パターン的 UI

車の H パターンシフターのように、各活動の位置を固定する。

例:

```text
┌────────────────────────┐
│       NOW: 研究         │
│       1h 24m            │
│                        │
│   研究        Oedo      │
│                        │
│   就活        TOEIC     │
│                        │
│   ジム        移動      │
│                        │
│   生活        休憩      │
└────────────────────────┘
```

重要なのは見た目の H 形状そのものではなく、**固定座標による運動記憶**。

- 「研究」は常に左上
- 「Oedo」は常に右上
- 「ジム」は常に左下寄り
- 「休憩」は常に右下

というように位置を絶対に変えない。

モード名は後から変更可能だが、初期は 6〜8 モード程度に抑える。

候補:

- 研究
- Oedo / 業務
- 就活
- TOEIC / 学習
- ジム
- 移動
- 生活
- 休憩

必要なら睡眠を追加。

**サブモードを大量に増やさない。**

---

# 3. 現在のユーザー環境

- Smartphone: **CMF Phone 2 Pro**
- OS: Android / Nothing OS 系
- PC: **Mac**
- 既に **Timetracker** を試用中
- Timetracker 本体アプリ内の操作は体感上サクサク
- Timetracker の Android ホーム画面 Widget は体感上もっさりしており不満
- 既存の日次 FB / Google Sheets 系資産は将来的に出力先として再利用したい

したがって、現時点の問題は Timetracker のデータモデルではなく、**UI Adapter / Widget 層**にある可能性が高い。

---

# 4. Timetracker を採用する理由

## 4.1 公式に確認できていること

Timetracker は以下を公式に提供している。

- Android アプリ
- Android ホーム画面 Widget
- persistent notification からの活動切替
- 1タップで activity を開始/切替
- 新しい activity を選ぶと前の activity が自動終了
- オフライン追跡
- 復帰時同期
- Android / Mac / Windows / Linux / Web 間同期
- Mac menu bar app
- 履歴、統計、Life Area、Goals 等

Timetracker の思想自体が今回のライフログ思想とかなり一致している。

したがって Timetracker の機能を再実装する合理性は低い。

---

## 4.2 開発者公開情報から分かっている内部構造

開発者自身の公開ページ/記事から、少なくとも以下が確認できる。

- Web frontend は React 系
- real-time sync に WebSocket を利用している旨の記載
- backend 側には Django を使った構成が存在する
- データモデルには `TimeEntry` がある
- 開発者の記事の demo seed では、現在進行中 entry を `end_time` 未設定で表現している
- Web tracking UI には `/track` route があり、activity tiles UI が存在する
- Android アプリは Capacitor を使った hybrid approach で作られた旨を開発者が記載している
- Mac app は公式サイトで Tauri 製と説明されている

### 重要

**公開された外部開発者向け REST API / SDK / Deep Link 仕様は現時点で確認できていない。**

したがって、Timetracker との接続部分は最初に必ず実測して確定すること。

公開 API がある前提でコードを書いてはいけない。

---

# 5. 調査済みプラットフォーム仕様

## 5.1 Android Widget

Android では Jetpack Glance / AppWidget を使用できる。

Glance には Widget 内の操作に対して `ActionCallback` を実行する仕組みがあり、activity を起動せずにクリック処理を行える。

構成イメージ:

```kotlin
Button(
    text = "研究",
    onClick = actionRunCallback<SwitchModeAction>(...)
)
```

`ActionCallback.onAction()` は suspend function であり、クリックに対するローカル処理を実行可能。

重い/長時間処理は Worker 等へ逃がす。

### UX上の重要設計

Timetracker API のレスポンスを待ってから Widget 表示を更新してはいけない。

```text
Tap
 ↓
Local state 更新
 ↓
Widget 即再描画
 ↓
同期 Queue 追加
 ↓
Timetracker API / internal endpoint
 ↓
成功確認
```

これを **optimistic UI** とする。

ネットワークが遅くても、ユーザーには即時に切り替わったように見える必要がある。

---

## 5.2 macOS Widget

WidgetKit は macOS の desktop / Notification Center widget をサポートする。

Button / Toggle + App Intent で、アプリ本体を開かず Widget 内から action を実行できる。

概念:

```swift
Button(intent: SwitchActivityIntent(activityID: id)) {
    Text("研究")
}
```

App Intent の `perform()` は async で実行できる。

Widget は通常の常駐 view ではなく system managed なため、リアルタイム更新設計には注意が必要。

必要なら Widget と別に以下を追加する。

- small menu-bar helper
- local shared cache
- WebSocket listener
- `WidgetCenter.reloadTimelines()`

Mac の最終 UI は次の二重化を推奨する。

### Desktop

全モード表示 + current mode 表示

### Menu bar

```text
🔬 研究  1:24
```

を常時表示し、クリック時に同じ全モードパレットを表示。

---

# 6. 推奨アーキテクチャ

```text
                         ┌──────────────────────────┐
                         │      Timetracker         │
                         │                          │
                         │ Account / Activities     │
                         │ TimeEntry history        │
                         │ Statistics / editing     │
                         │ Cloud sync               │
                         └──────────┬───────────────┘
                                    ▲
                        private/public API
                         or existing web protocol
                                    │
          ┌─────────────────────────┴──────────────────────────┐
          │                                                    │
┌─────────┴──────────┐                              ┌──────────┴─────────┐
│ CMF Phone 2 Pro    │                              │ Mac                │
│                    │                              │                    │
│ LifeShifter Widget │                              │ LifeShifter        │
│ Jetpack Glance     │                              │ WidgetKit          │
│                    │                              │ + Helper/MenuBar   │
│ local state        │                              │ local state        │
│ pending queue      │                              │ websocket/cache    │
└────────────────────┘                              └────────────────────┘
```

### 原則

Timetracker を **system of record** とする。

LifeShifter は **操作 UI + optimistic local state + protocol adapter** とする。

---

# 7. 最初にやるべき技術検証 — Coding より先

## P0: Timetracker の通信契約を特定する

Codex はいきなり Widget を作り始めないこと。

まず Timetracker Web / Desktop が活動切替時に何を送っているかを特定する。

最低限必要なのは以下。

1. authentication
2. activity list 取得
3. current running activity / TimeEntry 取得
4. switch activity
5. history / TimeEntry 取得
6. real-time update (WebSocket 等)

### 調査方法

Web版 Timetracker にログインし、Chrome DevTools の Network を使用。

```text
研究を選択
↓
ジムへ切替
↓
発生する HTTP / WS 通信を確認
```

記録するもの:

```text
method
URL/path
request headers
auth mechanism
request body
response body
WS endpoint
WS message format
error response
```

### 成果物

`docs/timetracker-protocol.md`

例:

```md
# Timetracker Protocol

## Auth
...

## List Activities
...

## Get Current Entry
...

## Switch Activity
...

## WebSocket
...
```

### 禁止

- endpoint を推測して実装しない
- Web記事の断片から request schema を捏造しない
- credentials/token をリポジトリへ commit しない

---

# 8. Timetracker 接続 Adapter

通信仕様を Widget code へ直接埋め込まない。

必ず Adapter 層に隔離する。

概念 API:

```text
interface TimetrackerClient {
    authenticate()
    listActivities()
    getCurrentState()
    switchActivity(activityId)
    getEntries(range)
    observeCurrentState()
}
```

Android:

```text
TimetrackerClient.kt
```

Mac:

```text
TimetrackerClient.swift
```

または protocol spec が固まった後で shared logic を生成してもよい。

Timetracker 側の内部 API が将来変更された場合、Adapter だけ修正できるようにする。

---

# 9. Android 実装仕様

## 9.1 初期構成

推奨:

- Kotlin
- Jetpack Glance
- WorkManager
- DataStore または小さな Room DB
- Kotlin Coroutines

最低限の module:

```text
android/
├── widget/
│   ├── LifeShifterWidget.kt
│   ├── SwitchModeAction.kt
│   └── WidgetRenderer.kt
├── state/
│   ├── CurrentStateStore.kt
│   └── PendingSyncStore.kt
├── timetracker/
│   ├── TimetrackerClient.kt
│   └── TimetrackerModels.kt
├── sync/
│   └── SyncWorker.kt
└── app/
    └── MinimalSettingsActivity.kt
```

---

## 9.2 Widget の状態

```kotlin
data class LocalCurrentState(
    val activityId: String,
    val displayName: String,
    val startedAt: Instant,
    val syncState: SyncState,
    val revision: Long
)
```

```kotlin
enum class SyncState {
    SYNCED,
    PENDING,
    ERROR
}
```

---

## 9.3 Switch algorithm

最重要。

```text
user taps new_mode

1. now = current time
2. immediately update local current_state
3. increment local revision
4. render widget with new active mode
5. append SwitchCommand to pending queue
6. start async sync worker
7. worker sends switch to Timetracker
8. on success:
       mark command synced
       optionally reconcile server current_state
9. on failure:
       retain PENDING / ERROR state
       retry with backoff
```

UI は step 2〜4 で完了している必要がある。

---

## 9.4 Offline / retry

ネットワーク断でも UI 操作を阻害しない。

Pending event:

```text
SwitchCommand {
  command_id
  device_id
  requested_activity_id
  client_timestamp
  local_revision
  status
  retry_count
}
```

ネット復帰後に送信。

### 注意

Timetracker の internal API が「過去 timestamp で switch」をサポートしない場合、完全な offline replay は難しい。

この点は P0 調査で確認する。

サポートしない場合は MVP では:

- current mode の即時 UI は維持
- sync fail を小さい indicator で表示
- network 復帰時に current mode を再送
- missed interval の完全復元は後回し

としてもよい。

---

# 10. macOS 実装仕様

## 10.1 推奨構成

```text
macos/
├── App/
│   └── LifeShifterApp.swift
├── Widget/
│   ├── LifeShifterWidget.swift
│   ├── SwitchActivityIntent.swift
│   └── WidgetProvider.swift
├── MenuBar/
│   └── MenuBarView.swift
├── State/
│   └── SharedStateStore.swift
├── Timetracker/
│   └── TimetrackerClient.swift
└── Sync/
    └── RealtimeSyncService.swift
```

技術:

- Swift
- SwiftUI
- WidgetKit
- App Intents
- MenuBarExtra
- App Group
- URLSession / WebSocket

---

## 10.2 Desktop Widget

目的:

- desktop に常時表示
- current mode が一目で分かる
- 6〜8 modes をすべて表示
- 1クリックで切替

### Widget state

Widget 単独でネットワーク状態を source of truth にしない。

App Group で shared state を読む。

```text
Timetracker / helper
       ↓
SharedStateStore
       ↓
Widget timeline
```

---

## 10.3 Menu Bar

desktop Widget が別 window に隠れる状況を補う。

表示例:

```text
🔬 研究 1:24
```

クリックすると全 activity button を表示。

Widget と同じ固定配置を使う。

---

# 11. UI design rules

## 必須

- current mode を明確にハイライト
- inactive mode も全部常時表示
- mode order / position は固定
- confirmation dialog 禁止
- switch 後に app launch 禁止
- unnecessary animation 禁止
- color だけで current state を表現しない
- text + border / weight / icon 等でも state を表現
- 片手で押せる hit target を確保

## 配色

初期は OS の system color / Material theme を利用。

見た目の作り込みより反応速度優先。

---

# 12. 経過時間表示

経過時間は重要だが、秒単位で Widget 自体を頻繁に再実行する必要はない。

目的は「現在何をしているかの認識」であり、stopwatch の秒精度ではない。

Android MVP:

```text
NOW: 研究
started 14:37
1h 24m
```

程度でよい。

Mac では WidgetKit / SwiftUI の system date representation を活用できる場合は活用する。

---

# 13. Source of truth と競合処理

## MVP

- Timetracker = canonical history
- LifeShifter local state = optimistic view

### 競合例

Android で RESEARCH → GYM を押した直後、Mac で WORK を押した場合。

Timetracker の server-side semantics が判明するまでは独自 CRDT 等を作らない。

P0 で server behavior を確認する。

基本候補:

- last accepted server event wins
- server response を canonical とし、clients reconcile

UI 上は `revision` / `updatedAt` を保持して古い response で新しい local state を巻き戻さない。

---

# 14. 既存の日次 FB / Google Sheets との統合

これは Phase 1 の blocker ではない。

最初は「リアルタイム記録が継続できるか」を成立させる。

その後、Timetracker history を日単位で集計して既存 FB へ出す。

例:

```text
2026-08-17
研究      3h20m
Oedo      2h40m
就活      1h10m
TOEIC     0h45m
ジム      1h05m
移動      1h30m
生活      4h10m
休憩      1h20m
睡眠      8h00m
```

既存 Google Form を無理に自動クリックするより、可能なら回答先 Google Sheet / 自動集計 Sheet を互換レイヤとして扱う。

ただし既存 FB の schema を確認してから実装すること。

---

# 15. ActivityWatch との将来統合

Timetracker は **意図 / activity mode** を人間が1タップで指定する。

ActivityWatch 等は **実際の PC context** を自動取得する。

例:

```text
Human mode:
研究

PC context:
VS Code 48 min
Chrome / arXiv 31 min
Terminal 14 min
Slack 4 min
```

この2種類を混同しない。

アプリ名だけから human intent を完全自動推定しない。

最終的には日次 FB 生成時に統合する。

---

# 16. 実装フェーズ

## Phase 0 — Protocol Discovery

目的:
Timetracker との接続方法を確定。

成果物:

- `docs/timetracker-protocol.md`
- curl / small script で activity list 取得
- curl / small script で switch 成功
- current state 取得成功
- auth handling 方針

**ここが完了するまで本格 Widget を作らない。**

---

## Phase 1 — Android MVP

目的:
CMF Phone 2 Pro で公式 Timetracker Widget より明確に高速な操作を実現。

機能:

- 6〜8 mode 固定表示
- current mode 表示
- 1 tap switch
- optimistic local update
- async Timetracker sync
- pending/error indicator
- minimal settings for token/account/activity mapping

非目標:

- stats
- history editor
- charts
- goals
- complex customization

### Acceptance criteria

- Widget のボタンを1回押すだけで切替
- Timetracker app が foreground でなくても動く
- tap 後、server response 前に active state が表示上変わる
- 通常状態で「押したのに変わらない」と感じない
- app を開く必要がない
- Timetracker history に正しく反映される
- network failure で UI 自体が固まらない

---

## Phase 2 — Mac UI

機能:

- WidgetKit desktop widget
- Android と同じ固定 layout
- App Intent switch
- current mode
- MenuBarExtra
- shared cache

必要なら helper で Timetracker real-time state を受信。

### Acceptance criteria

- desktop から1 click switch
- app window を開かない
- Android で切替した状態が Mac に反映される
- Mac で切替した状態が Android / Timetracker に反映される

---

## Phase 3 — Daily Feedback Automation

- Timetracker history fetch
- daily aggregation
- existing Google Sheets compatibility
- ActivityWatch context integration
- optional LLM daily summary

---

# 17. Codex がやってはいけないこと

以下を勝手に拡張しないこと。

- 新規 SaaS backend を作る
- Supabase/Firebase を勝手に導入する
- Timetracker の代替 DB を作る
- login/account system を作り直す
- charts / analytics を再実装する
- modes を大量に増やす
- timer start/stop UI に戻す
- switch 前に confirmation を入れる
- network request 完了まで UI update を待つ
- Timetracker internal endpoint を推測する
- Google Sheets 統合を Phase 1 の blocker にする

---

# 18. Failure handling

## Timetracker API changed

Adapter だけを修正する。

UI logic と API contract を密結合しない。

## Authentication expired

Widget に巨大な error dialog は出さない。

小さい sync-error state を表示し、settings app から再認証。

## Network unavailable

local switch は成立させる。

sync queue に積む。

## Server and local state disagree

古い server response で最新 local action を巻き戻さない。

client revision / timestamp を比較する。

---

# 19. テスト方針

## Unit

- state transition
- queue handling
- stale response handling
- activity mapping

## Integration

- Timetracker auth
- list activities
- switch
- read current
- reconnect

## Android device test

CMF Phone 2 Pro 実機で以下を必ず測る。

- cold widget tap
- repeated switches
- app killed
- screen lock/unlock
- Wi-Fi slow
- Wi-Fi off
- cellular
- battery optimization on/off

重要評価指標は backend latency ではなく **tap-to-visual-feedback**。

## Mac

- desktop widget
- menu bar
- sleep/wake
- network reconnect
- Android-side switch reflection

---

# 20. パフォーマンス目標

厳密な SLA ではなく UX target。

- tap → local highlight: ideally < 100 ms class
- user-perceived response: immediate
- network sync: asynchronous, no direct UX dependency
- startup: no unnecessary heavy runtime

公式 Timetracker Widget より体感が明確に良くならなければ自作する意味がない。

---

# 21. セキュリティ

Timetracker token / cookie / credential は secure storage へ保存。

Android:

- Android Keystore / encrypted storage

Mac:

- Keychain

禁止:

```text
hardcoded token
.git tracked secrets
plaintext credential file
```

private / undocumented API を利用する場合、ユーザー自身のアカウントに限定し、通信仕様変更で壊れる可能性を README に明示。

---

# 22. 推奨 repository structure

```text
lifeshifter/
├── README.md
├── AGENTS.md
├── docs/
│   ├── requirements.md
│   ├── architecture.md
│   └── timetracker-protocol.md
│
├── tools/
│   └── timetracker-probe/
│
├── android/
│   └── ...
│
├── macos/
│   └── ...
│
└── scripts/
    └── ...
```

`AGENTS.md` には、この文書の重要原則を圧縮して記載する。

---

# 23. 最初の Codex Task

最初の task は以下。

```text
このリポジトリでは LifeShifter を実装する。
ただし、まだ Android/Mac Widget の本実装には入らないこと。

まず docs と既存コードを確認し、Timetracker の Web クライアントで
activity switch 時に利用されている通信仕様を特定するための調査手順と
最小 probe tooling を用意せよ。

目標:
1. auth mechanism の特定
2. activity list endpoint の特定
3. current running activity / TimeEntry 取得方法の特定
4. switch activity request の特定
5. WebSocket/realtime endpoint と message の特定

結果を docs/timetracker-protocol.md に記録する。
推測した endpoint を本実装へ埋め込んではならない。

protocol が確定したら、CLI から
`list`, `current`, `switch <activity>`
を実行できる最小 client を作る。

この CLI で switch が安定して成功した後にのみ Android Widget Phase に進む。
```

---

# 24. Phase 1 開始時の Codex Task

Protocol discovery 完了後:

```text
Timetracker protocol adapter を使用して、Android Jetpack Glance の
LifeShifter Widget MVP を実装せよ。

要件:
- 6〜8 activity を固定座標で常時表示
- current activity を明確にハイライト
- 1 tap で switch
- app Activity を開かない
- tap 時はまず local state を optimistic update
- Widget 表示を即座に更新
- Timetracker sync は非同期
- failure は pending/error indicator のみ
- retry queue を持つ
- network request を UI の critical path に置かない

Timetracker の history/statistics/account UI は再実装しない。
```

---

# 25. 調査ソース / 事実確認メモ

以下は 2026-08-17 時点で再確認した情報。

### Timetracker official

- Android page: Android widget から app を開かず activity start/switch、offline tracking、device sync
- macOS page: menu bar 常駐、one-click switching、Tauri build、cross-device sync
- main site/blog: one-tap activity switching、previous activity auto-stop、24h life tracking

### Timetracker developer (hior / Ivan Bezdenezhnykh)

- project profile: React + WebSocket として Timetracker を掲載
- developer article: `/track` route、activity tile UI、Django demo seed、`TimeEntry`、running entry の `end_time` を空にする例
- Android development article: Android app を Capacitor hybrid approach で構築した旨

### Android official docs

- Jetpack Glance supports widget user interactions
- `ActionCallback` can run in response to widget action
- long tasks should be moved out to Worker etc.

### Apple official docs

- WidgetKit supports native Mac desktop widgets
- interactive widgets support Button / Toggle
- actions are implemented with App Intents
- `perform()` is async
- widget interactions can execute functionality without launching main app

---

# 26. Known unknowns

これらは **未確認**。Codex は断定してはいけない。

1. Timetracker が正式な public API を提供しているか
2. Timetracker の正確な endpoint paths
3. auth token format / refresh flow
4. activity switch request schema
5. WebSocket path/message schema
6. offline switch を過去 timestamp 付きで replay 可能か
7. API利用が rate limit / anti-CSRF / origin 等に依存するか
8. Android official Timetracker Widget が遅い正確な原因

これらは protocol discovery で確定する。

---

# 27. 最終的な製品像

完成形でも LifeShifter は薄いままでよい。

```text
Morning
↓
[生活]
↓ 1 tap
[移動]
↓ 1 tap
[研究]
↓ 1 tap
[Oedo]
↓ 1 tap
[ジム]
↓ 1 tap
[生活]
↓
[睡眠]
```

夜になってフォームへ何時間やったか入力する必要はない。

Timetracker の interval history が既に存在し、日次処理が集計して FB を生成する。

このプロジェクトの成功条件は「高機能なアプリが完成したこと」ではない。

**ユーザーが数週間〜数ヶ月、活動切替を苦痛なく継続できること。**

したがって、全ての設計判断で **継続可能性 > 機能量** を優先すること。
