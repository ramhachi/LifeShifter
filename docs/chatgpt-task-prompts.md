# ChatGPT 定期タスク

Google DriveをChatGPTへ接続し、ChatGPT Webの独立した定期タスクとして登録する。

## 日次振り返り（毎日 00:30、Asia/Tokyo）

```text
前日の日次振り返りを日本語で作成してください。

1. Google DriveでMaster Spreadsheetを開き、GPT Contextシートの period_type=daily かつ period=前日の行を読む。
   https://docs.google.com/spreadsheets/d/1R6iD6601KfWTjdUlXwic-1hFkXJpM_iF8BtoTXdiz6w/edit
2. Google Driveの「Life Log GPT Context/daily/YYYY-MM-DD.json」から同じ前日のJSONを読む。
3. SheetとJSONのperiod、schema_version=life_log_daily_v1、source_hashを照合する。不一致なら分析せず「データ同期不一致」と不一致項目を報告する。
4. data_qualityの問題を冒頭に明記し、欠損値を推測しない。
5. 「事実 → 解釈 → 原因候補 → 次の行動」の順で簡潔にまとめる。
6. 研究・TOEIC・就活・仕事への時間投下、成果、体力・気分・集中度、娯楽・生活への流出を区別する。
7. 計画遵守率だけで罰せず、有用なフォールバック、休養、外部拘束を文脈として扱う。
8. 日付、カテゴリ別分数、source_hashの先頭8文字を末尾に示す。

Codex、ローカルファイル、推測値は使わないでください。
```

## 週次レビュー（毎週月曜 07:00、Asia/Tokyo）

```text
直前の月曜から日曜までの週次レビューを日本語で作成してください。

1. Google DriveでMaster Spreadsheetを開き、GPT Contextシートの period_type=weekly かつ period=直前週のISO weekの行を読む。
   https://docs.google.com/spreadsheets/d/1R6iD6601KfWTjdUlXwic-1hFkXJpM_iF8BtoTXdiz6w/edit
2. Google Driveの「Life Log GPT Context/weekly/YYYY-Www.json」から同じ週のJSONを読む。
3. SheetとJSONのperiod、schema_version=life_log_weekly_v1、source_hashを照合する。不一致なら分析せず「データ同期不一致」と不一致項目を報告する。
4. data_qualityの問題を冒頭に明記し、欠損値を推測しない。
5. 「事実 → 解釈 → 原因候補 → 来週の意思決定」の順でまとめる。
6. 研究・TOEIC・就活・仕事の週累計、成果との対応、状態指標の推移、娯楽・生活への流出を見る。
7. 価値あるフォールバック、休養、外部拘束と無目的消費を区別する。
8. 来週の変更は最大3件とし、各変更に観測根拠を添える。
9. ISO week、カテゴリ別分数、source_hashの先頭8文字を末尾に示す。

Codex、ローカルファイル、推測値は使わないでください。
```
