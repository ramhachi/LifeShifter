const LIFE_LOG = Object.freeze({
  spreadsheetId: '1R6iD6601KfWTjdUlXwic-1hFkXJpM_iF8BtoTXdiz6w',
  contextFolderId: '1Ozde0fOiznnHx5WDYpdZoaCy-IcKDlvg',
  timezone: 'Asia/Tokyo',
  utcOffset: '+09:00',
  apiBase: 'https://api.timetracker.live/api/',
  cutoverDate: '2026-08-17',
  categories: ['研究', 'TOEIC', '就活', '仕事', '運動', '対人・私用', '娯楽', '生活', '睡眠'],
  sheets: {
    raw: 'Time Log Raw', actual: 'Daily Actual', reflection: 'Reflection Responses v2',
    daily: 'Daily Log v2', context: 'GPT Context', legacy: 'フォームの回答 1',
    healthDaily: 'health_daily', workouts: 'workout_sessions', rawManifest: 'raw_manifest', syncAudit: 'sync_audit'
  }
});

const RAW_HEADERS = ['entry_id', 'activity_id', 'activity_name', 'start_time_utc', 'end_time_utc', 'duration_seconds', 'is_active', 'is_deleted', 'synced_at_utc'];
const ACTUAL_HEADERS = ['date', ...LIFE_LOG.categories.map(name => `${name}_min`), 'tracked_min', 'first_start_utc', 'last_end_utc', 'entry_count', 'calendar_span_min', 'generated_at_utc'];
const DAILY_HEADERS = ['date', ...LIFE_LOG.categories.map(name => `${name}_min`), 'tracked_min', 'completed_progress', 'tomorrow_key_outcome', 'physical_energy', 'mood', 'focus', 'deviation_cause', 'reflection', 'notes', 'reflection_source', 'data_quality', 'generated_at_utc'];
const CONTEXT_HEADERS = ['period_type', 'period', 'schema_version', 'generated_at_utc', 'source_hash', 'json'];
const HEALTH_DAILY_HEADERS = ['date_local', 'timezone', 'source_id', 'device_model', 'steps_watch', 'distance_m', 'active_kcal', 'total_kcal', 'exercise_min', 'workout_count', 'hr_avg_bpm', 'hr_min_bpm', 'hr_max_bpm', 'resting_hr_bpm', 'spo2_avg_pct', 'spo2_min_pct', 'stress_avg', 'stress_max', 'sleep_start_at', 'sleep_end_at', 'sleep_total_min', 'sleep_deep_min', 'sleep_light_min', 'sleep_rem_min', 'sleep_awake_min', 'nap_min', 'data_completeness', 'provisional', 'updated_at', 'finalized_at', 'schema_version'];
const WORKOUT_HEADERS = ['session_id', 'source_record_id', 'source_id', 'device_model', 'date_local', 'start_at', 'end_at', 'duration_sec', 'workout_type_raw', 'workout_type_norm', 'active_kcal', 'total_kcal', 'distance_watch_m', 'steps', 'hr_avg_bpm', 'hr_min_bpm', 'hr_max_bpm', 'hr_zone_1_sec', 'hr_zone_2_sec', 'hr_zone_3_sec', 'hr_zone_4_sec', 'hr_zone_5_sec', 'cadence_avg', 'cadence_max', 'speed_avg_mps', 'speed_max_mps', 'machine_distance_m', 'machine_incline_pct', 'machine_kcal', 'rpe', 'pain_flag', 'note', 'fit_archive_id', 'raw_archive_id', 'sync_status', 'updated_at', 'schema_version'];
const RAW_MANIFEST_HEADERS = ['archive_id', 'drive_file_id', 'source_id', 'format', 'content_type', 'device_model', 'range_start', 'range_end', 'bytes', 'sha256', 'schema_version', 'uploaded_at', 'verified_at', 'retention_class'];
const SYNC_AUDIT_HEADERS = ['sync_run_id', 'batch_id', 'issued_at', 'received_at', 'status', 'health_daily_upserted', 'workout_sessions_upserted', 'raw_manifest_upserted', 'error_code', 'error_message'];

function configureHealthIngest(hmacSecret) {
  if (!hmacSecret || hmacSecret.trim().length < 32) throw new Error('HMAC secretは32文字以上にしてください。');
  PropertiesService.getScriptProperties().setProperty('SMARTWATCH_HEALTH_HMAC_SECRET', hmacSecret.trim());
  ensureHealthSheets_();
  return 'Health ingest configured in Script Properties.';
}

function doPost(event) {
  const receivedAt = new Date();
  const audit = { syncRunId: Utilities.getUuid(), batchId: '', issuedAt: '', receivedAt: receivedAt.toISOString(), status: 'ERROR', counts: [0, 0, 0], errorCode: '', errorMessage: '' };
  let lock = null;
  try {
    const envelope = JSON.parse(event && event.postData && event.postData.contents || '{}');
    const payloadText = String(envelope.payload || '');
    const signature = String(envelope.signature || '').toLowerCase();
    const secret = PropertiesService.getScriptProperties().getProperty('SMARTWATCH_HEALTH_HMAC_SECRET');
    if (!secret) throw healthError_('SERVER_NOT_CONFIGURED', 'Health ingest secret is not configured.');
    if (!payloadText || !constantTimeEqual_(signature, hmacSha256_(payloadText, secret))) throw healthError_('UNAUTHORIZED', 'HMAC signature mismatch.');

    const payload = JSON.parse(payloadText);
    validateHealthBatch_(payload, receivedAt);
    audit.batchId = payload.batch_id;
    audit.issuedAt = payload.issued_at;

    lock = LockService.getScriptLock();
    lock.waitLock(30000);
    ensureHealthSheets_();
    if (hasBatchId_(payload.batch_id)) throw healthError_('DUPLICATE_BATCH', 'batch_id has already been processed.');
    const nonceCache = CacheService.getScriptCache();
    if (nonceCache.get(`health_nonce:${payload.nonce}`)) throw healthError_('NONCE_REUSED', 'nonce has already been used.');
    nonceCache.put(`health_nonce:${payload.nonce}`, '1', 600);

    const healthCount = upsertHealthRows_(LIFE_LOG.sheets.healthDaily, HEALTH_DAILY_HEADERS, 'date_local', payload.health_daily);
    const workoutCount = upsertHealthRows_(LIFE_LOG.sheets.workouts, WORKOUT_HEADERS, 'session_id', payload.workout_sessions);
    const rawCount = upsertHealthRows_(LIFE_LOG.sheets.rawManifest, RAW_MANIFEST_HEADERS, 'archive_id', payload.raw_manifest);
    audit.status = 'SUCCESS';
    audit.counts = [healthCount, workoutCount, rawCount];
    appendSyncAudit_(audit);
    return jsonOutput_({ ok: true, batch_id: payload.batch_id, upserted: { health_daily: healthCount, workout_sessions: workoutCount, raw_manifest: rawCount } });
  } catch (error) {
    audit.errorCode = error.code || 'INTERNAL_ERROR';
    audit.errorMessage = String(error.message || error).slice(0, 500);
    try { ensureHealthSheets_(); appendSyncAudit_(audit); } catch (_) { /* Preserve the original error. */ }
    return jsonOutput_({ ok: false, error: audit.errorCode, message: audit.errorMessage });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Life Log')
    .addItem('初期設定', 'setupLifeLogV2FromMenu')
    .addItem('Timetracker認証を設定', 'promptForTimetrackerTokens')
    .addSeparator().addItem('今すぐ同期', 'syncRecentEntries')
    .addItem('直近14日を再照合', 'reconcileRecentEntries')
    .addItem('集計とJSONを再生成', 'rebuildAll').addToUi();
}

function setupLifeLogV2() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureDataSheets_();
    const form = ensureReflectionForm_();
    installTriggers_();
    rebuildAll();
    return { formUrl: form.getPublishedUrl(), editUrl: form.getEditUrl() };
  } finally { lock.releaseLock(); }
}

function setupLifeLogV2FromMenu() {
  return setupLifeLogV2();
}

function promptForTimetrackerTokens() {
  const ui = SpreadsheetApp.getUi();
  const access = ui.prompt('Timetracker access token', '値はUser Propertiesだけに保存されます。', ui.ButtonSet.OK_CANCEL);
  if (access.getSelectedButton() !== ui.Button.OK) return;
  const refresh = ui.prompt('Timetracker refresh token', '値はUser Propertiesだけに保存されます。', ui.ButtonSet.OK_CANCEL);
  if (refresh.getSelectedButton() !== ui.Button.OK) return;
  configureTimetracker_(access.getResponseText(), refresh.getResponseText());
  ui.alert('認証情報を保存しました。');
}

function configureTimetracker_(accessToken, refreshToken) {
  if (!accessToken || !refreshToken) throw new Error('access tokenとrefresh tokenの両方が必要です。');
  PropertiesService.getUserProperties().setProperties({ TIMETRACKER_ACCESS_TOKEN: accessToken.trim(), TIMETRACKER_REFRESH_TOKEN: refreshToken.trim() });
}

function configureTimetracker(accessToken, refreshToken) {
  configureTimetracker_(accessToken, refreshToken);
  return 'Timetracker credentials stored in User Properties.';
}

function syncRecentEntries() {
  const today = localDayKey_(new Date());
  syncRange_(addDays_(today, -1), addDays_(today, 1));
  rebuildAll();
}

function reconcileRecentEntries() {
  const today = localDayKey_(new Date());
  syncRange_(addDays_(today, -14), addDays_(today, 1));
  rebuildAll();
}

function backfillFromCutover() {
  syncRange_(LIFE_LOG.cutoverDate, addDays_(localDayKey_(new Date()), 1));
  rebuildAll();
}

function syncRange_(startDate, endDate) {
  ensureDataSheets_();
  const entries = timetrackerGet_(`time-tracking/entries/?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`);
  if (!Array.isArray(entries)) throw new Error('Timetracker履歴の応答が配列ではありません。');
  const sheet = getSheet_(LIFE_LOG.sheets.raw);
  const rows = readObjects_(sheet);
  const rowById = new Map(rows.map((row, index) => [String(row.entry_id), index + 2]));
  const returnedIds = new Set();
  const syncedAt = new Date().toISOString();

  entries.forEach(entry => {
    validateEntry_(entry);
    const id = String(entry.id);
    returnedIds.add(id);
    const end = entry.end_time || '';
    const durationSeconds = end ? Math.max(0, Math.round((new Date(end) - new Date(entry.start_time)) / 1000)) : '';
    const values = [[entry.id, entry.activity_id, entry.activity_name, entry.start_time, end, durationSeconds, !end, false, syncedAt]];
    const rowNumber = rowById.get(id);
    if (rowNumber) sheet.getRange(rowNumber, 1, 1, RAW_HEADERS.length).setValues(values);
    else { sheet.appendRow(values[0]); rowById.set(id, sheet.getLastRow()); }
  });

  const rangeStart = dayStart_(startDate);
  const rangeEnd = dayStart_(endDate);
  rows.forEach((row, index) => {
    const start = new Date(row.start_time_utc);
    const end = row.end_time_utc ? new Date(row.end_time_utc) : new Date();
    if (start < rangeEnd && end >= rangeStart && !returnedIds.has(String(row.entry_id))) {
      sheet.getRange(index + 2, 8, 1, 2).setValues([[true, syncedAt]]);
    }
  });
}

function rebuildAll() {
  ensureDataSheets_();
  const actualByDate = aggregateRawEntries_(readObjects_(getSheet_(LIFE_LOG.sheets.raw)), new Date());
  writeActual_(actualByDate);
  const dailyByDate = buildDailyRows_(actualByDate);
  writeDaily_(dailyByDate);
  writeContexts_(dailyByDate);
}

function aggregateRawEntries_(rawRows, now) {
  const result = {};
  rawRows.filter(row => !truthy_(row.is_deleted)).forEach(row => {
    if (!LIFE_LOG.categories.includes(String(row.activity_name))) return;
    const start = new Date(row.start_time_utc);
    const end = row.end_time_utc ? new Date(row.end_time_utc) : now;
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return;
    if (String(row.activity_name) === '睡眠') {
      addSegment_(result, localDayKey_(end), row, start, end, end - start);
      return;
    }
    let cursor = start;
    while (cursor < end) {
      const day = localDayKey_(cursor);
      const segmentEnd = new Date(Math.min(end.getTime(), dayStart_(addDays_(day, 1)).getTime()));
      addSegment_(result, day, row, start, end, segmentEnd - cursor);
      cursor = segmentEnd;
    }
  });
  return result;
}

function addSegment_(result, day, row, originalStart, originalEnd, milliseconds) {
  if (!result[day]) result[day] = { minutes: Object.fromEntries(LIFE_LOG.categories.map(name => [name, 0])), firstStart: originalStart, lastEnd: originalEnd, lastSyncedAt: null, entryIds: new Set() };
  const target = result[day];
  target.minutes[String(row.activity_name)] += milliseconds / 60000;
  if (originalStart < target.firstStart) target.firstStart = originalStart;
  if (originalEnd > target.lastEnd) target.lastEnd = originalEnd;
  const syncedAt = row.synced_at_utc ? new Date(row.synced_at_utc) : null;
  if (syncedAt && Number.isFinite(syncedAt.getTime()) && (!target.lastSyncedAt || syncedAt > target.lastSyncedAt)) target.lastSyncedAt = syncedAt;
  target.entryIds.add(String(row.entry_id));
}

function writeActual_(actualByDate) {
  const sheet = getSheet_(LIFE_LOG.sheets.actual);
  clearData_(sheet, ACTUAL_HEADERS.length);
  const generatedAt = new Date().toISOString();
  const values = Object.keys(actualByDate).sort().map(day => {
    const item = actualByDate[day];
    const minutes = LIFE_LOG.categories.map(name => round1_(item.minutes[name]));
    return [day, ...minutes, round1_(minutes.reduce((sum, value) => sum + value, 0)), item.firstStart.toISOString(), item.lastEnd.toISOString(), item.entryIds.size, round1_((item.lastEnd - item.firstStart) / 60000), generatedAt];
  });
  if (values.length) sheet.getRange(2, 1, values.length, ACTUAL_HEADERS.length).setValues(values);
}

function buildDailyRows_(actualByDate) {
  const reflections = readLatestReflections_();
  const legacy = readLegacyRows_();
  const dates = new Set([...Object.keys(actualByDate), ...Object.keys(reflections), ...Object.keys(legacy)]);
  const generatedAt = new Date().toISOString();
  const result = {};
  [...dates].sort().forEach(day => {
    const actual = actualByDate[day];
    const legacyRow = legacy[day];
    const reflection = reflections[day] || legacyRow || {};
    const minutes = {};
    LIFE_LOG.categories.forEach(name => { minutes[name] = actual ? round1_(actual.minutes[name]) : round1_((legacyRow && legacyRow.minutes[name]) || 0); });
    const quality = [];
    if (!actual && day >= LIFE_LOG.cutoverDate) quality.push('timer_missing');
    if (!reflections[day]) quality.push(legacyRow ? 'legacy_reflection' : 'reflection_missing');
    if (legacyRow && !actual) quality.push('legacy_partial');
    if (actual && (!actual.lastSyncedAt || new Date() - actual.lastSyncedAt > 120 * 60000)) quality.push('sync_stale');
    result[day] = {
      date: day, minutes, trackedMinutes: round1_(Object.values(minutes).reduce((sum, value) => sum + value, 0)),
      completedProgress: reflection.completedProgress || '', tomorrowKeyOutcome: reflection.tomorrowKeyOutcome || '',
      physicalEnergy: numberOrNull_(reflection.physicalEnergy), mood: numberOrNull_(reflection.mood), focus: numberOrNull_(reflection.focus),
      deviationCause: reflection.deviationCause || '', reflection: reflection.reflection || '', notes: reflection.notes || '',
      reflectionSource: reflections[day] ? 'v2' : legacyRow ? 'legacy' : 'none', quality, generatedAt,
      timer: actual ? { firstStartUtc: actual.firstStart.toISOString(), lastEndUtc: actual.lastEnd.toISOString(), lastSyncedAtUtc: actual.lastSyncedAt ? actual.lastSyncedAt.toISOString() : null, entryCount: actual.entryIds.size, calendarSpanMinutes: round1_((actual.lastEnd - actual.firstStart) / 60000) } : { firstStartUtc: null, lastEndUtc: null, lastSyncedAtUtc: null, entryCount: 0, calendarSpanMinutes: 0 }
    };
  });
  return result;
}

function writeDaily_(dailyByDate) {
  const sheet = getSheet_(LIFE_LOG.sheets.daily);
  clearData_(sheet, DAILY_HEADERS.length);
  const values = Object.values(dailyByDate).map(item => [item.date, ...LIFE_LOG.categories.map(name => item.minutes[name]), item.trackedMinutes, item.completedProgress, item.tomorrowKeyOutcome, item.physicalEnergy, item.mood, item.focus, item.deviationCause, item.reflection, item.notes, item.reflectionSource, item.quality.join(','), item.generatedAt]);
  if (values.length) sheet.getRange(2, 1, values.length, DAILY_HEADERS.length).setValues(values);
}

function writeContexts_(dailyByDate) {
  const sheet = getSheet_(LIFE_LOG.sheets.context);
  const existing = readObjects_(sheet);
  const rowByKey = new Map(existing.map((row, index) => [`${row.period_type}:${row.period}`, index + 2]));
  const healthByDate = readHealthDailyByDate_();
  const v1Enabled = PropertiesService.getScriptProperties().getProperty('LIFE_LOG_V1_ENABLED') !== 'false';
  Object.values(dailyByDate).filter(item => item.date >= LIFE_LOG.cutoverDate).forEach(item => {
    if (v1Enabled) upsertContext_(sheet, rowByKey, 'daily', item.date, 'life_log_daily_v1', buildDailyContext_(item));
    upsertContext_(sheet, rowByKey, 'daily_v2', item.date, 'life_log_daily_v2', { ...buildDailyContext_(item), health: healthByDate[item.date] || null });
  });
  const weekly = buildWeeklyContexts_(dailyByDate);
  Object.keys(weekly).sort().forEach(period => {
    if (v1Enabled) upsertContext_(sheet, rowByKey, 'weekly', period, 'life_log_weekly_v1', weekly[period]);
    const healthDays = weekly[period].days.map(day => ({ date_local: day.date, health: healthByDate[day.date] || null }));
    upsertContext_(sheet, rowByKey, 'weekly_v2', period, 'life_log_weekly_v2', { ...weekly[period], health_days: healthDays });
  });
}

function buildDailyContext_(item) {
  return {
    period: { type: 'daily', date: item.date, timezone: LIFE_LOG.timezone },
    time_by_category_minutes: item.minutes, totals: { tracked_minutes: item.trackedMinutes }, timer: item.timer,
    reflection: { completed_progress: item.completedProgress, tomorrow_key_outcome: item.tomorrowKeyOutcome, deviation_cause: item.deviationCause, reflection: item.reflection, notes: item.notes, source: item.reflectionSource },
    state: { physical_energy: item.physicalEnergy, mood: item.mood, focus: item.focus },
    data_quality: { issues: item.quality, complete: item.quality.length === 0 }
  };
}

function buildWeeklyContexts_(dailyByDate) {
  const result = {};
  Object.values(dailyByDate).filter(item => item.date >= LIFE_LOG.cutoverDate).forEach(item => {
    const week = isoWeek_(item.date);
    if (!result[week]) result[week] = { period: { type: 'weekly', iso_week: week, timezone: LIFE_LOG.timezone }, time_by_category_minutes: Object.fromEntries(LIFE_LOG.categories.map(name => [name, 0])), totals: { tracked_minutes: 0, days: 0 }, days: [], data_quality: { issues: [] } };
    const target = result[week];
    LIFE_LOG.categories.forEach(name => { target.time_by_category_minutes[name] += item.minutes[name]; });
    target.totals.tracked_minutes += item.trackedMinutes; target.totals.days += 1;
    target.days.push({ date: item.date, completed_progress: item.completedProgress, state: { physical_energy: item.physicalEnergy, mood: item.mood, focus: item.focus }, deviation_cause: item.deviationCause, data_quality_issues: item.quality });
    target.data_quality.issues.push(...item.quality.map(issue => `${item.date}:${issue}`));
  });
  Object.values(result).forEach(item => {
    LIFE_LOG.categories.forEach(name => { item.time_by_category_minutes[name] = round1_(item.time_by_category_minutes[name]); });
    item.totals.tracked_minutes = round1_(item.totals.tracked_minutes);
    item.data_quality.issues = [...new Set(item.data_quality.issues)];
    item.data_quality.complete = item.data_quality.issues.length === 0 && item.totals.days === 7;
  });
  return result;
}

function upsertContext_(sheet, rowByKey, type, period, schemaVersion, payload) {
  const key = `${type}:${period}`;
  let row = rowByKey.get(key);
  if (!row) { row = Math.max(2, sheet.getLastRow() + 1); rowByKey.set(key, row); }
  const base = { schema_version: schemaVersion, generated_at_utc: new Date().toISOString(), source: { spreadsheet_id: LIFE_LOG.spreadsheetId, sheet: LIFE_LOG.sheets.context, row }, ...payload };
  const sourceHash = sha256_(stableStringify_(base));
  const json = JSON.stringify({ ...base, source_hash: sourceHash }, null, 2);
  sheet.getRange(row, 1, 1, CONTEXT_HEADERS.length).setValues([[type, period, schemaVersion, base.generated_at_utc, sourceHash, json]]);
  writeJsonFile_(type, period, json);
}

function writeJsonFile_(type, period, content) {
  const folder = getOrCreateFolder_(DriveApp.getFolderById(LIFE_LOG.contextFolderId), type);
  const files = folder.getFilesByName(`${period}.json`);
  if (files.hasNext()) {
    files.next().setContent(content);
    while (files.hasNext()) files.next().setTrashed(true);
  } else folder.createFile(`${period}.json`, content, MimeType.PLAIN_TEXT);
}

function readLatestReflections_() {
  const sheet = SpreadsheetApp.openById(LIFE_LOG.spreadsheetId).getSheetByName(LIFE_LOG.sheets.reflection);
  if (!sheet || sheet.getLastRow() < 2) return {};
  const result = {};
  readObjects_(sheet).forEach(row => {
    const day = normalizeSheetDate_(row['日付']);
    if (!day) return;
    result[day] = { completedProgress: row['完了した成果・進捗'] || '', tomorrowKeyOutcome: row['明日の最重要成果'] || '', physicalEnergy: row['体力'], mood: row['気分'], focus: row['集中度'], deviationCause: row['計画逸脱の原因'] || '', reflection: row['振り返り'] || '', notes: row['備考'] || '' };
  });
  return result;
}

function readLegacyRows_() {
  const sheet = getSheet_(LIFE_LOG.sheets.legacy);
  if (sheet.getLastRow() < 2) return {};
  const result = {};
  sheet.getDataRange().getValues().slice(1).forEach(row => {
    const day = normalizeSheetDate_(row[1]);
    if (!day) return;
    result[day] = {
      minutes: { '研究': hoursToMinutes_(row[8]), 'TOEIC': hoursToMinutes_(row[9]), '就活': hoursToMinutes_(row[10]), '仕事': hoursToMinutes_(row[11]), '運動': numeric_(row[12]), '対人・私用': 0, '娯楽': numeric_(row[15]) + numeric_(row[16]) + numeric_(row[17]), '生活': 0, '睡眠': hoursToMinutes_(row[6]) },
      completedProgress: row[14] || '', tomorrowKeyOutcome: row[24] || '', physicalEnergy: numberOrNull_(row[21]), mood: null, focus: null, deviationCause: row[23] || '', reflection: '', notes: row[25] || ''
    };
  });
  return result;
}

function ensureDataSheets_() {
  const spreadsheet = SpreadsheetApp.openById(LIFE_LOG.spreadsheetId);
  ensureSheet_(spreadsheet, LIFE_LOG.sheets.raw, RAW_HEADERS);
  ensureSheet_(spreadsheet, LIFE_LOG.sheets.actual, ACTUAL_HEADERS);
  ensureSheet_(spreadsheet, LIFE_LOG.sheets.daily, DAILY_HEADERS);
  ensureSheet_(spreadsheet, LIFE_LOG.sheets.context, CONTEXT_HEADERS);
}

function ensureHealthSheets_() {
  const spreadsheet = SpreadsheetApp.openById(LIFE_LOG.spreadsheetId);
  ensureSheet_(spreadsheet, LIFE_LOG.sheets.healthDaily, HEALTH_DAILY_HEADERS);
  ensureSheet_(spreadsheet, LIFE_LOG.sheets.workouts, WORKOUT_HEADERS);
  ensureSheet_(spreadsheet, LIFE_LOG.sheets.rawManifest, RAW_MANIFEST_HEADERS);
  ensureSheet_(spreadsheet, LIFE_LOG.sheets.syncAudit, SYNC_AUDIT_HEADERS);
}

function validateHealthBatch_(payload, now) {
  if (!payload || payload.schema_version !== 'health_batch_v1') throw healthError_('INVALID_SCHEMA', 'schema_version must be health_batch_v1.');
  ['batch_id', 'issued_at', 'nonce'].forEach(key => { if (!payload[key] || typeof payload[key] !== 'string') throw healthError_('INVALID_REQUEST', `${key} is required.`); });
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(payload.batch_id)) throw healthError_('INVALID_REQUEST', 'batch_id is invalid.');
  if (!/^[0-9a-fA-F-]{16,64}$/.test(payload.nonce)) throw healthError_('INVALID_REQUEST', 'nonce is invalid.');
  const issuedAt = new Date(payload.issued_at);
  if (!Number.isFinite(issuedAt.getTime()) || Math.abs(now - issuedAt) > 5 * 60000) throw healthError_('STALE_REQUEST', 'issued_at is outside the five-minute window.');
  validateHealthRows_(payload.health_daily, HEALTH_DAILY_HEADERS, 'date_local', 31);
  validateHealthRows_(payload.workout_sessions, WORKOUT_HEADERS, 'session_id', 200);
  validateHealthRows_(payload.raw_manifest, RAW_MANIFEST_HEADERS, 'archive_id', 100);
}

function validateHealthRows_(rows, headers, key, maxRows) {
  if (!Array.isArray(rows) || rows.length > maxRows) throw healthError_('INVALID_REQUEST', `${key} rows are invalid.`);
  const seen = new Set();
  rows.forEach(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw healthError_('INVALID_REQUEST', `${key} row must be an object.`);
    const value = String(row[key] || '');
    if (!value || seen.has(value)) throw healthError_('INVALID_REQUEST', `${key} must be present and unique within a batch.`);
    if (Object.keys(row).some(field => !headers.includes(field))) throw healthError_('INVALID_REQUEST', `${key} row contains an unknown field.`);
    seen.add(value);
  });
}

function upsertHealthRows_(sheetName, headers, key, incoming) {
  if (!incoming.length) return 0;
  const sheet = getSheet_(sheetName);
  const merged = mergeUpsertRows_(readObjects_(sheet), incoming, key);
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  if (merged.length) sheet.getRange(2, 1, merged.length, headers.length).setValues(merged.map(row => headers.map(header => row[header] === null || row[header] === undefined ? '' : row[header])));
  return incoming.length;
}

function mergeUpsertRows_(current, incoming, key) {
  const byKey = new Map(current.map(row => [String(row[key]), { ...row }]));
  incoming.forEach(row => byKey.set(String(row[key]), { ...row }));
  return [...byKey.values()].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

function readHealthDailyByDate_() {
  const sheet = SpreadsheetApp.openById(LIFE_LOG.spreadsheetId).getSheetByName(LIFE_LOG.sheets.healthDaily);
  if (!sheet) return {};
  return Object.fromEntries(readObjects_(sheet).map(row => [normalizeSheetDate_(row.date_local), Object.fromEntries(HEALTH_DAILY_HEADERS.map(header => [header, row[header] === '' ? null : row[header]]))]));
}

function hasBatchId_(batchId) {
  return readObjects_(getSheet_(LIFE_LOG.sheets.syncAudit)).some(row => String(row.batch_id) === batchId && String(row.status) === 'SUCCESS');
}

function appendSyncAudit_(audit) {
  getSheet_(LIFE_LOG.sheets.syncAudit).appendRow([audit.syncRunId, audit.batchId, audit.issuedAt, audit.receivedAt, audit.status, ...audit.counts, audit.errorCode, audit.errorMessage]);
}

function hmacSha256_(payload, secret) {
  return Utilities.computeHmacSha256Signature(payload, secret).map(byte => (byte + 256).toString(16).slice(-2)).join('');
}

function constantTimeEqual_(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function healthError_(code, message) { const error = new Error(message); error.code = code; return error; }
function jsonOutput_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

function ensureSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (current.every(value => value === '')) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  else if (current.some((value, index) => value !== headers[index])) throw new Error(`${name}のヘッダーが想定と異なります。既存データ保護のため停止しました。`);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#eeeeee').setFontWeight('bold');
  return sheet;
}

function ensureReflectionForm_() {
  const properties = PropertiesService.getScriptProperties();
  const existingId = properties.getProperty('REFLECTION_FORM_ID');
  if (existingId) return FormApp.openById(existingId);
  const spreadsheet = SpreadsheetApp.openById(LIFE_LOG.spreadsheetId);
  if (spreadsheet.getSheetByName(LIFE_LOG.sheets.reflection)) throw new Error(`${LIFE_LOG.sheets.reflection}はForm作成前には存在しない必要があります。`);
  const before = new Set(spreadsheet.getSheets().map(sheet => sheet.getSheetId()));
  const form = FormApp.create('Personal Operating System｜Daily Reflection v2');
  form.setDescription('時間はTimetrackerから自動集計されます。意味・理由・成果だけを入力してください。');
  form.addDateItem().setTitle('日付').setRequired(true);
  form.addParagraphTextItem().setTitle('完了した成果・進捗').setRequired(true);
  form.addParagraphTextItem().setTitle('明日の最重要成果').setRequired(true);
  form.addScaleItem().setTitle('体力').setBounds(1, 5).setLabels('低い', '高い').setRequired(true);
  form.addScaleItem().setTitle('気分').setBounds(1, 5).setLabels('低い', '高い').setRequired(true);
  form.addScaleItem().setTitle('集中度').setBounds(1, 5).setLabels('低い', '高い').setRequired(true);
  form.addParagraphTextItem().setTitle('計画逸脱の原因').setRequired(false);
  form.addParagraphTextItem().setTitle('振り返り').setRequired(false);
  form.addParagraphTextItem().setTitle('備考').setRequired(false);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, LIFE_LOG.spreadsheetId);
  SpreadsheetApp.flush();
  let responseSheet = null;
  for (let attempt = 0; attempt < 10 && !responseSheet; attempt += 1) {
    responseSheet = spreadsheet.getSheets().find(sheet => !before.has(sheet.getSheetId()));
    if (!responseSheet) Utilities.sleep(500);
  }
  if (!responseSheet) throw new Error('Reflection Formの回答シートを確認できませんでした。');
  responseSheet.setName(LIFE_LOG.sheets.reflection).setFrozenRows(1);
  properties.setProperties({ REFLECTION_FORM_ID: form.getId(), REFLECTION_FORM_EDIT_URL: form.getEditUrl(), REFLECTION_FORM_RESPONSE_URL: form.getPublishedUrl() });
  return form;
}

function installTriggers_() {
  const handlers = new Set(['syncRecentEntries', 'reconcileRecentEntries', 'onReflectionSubmit']);
  ScriptApp.getProjectTriggers().filter(trigger => handlers.has(trigger.getHandlerFunction())).forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncRecentEntries').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('reconcileRecentEntries').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('onReflectionSubmit').forSpreadsheet(LIFE_LOG.spreadsheetId).onFormSubmit().create();
}

function onReflectionSubmit() { rebuildAll(); }

function timetrackerGet_(endpoint) {
  let response = fetchTimetracker_(endpoint);
  if (response.getResponseCode() === 401) { refreshTimetrackerToken_(); response = fetchTimetracker_(endpoint); }
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error(`Timetracker API error: HTTP ${status}`);
  return JSON.parse(response.getContentText() || 'null');
}

function fetchTimetracker_(endpoint) {
  const token = PropertiesService.getUserProperties().getProperty('TIMETRACKER_ACCESS_TOKEN');
  if (!token) throw new Error('Life LogメニューからTimetracker認証を設定してください。');
  return UrlFetchApp.fetch(LIFE_LOG.apiBase + endpoint, { method: 'get', muteHttpExceptions: true, headers: { Authorization: `Bearer ${token}`, 'X-Client-Type': 'macos', 'X-Client-Version': '2.3.1' } });
}

function refreshTimetrackerToken_() {
  const properties = PropertiesService.getUserProperties();
  const refresh = properties.getProperty('TIMETRACKER_REFRESH_TOKEN');
  if (!refresh) throw new Error('Timetracker refresh tokenがありません。');
  const response = UrlFetchApp.fetch(LIFE_LOG.apiBase + 'token/refresh/', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ refresh }) });
  if (response.getResponseCode() !== 200) throw new Error(`Timetracker token refresh error: HTTP ${response.getResponseCode()}`);
  const tokens = JSON.parse(response.getContentText());
  if (!tokens.access) throw new Error('Timetracker token refresh responseにaccess tokenがありません。');
  properties.setProperty('TIMETRACKER_ACCESS_TOKEN', tokens.access);
  if (tokens.refresh) properties.setProperty('TIMETRACKER_REFRESH_TOKEN', tokens.refresh);
}

function getSheet_(name) {
  const sheet = SpreadsheetApp.openById(LIFE_LOG.spreadsheetId).getSheetByName(name);
  if (!sheet) throw new Error(`Sheetがありません: ${name}`);
  return sheet;
}
function readObjects_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(value => value !== '')).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}
function clearData_(sheet, width) { if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, width).clearContent(); }
function validateEntry_(entry) { ['id', 'activity_id', 'activity_name', 'start_time'].forEach(key => { if (entry[key] === undefined || entry[key] === null || entry[key] === '') throw new Error(`Timetracker entryに${key}がありません。`); }); }
function getOrCreateFolder_(parent, name) { const folders = parent.getFoldersByName(name); return folders.hasNext() ? folders.next() : parent.createFolder(name); }
function stableStringify_(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify_).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify_(value[key])}`).join(',')}}`;
}
function sha256_(text) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map(byte => (byte + 256).toString(16).slice(-2)).join(''); }
function localDayKey_(date) { return Utilities.formatDate(date, LIFE_LOG.timezone, 'yyyy-MM-dd'); }
function dayStart_(day) { return new Date(`${day}T00:00:00${LIFE_LOG.utcOffset}`); }
function addDays_(day, amount) { const date = dayStart_(day); date.setUTCDate(date.getUTCDate() + amount); return localDayKey_(date); }
function normalizeSheetDate_(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return localDayKey_(value);
  const match = String(value || '').match(/^(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/);
  return match ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}` : '';
}
function isoWeek_(day) {
  const date = new Date(`${day}T12:00:00Z`); const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil((((date - yearStart) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}
function truthy_(value) { return value === true || String(value).toLowerCase() === 'true'; }
function numeric_(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function hoursToMinutes_(value) { return numeric_(value) * 60; }
function numberOrNull_(value) { const number = Number(value); return Number.isFinite(number) && value !== '' ? number : null; }
function round1_(value) { return Math.round((Number(value) || 0) * 10) / 10; }
