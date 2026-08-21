const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const sandbox = {
  console,
  Utilities: {
    formatDate(date) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
      const part = type => parts.find(item => item.type === type).value;
      return `${part('year')}-${part('month')}-${part('day')}`;
    },
    computeDigest(_algorithm, text) { return [...crypto.createHash('sha256').update(text).digest()].map(value => value > 127 ? value - 256 : value); },
    computeHmacSha256Signature(text, secret) { return [...crypto.createHmac('sha256', secret).update(text).digest()].map(value => value > 127 ? value - 256 : value); },
    getUuid() { return crypto.randomUUID(); },
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' }
  }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), sandbox);

function assert(condition, message) { if (!condition) throw new Error(message); }
function row(id, name, start, end) { return { entry_id: id, activity_name: name, start_time_utc: start, end_time_utc: end, is_deleted: false }; }

const split = sandbox.aggregateRawEntries_([row(1, '研究', '2026-08-17T14:30:00Z', '2026-08-17T15:30:00Z')], new Date('2026-08-18T00:00:00Z'));
assert(split['2026-08-17'].minutes['研究'] === 30, 'normal entry before midnight');
assert(split['2026-08-18'].minutes['研究'] === 30, 'normal entry after midnight');

const sleep = sandbox.aggregateRawEntries_([row(2, '睡眠', '2026-08-17T14:30:00Z', '2026-08-17T22:30:00Z')], new Date('2026-08-18T00:00:00Z'));
assert(!sleep['2026-08-17'], 'sleep must not be split');
assert(sleep['2026-08-18'].minutes['睡眠'] === 480, 'sleep belongs to wake date');

const canonicalA = sandbox.stableStringify_({ b: 2, a: { d: 4, c: 3 } });
const canonicalB = sandbox.stableStringify_({ a: { c: 3, d: 4 }, b: 2 });
assert(canonicalA === canonicalB, 'canonical JSON must ignore key insertion order');
assert(sandbox.sha256_(canonicalA).length === 64, 'source hash must be SHA-256');
assert(sandbox.isoWeek_('2026-08-17') === '2026-W34', 'ISO week');

assert(sandbox.hmacSha256_('The quick brown fox jumps over the lazy dog', 'key') === 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', 'HMAC-SHA256');
assert(sandbox.constantTimeEqual_('abc', 'abc'), 'constant-time equality accepts an equal signature');
assert(!sandbox.constantTimeEqual_('abc', 'abd'), 'constant-time equality rejects a different signature');

const issuedAt = new Date('2026-08-21T06:00:00Z');
const validHealthBatch = {
  schema_version: 'health_batch_v1', batch_id: 'health-12345678', issued_at: issuedAt.toISOString(), nonce: '12345678-1234-1234-1234-123456789012',
  health_daily: [{ date_local: '2026-08-21', steps_watch: 1000 }], workout_sessions: [], raw_manifest: []
};
sandbox.validateHealthBatch_(validHealthBatch, issuedAt);
assertThrows(() => sandbox.validateHealthBatch_({ ...validHealthBatch, issued_at: '2026-08-20T00:00:00Z' }, issuedAt), 'stale health batch');
assertThrows(() => sandbox.validateHealthBatch_({ ...validHealthBatch, health_daily: [{ date_local: '2026-08-21', unknown: 1 }] }, issuedAt), 'unknown health field');

const merged = sandbox.mergeUpsertRows_([{ date_local: '2026-08-20', steps_watch: 10 }, { date_local: '2026-08-21', steps_watch: 20 }], [{ date_local: '2026-08-21', steps_watch: 30 }], 'date_local');
assert(merged.length === 2 && merged[1].steps_watch === 30, 'health upsert replaces by primary key without duplicating');

const secret = '0123456789abcdef0123456789abcdef';
const nonceCache = new Map();
const completedBatches = new Set();
const audits = [];
let failSheet = '';
sandbox.PropertiesService = { getScriptProperties: () => ({ getProperty: key => key === 'SMARTWATCH_HEALTH_HMAC_SECRET' ? secret : null }) };
sandbox.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
sandbox.CacheService = { getScriptCache: () => ({ get: key => nonceCache.get(key), put: (key, value) => nonceCache.set(key, value) }) };
sandbox.ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: text => ({ text, setMimeType() { return this; } })
};
sandbox.ensureHealthSheets_ = () => {};
sandbox.hasBatchId_ = batchId => completedBatches.has(batchId);
sandbox.upsertHealthRows_ = (sheetName, _headers, _key, rows) => {
  if (sheetName === failSheet) throw new Error('simulated partial write failure');
  return rows.length;
};
sandbox.appendSyncAudit_ = audit => {
  audits.push({ ...audit });
  if (audit.status === 'SUCCESS') completedBatches.add(audit.batchId);
};

const nonce = crypto.randomUUID();
const acceptedBatch = { ...validHealthBatch, batch_id: 'health-accepted-1', issued_at: new Date().toISOString(), nonce };
const accepted = postHealth(acceptedBatch);
assert(accepted.ok && accepted.upserted.health_daily === 1, 'valid health batch is accepted');
const replayed = postHealth({ ...acceptedBatch, issued_at: new Date().toISOString(), nonce: crypto.randomUUID() });
assert(!replayed.ok && replayed.error === 'DUPLICATE_BATCH', 'successful batch replay is rejected without another upsert');
const reusedNonce = postHealth({ ...acceptedBatch, batch_id: 'health-new-batch-2', issued_at: new Date().toISOString() });
assert(!reusedNonce.ok && reusedNonce.error === 'NONCE_REUSED', 'nonce reuse is rejected');

failSheet = 'workout_sessions';
const partial = postHealth({
  ...acceptedBatch,
  batch_id: 'health-partial-3',
  issued_at: new Date().toISOString(),
  nonce: crypto.randomUUID(),
  workout_sessions: [{ session_id: 'workout-1' }]
});
assert(!partial.ok && partial.error === 'INTERNAL_ERROR', 'partial failure is returned as an error');
assert(audits.at(-1).status === 'ERROR', 'partial failure is recorded in sync audit');

console.log('Life Log self-check passed');

function postHealth(payload) {
  const payloadText = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(payloadText).digest('hex');
  return JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ payload: payloadText, signature }) } }).text);
}

function assertThrows(block, message) {
  let threw = false;
  try { block(); } catch (_) { threw = true; }
  assert(threw, message);
}
