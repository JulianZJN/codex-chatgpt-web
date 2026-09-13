const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(relative) {
  const filename = path.resolve(__dirname, '../src', relative);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  const module = { exports: {} };
  Function('module', 'exports', 'require', output)(module, module.exports, (id) =>
    id.startsWith('.') ? load(`${id.replace('./', '')}${id.endsWith('.tsx') ? '' : '.ts'}`) : require(id));
  return module.exports;
}
const { UsageStatisticsView } = load('UsageStatistics.tsx');
const tiers = ['instant', 'medium', 'high', 'extraHigh', 'pro5_5', 'pro5_6', 'pro6', 'proUnknown', 'luna', 'think', 'manualUnknown'];
function fixture(status = 'ready') {
  const daily = Object.fromEntries(tiers.map((tier) => [tier, { accepted: 0, completed: 0, error: 0 }]));
  daily.pro5_6 = { accepted: 3, completed: 2, error: 1 };
  daily.pro6 = { accepted: 7, completed: 6, error: 0 };
  daily.proUnknown = { accepted: 11, completed: 0, error: 0 };
  return { status, timezone: 'Asia/Taipei', recordedSince: '2026-09-01T00:00:00Z',
    range: { days: 7, startDay: '2026-09-07', endDay: '2026-09-13', dayBoundary: 'local-calendar', weekStartsOn: 'monday' },
    days: status === 'ready' ? [{ day: '2026-09-13', tiers: daily }] : [],
    today5_6Pro: { day: '2026-09-13', accepted: 3, completed: 2, error: 1 },
    week6Pro: { startDay: '2026-09-07', endDay: '2026-09-13', weekStartsOn: 'monday', accepted: 7, completed: 6, error: 0 },
    proLifetime: [{version: 'unknown', source: 'self-reported', accepted: 11, completed: 0, error: 0, firstRecordedAt:'2026-09-13T00:00:00Z', lastRecordedAt:'2026-09-13T00:00:00Z'}], warnings: [] };
}
function render(data, language = 'en', loading = false) {
  return renderToStaticMarkup(React.createElement(UsageStatisticsView, { data, language, loading, days: 7, onDaysChange() {}, onRefresh() {} }));
}
test('accepted total includes unfinished and failed messages, with separate exact Pro cards', () => {
  const html = render(fixture());
  assert.match(html, /data-usage-total="21"/);
  assert.match(html, /data-pro-card="5.6"[^>]*>[\s\S]*?data-accepted="3"/);
  assert.match(html, /data-pro-card="6"[^>]*>[\s\S]*?data-accepted="7"/);
  assert.match(html, /data-tier="proUnknown"/);
  assert.match(html, /data-tier="pro5_6"/);
  assert.match(html, /data-tier="pro6"/);
});
test('unreadable and loading states never present plausible zero totals or exact cards', () => {
  for (const html of [render(fixture('unreadable')), render(fixture('error')), render(null, 'en', true)]) {
    assert.doesNotMatch(html, /data-usage-total=|data-pro-card=/);
    assert.match(html, /role="(?:status|alert)"/);
  }
});
test('empty state explains collection scope without drawing a misleading zero history', () => {
  const html = render(fixture('empty'));
  assert.match(html, /No local usage recorded yet/);
  assert.doesNotMatch(html, /data-usage-total=|<svg/);
});
test('chart has keyboard data access and a non-color table alternative', () => {
  const html = render(fixture());
  assert.match(html, /tabindex="0"/);
  assert.match(html, /<summary>Daily details<\/summary>/);
  assert.match(html, /<th scope="col">Completed<\/th>/);
  assert.match(html, /Self-reported/);
  assert.match(html, /not official remaining quota/);
});
test('all supported languages render localized usage states and headings', () => {
  assert.match(render(fixture(), 'zh-CN'), /本地用量/);
  assert.match(render(fixture(), 'ja'), /ローカル使用量/);
  assert.match(render(fixture('unreadable'), 'zh-CN'), /无法读取/);
  assert.match(render(fixture('empty'), 'ja'), /まだ記録されていません/);
});
test('lifetime table keeps absent versions visible without inventing observed provenance', () => {
  const html = render(fixture());
  assert.match(html, /<th scope="row">GPT-5.5 Pro<\/th><td>—<\/td><td>0<\/td>/);
  assert.match(html, /<th scope="row">GPT-5.6 Pro<\/th><td>—<\/td><td>0<\/td>/);
  assert.match(html, /<th scope="row">GPT-6 Pro<\/th><td>—<\/td><td>0<\/td>/);
});
test('independent unknown provenance rows are retained, and every chart count tick is an integer', () => {
  const data = fixture();
  data.proLifetime.push({ ...data.proLifetime[0], source: 'unknown', accepted: 2 });
  const html = render(data);
  assert.match(html, /<td>Self-reported<\/td><td>11<\/td>/);
  assert.match(html, /<td>Unknown<\/td><td>2<\/td>/);
  for (const match of html.matchAll(/class="usage-axis" x="29"[^>]*>([^<]*)</g)) {
    assert.equal(Number.isInteger(Number(match[1])), true);
  }
});
test('changing ranges never labels an old response as the newly selected period', () => {
  const html = renderToStaticMarkup(React.createElement(UsageStatisticsView, { data: fixture(), language: 'en', loading: false, days: 30, onDaysChange() {}, onRefresh() {} }));
  assert.doesNotMatch(html, /data-usage-total=|data-pro-card=/);
});
test('synthetic preview keeps the same daily messages and exact Pro cards across range changes', () => {
  const buildFixture = load('../tests/usage-ui.fixture-data.ts').fixture;
  const short = buildFixture(7, 'ready');
  const long = buildFixture(30, 'ready');
  assert.equal(short.days.length, 7);
  assert.equal(long.days.length, 30);
  assert.deepEqual(short.days, long.days.slice(-7));
  assert.deepEqual(short.today5_6Pro, long.today5_6Pro);
  assert.deepEqual(short.week6Pro, long.week6Pro);
  assert.deepEqual(short.proLifetime, long.proLifetime);
});
test('synthetic preview cards and lifetime rows reconcile with its visible daily records', () => {
  const data = load('../tests/usage-ui.fixture-data.ts').fixture(30, 'ready');
  const today = data.days.find((day) => day.day === '2026-09-13');
  const week = data.days.filter((day) => day.day >= '2026-09-07');
  for (const field of ['accepted', 'completed', 'error']) {
    assert.equal(data.today5_6Pro[field], today.tiers.pro5_6[field]);
    assert.equal(data.week6Pro[field], week.reduce((total, day) => total + day.tiers.pro6[field], 0));
    for (const [version, tier] of [['5.5', 'pro5_5'], ['5.6', 'pro5_6'], ['6', 'pro6'], ['unknown', 'proUnknown']]) {
      assert.equal(data.proLifetime.find((row) => row.version === version)[field], data.days.reduce((total, day) => total + day.tiers[tier][field], 0));
    }
  }
});
test('30-day date ticks leave room for the final endpoint instead of labelling adjacent bars', () => {
  const data = load('../tests/usage-ui.fixture-data.ts').fixture(30, 'ready');
  const html = renderToStaticMarkup(React.createElement(UsageStatisticsView, { data, language: 'en', loading: false, days: 30, onDaysChange() {}, onRefresh() {} }));
  const dateLabels = [...html.matchAll(/class="usage-axis"[^>]*>([^<]+)<\/text>/g)]
    .map((match) => match[1]).filter((label) => /[A-Za-z]/.test(label));
  assert.deepEqual(dateLabels, ['Aug 15', 'Aug 22', 'Aug 29', 'Sep 5', 'Sep 13']);
});
