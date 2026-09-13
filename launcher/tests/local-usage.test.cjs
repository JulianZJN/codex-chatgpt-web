const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getUsageStatistics } = require("../electron/local-usage.cjs");

const roots = [];

test.afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const coreHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-launcher-local-usage-"));
  roots.push(coreHome);
  const filePath = path.join(coreHome, "usage", "local-usage.json");
  return { coreHome, filePath };
}

function writeStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    version: 1,
    recordedSince: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-10T12:01:00.000Z",
    timezones: ["UTC"],
    days: [
      { day: "2026-09-06", tiers: { pro6: { accepted: 3, completed: 3, error: 0 } } },
      { day: "2026-09-07", tiers: { pro6: { accepted: 1, completed: 0, error: 1 } } },
      {
        day: "2026-09-10",
        tiers: {
          instant: { accepted: 1, completed: 0, error: 0 },
          pro5_6: { accepted: 2, completed: 2, error: 0 },
        },
      },
    ],
    proLifetime: [
      {
        version: "5.6",
        source: "observed",
        accepted: 2,
        completed: 2,
        error: 0,
        firstRecordedAt: "2026-09-10T11:00:00.000Z",
        lastRecordedAt: "2026-09-10T12:01:00.000Z",
      },
      {
        version: "6",
        source: "observed",
        accepted: 4,
        completed: 3,
        error: 1,
        firstRecordedAt: "2026-09-06T12:00:00.000Z",
        lastRecordedAt: "2026-09-07T12:01:00.000Z",
      },
    ],
    receipts: [],
  })}\n`);
}

test("missing local usage storage is an explicit empty range, not an unreadable zero", () => {
  const { coreHome } = fixture();
  const result = getUsageStatistics({
    coreHome,
    input: { days: 7 },
    now: Date.parse("2026-09-10T12:00:00.000Z"),
    timeZone: "UTC",
  });

  assert.equal(result.status, "empty");
  assert.deepEqual(result.range, {
    days: 7,
    startDay: "2026-09-04",
    endDay: "2026-09-10",
    dayBoundary: "local-calendar",
    weekStartsOn: "monday",
  });
  assert.equal(result.days.length, 7);
  assert.deepEqual(result.days.at(-1).tiers.pro5_6, { accepted: 0, completed: 0, error: 0 });
  assert.deepEqual(result.warnings, []);
});

test("launcher projects daily tiers, exact Pro cards, and lifetime rows from the private store", () => {
  const { coreHome, filePath } = fixture();
  writeStore(filePath);

  const result = getUsageStatistics({
    coreHome,
    input: { days: 7 },
    now: Date.parse("2026-09-10T12:30:00.000Z"),
    timeZone: "UTC",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.recordedSince, "2026-09-06T12:00:00.000Z");
  assert.deepEqual(result.days.at(-1).tiers.instant, { accepted: 1, completed: 0, error: 0 });
  assert.deepEqual(result.today5_6Pro, {
    day: "2026-09-10",
    accepted: 2,
    completed: 2,
    error: 0,
  });
  assert.deepEqual(result.week6Pro, {
    startDay: "2026-09-07",
    endDay: "2026-09-13",
    weekStartsOn: "monday",
    accepted: 1,
    completed: 0,
    error: 1,
  });
  assert.deepEqual(result.proLifetime.map(({ version, source, accepted }) => ({ version, source, accepted })), [
    { version: "5.6", source: "observed", accepted: 2 },
    { version: "6", source: "observed", accepted: 4 },
  ]);
});

test("corrupt local usage storage is unreadable and never rendered as zero usage", () => {
  const { coreHome, filePath } = fixture();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "{not json");

  const result = getUsageStatistics({
    coreHome,
    input: { days: 30 },
    now: Date.parse("2026-09-10T12:00:00.000Z"),
    timeZone: "UTC",
  });

  assert.equal(result.status, "unreadable");
  assert.deepEqual(result.days, []);
  assert.match(result.warnings[0], /could not be read/);
});

test("launcher IPC reader accepts only the two renderer-supported ranges", () => {
  const { coreHome } = fixture();
  assert.throws(() => getUsageStatistics({ coreHome, input: { days: 3 } }), /7 or 30 days/);
  assert.throws(() => getUsageStatistics({ coreHome, input: null }), /7 or 30 days/);
});

test("Electron main and preload expose the local usage reader on one scoped IPC channel", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.cjs"), "utf8");
  assert.match(main, /handle\("launcher:usage-statistics"/);
  assert.match(main, /getUsageStatistics\(\{ coreHome: CORE_HOME, input \}\)/);
  assert.match(preload, /getUsageStatistics:\s*\(input\)\s*=>\s*ipcRenderer\.invoke\("launcher:usage-statistics", input\)/);
});
