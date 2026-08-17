# LifeShifter

Timetracker の Activity を Mac から固定配置で切り替える、macOS 13+ 向けの小さな常駐 UI です。Android 側は Timetracker の既存アプリと Widget を使います。

## MVP

- 2列・最大8 Activity の固定パレット
- クリック直後の optimistic 表示
- Timetracker への非同期切替
- 30秒ごとの状態同期
- メニューバー表示
- token の Keychain 保存
- LaunchAgent によるログイン時起動

Timetracker の履歴、統計、Activity 編集は再実装しません。

## 実行

```sh
swift run LifeShifter --self-check
./install.sh
```

起動後、Timetracker のメールアドレスとパスワードでログインします。パスワードは保存せず、公式 API から返る token のみを macOS Keychain に保存します。

Google / Apple のみで作成したアカウントの OAuth ログインは MVP の対象外です。必要な場合は Timetracker 側でパスワードを設定してから使います。

Activity は `研究 → Oedo → 業務 → 就活 → TOEIC → 学習 → ジム → 移動 → 生活 → 休憩 → 睡眠` の優先順で照合し、最大8件を表示します。該当しない Activity は Timetracker の返却順を維持します。

通信契約の根拠は [docs/timetracker-protocol.md](docs/timetracker-protocol.md) に記録しています。
