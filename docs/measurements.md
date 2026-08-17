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
| Google認証 | 実アカウントで成功 |
| Activities | 8件を取得して固定パレットへ表示 |
| Current entry | 未記録時の空bodyを `nil` として処理 |
| Keychain | tokenを1項目へ保存し、起動後はメモリキャッシュを使用 |
| 手動更新 | 更新後も同期済み表示、Keychainの再照会なし |
| Switch | 実記録を変更するため未実施 |
| click-to-visual-feedback | ログイン後に測定 |

初回install時にLaunchAgentと `open` の双方から二重起動したため、起動経路をLaunchAgentだけに修正した。再install後の単一プロセスを確認済み。

Google認証成功時、WebKitのポップアップ終了とAppKitのwindow解放が競合して `EXC_BAD_ACCESS` が発生した。window終了を次のmain-loopへ遅延し、不要なwindow animationを無効化した後、認証完了・手動更新・単一プロセス維持・新規crash reportなしを確認した。
