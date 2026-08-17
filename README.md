# LifeShifter

Timetracker の Activity を Mac から固定配置で切り替える、macOS 13+ 向けの小さな常駐 UI です。Android 側は Timetracker の既存アプリと Widget を使います。

## MVP

- 2列・最大8 Activity の固定パレット
- クリック直後の optimistic 表示
- Timetracker への非同期切替
- 30秒ごとの状態同期
- メニューバー表示
- 公式 Timetracker 画面を使った Google ログイン
- token の Keychain 保存
- LaunchAgent によるログイン時起動

Timetracker の履歴、統計、Activity 編集は再実装しません。

## 実行

```sh
swift run LifeShifter --self-check
./install.sh
```

起動後、「Googleでログイン」を押し、公式 Timetracker の認証画面で Google ログインを完了します。LifeShifter は Google のパスワードを取得・保存しません。認証完了後に timetracker.live が発行した token を1つのmacOS Keychain項目へ保存し、起動後のAPI通信ではメモリ上の値を再利用します。

Activity は `研究 → Oedo → 業務 → 就活 → TOEIC → 学習 → ジム → 移動 → 生活 → 休憩 → 睡眠` の優先順で照合し、最大8件を表示します。該当しない Activity は Timetracker の返却順を維持します。

通信契約の根拠は [docs/timetracker-protocol.md](docs/timetracker-protocol.md) に記録しています。
