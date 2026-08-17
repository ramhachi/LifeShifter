# LifeShifter

Timetracker の Activity を Mac から固定配置で切り替える、macOS 13+ 向けの小さな常駐 UI です。Android 側は Timetracker の既存アプリと Widget を使います。

## MVP

- 3列×3行・9 Activity の固定パレット
- クリック直後の optimistic 表示
- Timetracker への非同期切替
- 30秒ごとの状態同期
- メニューバー表示
- 公式 Timetracker 画面を使った Google ログイン
- token の権限600ローカル保存
- LaunchAgent によるログイン時起動

Timetracker の履歴、統計、Activity 編集は再実装しません。

## 実行

```sh
swift run LifeShifter --self-check
./install.sh
```

起動後、「Googleでログイン」を押し、公式 Timetracker の認証画面で Google ログインを完了します。LifeShifter は Google のパスワードを取得・保存しません。認証完了後に timetracker.live が発行した token を `~/Library/Application Support/LifeShifter/tokens.json` へ所有者だけが読める権限600で保存し、起動後のAPI通信ではメモリ上の値を再利用します。未署名MVPの更新時に承認ダイアログを繰り返さないため、Keychainは使用しません。

Activity は次の9分類を名前の完全一致で照合し、常に同じ3×3配置で表示します。

```text
研究       TOEIC      就活
仕事       運動       対人・私用
娯楽       生活       睡眠
```

Timetracker 側に不足する分類がある場合は、別カテゴリで穴埋めせず不足名を表示します。旧カテゴリは操作対象から削除済みですが、過去の時間記録は履歴・統計に保持しています。

通信契約の根拠は [docs/timetracker-protocol.md](docs/timetracker-protocol.md) に記録しています。
