# Life Log Apps Script

Master Spreadsheetに紐づくApps Scriptプロジェクトへ `Code.gs` と `appsscript.json` を反映する。

1. SpreadsheetのApps Scriptで `setupLifeLogV2()` を1回実行し、権限を承認する。
2. Spreadsheetの `Life Log` メニューから `Timetracker認証を設定` を選ぶ。
3. `今すぐ同期` を実行する。
4. `Time Log Raw`、`Daily Actual`、`Daily Log v2`、`GPT Context` とDriveの `Life Log GPT Context` を確認する。

認証値はApps ScriptのUser Propertiesだけへ保存される。Sheet、Drive JSON、Gitへは保存しない。

- 1時間ごと: 当日・前日の同期
- 毎日2時台: 直近14日の再照合
- Reflection Form送信時: 集計とJSONの再生成

```bash
node tests/life_log_self_check.js
```

## Smartwatch health ingest

1. Apps Script editorで`configureHealthIngest('32文字以上のランダムsecret')`を一度実行する。
2. Web Appを「自分として実行」でdeployし、URLと同じsecretをPersonal Hubへ設定する。
3. Android側のHealth Connect権限とGadgetbridge `DataOrigin` packageを設定する。

Web Appは受信したJSON文字列そのものをHMAC-SHA256で検証し、`issued_at`の5分窓、nonce再利用、`batch_id`重複を拒否する。書き込み対象は`health_daily`、`workout_sessions`、`raw_manifest`、`sync_audit`だけで、既存のフォーム・Timetrackerタブは変更しない。

`GPT Context`には従来の`daily`/`weekly` v1に加えて、healthを`date_local`で左結合した`daily_v2`/`weekly_v2`を生成する。14日間のconsumer確認後、Script Property `LIFE_LOG_V1_ENABLED=false`を設定するとv1の新規更新だけを止められる。過去行・Driveファイルは削除しない。
