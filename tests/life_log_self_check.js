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

console.log('Life Log self-check passed');
