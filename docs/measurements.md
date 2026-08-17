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
| 実画面 | 9ボタンを `研究 / TOEIC / 就活`、`仕事 / 運動 / 対人・私用`、`娯楽 / 生活 / 睡眠` の3×3で確認 |
| 公式認証導線 | Timetrackerのsignin画面とGoogleログインポップアップを別windowで表示 |
| Google認証 | 実アカウントで成功 |
| Activities | 固定9分類だけを取得順に依存せず3×3パレットへ表示 |
| Current entry | 未記録時の空bodyを `nil` として処理 |
| 認証情報 | tokenを権限600のApplication Supportファイルへ保存し、起動後はメモリキャッシュを使用 |
| 手動更新 | 更新後も同期済み表示、認証ファイルの再照会なし |
| Switch | 研究への切替、同期済み表示、経過表示が `0:00:00` から `0:00:02` へ進むことを確認 |
| 非trackable Activity | Work / Healthは400になることを確認し、操作ボタンから除外 |
| 経過表示 | server同期後も記録継続を確認し、表示を時:分:秒へ変更 |
| 分類移行 | 9分類を作成し、旧分類は履歴・統計を保持して操作対象から削除 |
| click-to-visual-feedback | クリック後の選択状態と `NOW 研究` への即時更新を実画面で確認 |

初回install時にLaunchAgentと `open` の双方から二重起動したため、起動経路をLaunchAgentだけに修正した。再install後の単一プロセスを確認済み。

Google認証成功時、WebKitのポップアップ終了とAppKitのwindow解放が競合して `EXC_BAD_ACCESS` が発生した。window終了を次のmain-loopへ遅延し、不要なwindow animationを無効化した後、認証完了・手動更新・単一プロセス維持・新規crash reportなしを確認した。

未署名アプリの更新後、旧Keychain項目への `SecItemCopyMatching` が承認待ちでメインスレッドを停止させることをプロセスサンプルで確認した。起動時のKeychainアクセスを廃止し、権限600のApplication Supportファイルへ移行した。
