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
