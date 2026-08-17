# MVP 検証記録

確認日: 2026-08-17

| 項目 | 結果 |
|---|---|
| `swift build` | 成功 |
| `swift build -c release` | 成功 |
| `LifeShifter --self-check` | 成功 |
| Info.plist / LaunchAgent plist | `plutil -lint` 成功 |
| LaunchAgent | `gui/501/com.sota.lifeshifter` が running |
| 多重起動 | install再実行後も `LifeShifter` は1プロセス |
| 実画面 | 「Googleでログイン」の単一導線と説明文を確認 |
| 公式認証導線 | Timetrackerのsignin画面とGoogleログインポップアップを別windowで表示 |
| ログイン後API | Googleアカウント入力待ち |
| click-to-visual-feedback | ログイン後に測定 |

初回install時にLaunchAgentと `open` の双方から二重起動したため、起動経路をLaunchAgentだけに修正した。再install後の単一プロセスを確認済み。
