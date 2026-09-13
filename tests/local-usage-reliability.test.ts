import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { LocalUsageAttempt, LocalUsageStore, LOCAL_USAGE_MAX_BYTES, readLocalUsageStatistics,
  type LocalUsageDescriptor } from "../src/usage/local-usage";
const { readLocalUsageStatistics: readLauncherStatistics } = createRequire(import.meta.url)("../launcher/electron/local-usage.cjs");

const instant: LocalUsageDescriptor = { tier: "instant", proVersion: null, source: "unknown" };
const acceptedAt = Date.parse("2026-09-13T06:00:00.000Z");

for (const outcome of ["completed", "error"] as const) {
  test(`a failed ${outcome} write retries the original outcome, not the cleanup outcome`, () => {
    const writes: Array<{ outcome: string; outcomeAt: number }> = [];
    const attempt = new LocalUsageAttempt({
      recordAccepted() {},
      recordOutcome(input) {
        writes.push({ outcome: input.outcome, outcomeAt: input.outcomeAt });
        if (writes.length === 1) throw new Error("temporary write failure");
      },
    }, { attemptId: `terminal-${outcome}` });

    attempt.accept("final", instant, acceptedAt);
    if (outcome === "completed") attempt.complete("final", acceptedAt + 1_000);
    else attempt.failPending(acceptedAt + 1_000);
    if (outcome === "completed") attempt.failPending(acceptedAt + 2_000);
    else attempt.complete("final", acceptedAt + 2_000);
    attempt.failPending(acceptedAt + 3_000);
    attempt.complete("final", acceptedAt + 4_000);

    assert.deepEqual(writes, [
      { outcome, outcomeAt: acceptedAt + 1_000 },
      { outcome, outcomeAt: acceptedAt + 1_000 },
    ]);
  });
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "usage-reliability-"));
  roots.push(root);
  const filePath = join(root, "usage", "local-usage.json");
  const store = new LocalUsageStore({ filePath, timeZone: "UTC" });
  const input = { id: "message-1", acceptedAt, ...instant };
  const options = { days: 7, now: acceptedAt + 10_000, timeZone: "UTC" };
  function read() {
    const core = readLocalUsageStatistics(filePath, options);
    assert.deepEqual(readLauncherStatistics(filePath, options), core);
    return core;
  }
  return { root, filePath, store, input, read };
}

test("the backup is the previous validated snapshot, including deduplication receipts", () => {
  const { filePath, store, input, read } = fixture();
  store.recordAccepted(input);
  const first = readFileSync(filePath, "utf8");
  store.recordOutcome({ ...input, outcome: "completed", outcomeAt: acceptedAt + 1_000 });
  assert.equal(readFileSync(`${filePath}.bak`, "utf8"), first);
  assert.equal(JSON.parse(first).receipts[0].id, input.id);
  assert.deepEqual(read().days.at(-1)?.tiers.instant, { accepted: 1, completed: 1, error: 0 });
  if (process.platform !== "win32") {
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
    assert.equal(statSync(`${filePath}.bak`).mode & 0o777, 0o600);
  }
});

test("restarts retain the v1 store, its receipt horizon and acceptance-day attribution", () => {
  const { filePath, store, input, read } = fixture();
  store.recordAccepted(input);
  const legacy = JSON.parse(readFileSync(filePath, "utf8"));
  delete legacy.receiptHorizon;
  const original = `${JSON.stringify(legacy)}\n`;
  writeFileSync(filePath, original);
  const restarted = new LocalUsageStore({ filePath, timeZone: "UTC" });
  restarted.recordOutcome({ ...input, outcome: "completed", outcomeAt: acceptedAt + 1_000 });
  assert.equal(readFileSync(`${filePath}.bak`, "utf8"), original);
  const persisted = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.receiptHorizon, null);
  assert.equal(persisted.recordedSince, new Date(acceptedAt).toISOString());
  restarted.recordAccepted(input);
  assert.deepEqual(read().days.at(-1)?.tiers.instant, { accepted: 1, completed: 1, error: 0 });
});

for (const kind of ["corrupt", "newer", "oversized", "invalid tier"] as const) {
  test(`${kind} stores are preserved without overwriting the last good backup`, () => {
    const { filePath, store, input, read } = fixture();
    store.recordAccepted(input);
    store.recordOutcome({ ...input, outcome: "completed", outcomeAt: acceptedAt + 1_000 });
    const backup = readFileSync(`${filePath}.bak`, "utf8");
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    let contents: string;
    if (kind === "corrupt") contents = "{truncated";
    else if (kind === "oversized") contents = " ".repeat(LOCAL_USAGE_MAX_BYTES + 1);
    else {
      if (kind === "newer") value.version = 2;
      else value.days[0].tiers.futureTier = { accepted: 1, completed: 0, error: 0 };
      contents = JSON.stringify(value);
    }
    writeFileSync(filePath, contents);
    const stats = read();
    assert.equal(stats.status, "unreadable");
    assert.equal(stats.days.length, 0);
    if (kind === "newer") assert.match(stats.warnings.join(" "), /newer version/);
    assert.throws(() => store.recordAccepted({ ...input, id: "message-2" }));
    assert.equal(readFileSync(filePath, "utf8"), contents);
    assert.equal(readFileSync(`${filePath}.bak`, "utf8"), backup);
    assert.equal(existsSync(`${filePath}.lock`), false);
  });
}

test("a missing primary with an existing backup is not treated as a new installation", () => {
  const { filePath, store, input, read } = fixture();
  store.recordAccepted(input);
  store.recordOutcome({ ...input, outcome: "completed", outcomeAt: acceptedAt + 1_000 });
  const backup = readFileSync(`${filePath}.bak`, "utf8");
  rmSync(filePath);
  assert.equal(read().status, "unreadable");
  assert.throws(() => store.recordAccepted({ ...input, id: "message-2" }), /recover the backup/);
  assert.equal(existsSync(filePath), false);
  assert.equal(readFileSync(`${filePath}.bak`, "utf8"), backup);
});

test("read permission failures are not treated as missing usage or overwritten", {
  skip: process.platform === "win32" || process.getuid?.() === 0,
}, () => {
  const { filePath, store, input, read } = fixture();
  store.recordAccepted(input);
  const original = readFileSync(filePath, "utf8");
  chmodSync(filePath, 0o000);
  try {
    const result = read();
    assert.equal(result.status, "unreadable");
    assert.equal(result.days.length, 0);
    assert.throws(() => store.recordAccepted({ ...input, id: "message-2" }), {
      code: "EACCES",
    });
    assert.equal(existsSync(`${filePath}.bak`), false);
  } finally {
    chmodSync(filePath, 0o600);
  }
  assert.equal(readFileSync(filePath, "utf8"), original);
});

test("a backup-write failure leaves the primary untouched and does not fail the model attempt", () => {
  const { filePath, store, input, read } = fixture();
  store.recordAccepted(input);
  const original = readFileSync(filePath, "utf8");
  mkdirSync(`${filePath}.bak`);
  assert.throws(() => store.recordAccepted({ ...input, id: "message-2" }));
  const attempt = new LocalUsageAttempt(store, { attemptId: "storage-unavailable" });
  assert.doesNotThrow(() => {
    attempt.accept("final", instant, acceptedAt);
    attempt.complete("final", acceptedAt + 1_000);
  });
  assert.equal(readFileSync(filePath, "utf8"), original);
  assert.equal(read().days.at(-1)?.tiers.instant.accepted, 1);
  assert.equal(existsSync(`${filePath}.lock`), false);
});

test("duplicate acceptance and outcome callbacks leave both snapshots untouched", () => {
  const { filePath, store, input } = fixture();
  const outcome = { ...input, outcome: "completed" as const, outcomeAt: acceptedAt + 1_000 };
  store.recordAccepted(input);
  store.recordOutcome(outcome);
  const primary = readFileSync(filePath, "utf8");
  const backup = readFileSync(`${filePath}.bak`, "utf8");
  const at = new Date("2020-01-01T00:00:00Z");
  utimesSync(filePath, at, at);
  utimesSync(`${filePath}.bak`, at, at);
  store.recordAccepted(input);
  store.recordOutcome(outcome);
  assert.equal(readFileSync(filePath, "utf8"), primary);
  assert.equal(readFileSync(`${filePath}.bak`, "utf8"), backup);
  assert.equal(statSync(filePath).mtimeMs, at.getTime());
  assert.equal(statSync(`${filePath}.bak`).mtimeMs, at.getTime());
});

test("invalid runtime descriptors cannot poison a valid store", () => {
  const { filePath, store, input, read } = fixture();
  store.recordAccepted(input);
  const original = readFileSync(filePath, "utf8");
  assert.throws(() => store.recordAccepted({ ...input, id: "invalid", tier: "not-a-tier" as never }));
  assert.equal(readFileSync(filePath, "utf8"), original);
  assert.equal(read().status, "ready");
});

test("a live writer keeps its lock even when its mtime is old", () => {
  const { filePath, store, input } = fixture();
  store.recordAccepted(input);
  const original = readFileSync(filePath, "utf8");
  writeFileSync(`${filePath}.lock`, JSON.stringify({ pid: process.pid }));
  const at = new Date(Date.now() - 60_000);
  utimesSync(`${filePath}.lock`, at, at);
  assert.throws(() => store.recordAccepted({ ...input, id: "message-2" }), /busy/);
  assert.equal(readFileSync(filePath, "utf8"), original);
  assert.equal(JSON.parse(readFileSync(`${filePath}.lock`, "utf8")).pid, process.pid);
  assert.equal(existsSync(`${filePath}.lock.reap`), false);
});

test("an abandoned writer lock can be recovered after its owner has exited", () => {
  const { filePath, store, input, read } = fixture();
  store.recordAccepted(input);
  const child = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  assert.equal(child.status, 0);
  assert.ok(child.pid > 0);
  writeFileSync(`${filePath}.lock`, JSON.stringify({ pid: child.pid }));
  const at = new Date(Date.now() - 60_000);
  utimesSync(`${filePath}.lock`, at, at);
  store.recordAccepted({ ...input, id: "message-2" });
  assert.equal(read().days.at(-1)?.tiers.instant.accepted, 2);
  assert.equal(existsSync(`${filePath}.lock`), false);
  assert.equal(existsSync(`${filePath}.lock.reap`), false);
});

for (const contents of ["", "{broken", '{"pid":0}']) {
  test(`an unverifiable lock owner is not removed: ${JSON.stringify(contents)}`, () => {
    const { filePath, store, input } = fixture();
    store.recordAccepted(input);
    writeFileSync(`${filePath}.lock`, contents);
    const at = new Date(Date.now() - 60_000);
    utimesSync(`${filePath}.lock`, at, at);
    assert.throws(() => store.recordAccepted({ ...input, id: "message-2" }), /busy/);
    assert.equal(readFileSync(`${filePath}.lock`, "utf8"), contents);
  });
}

test("a late outcome does not recreate an expired day with more completions than acceptances", () => {
  const { filePath, store, input, read } = fixture();
  store.recordAccepted(input);
  const persisted = JSON.parse(readFileSync(filePath, "utf8"));
  // Model a retained receipt whose calendar bucket has already aged out.
  persisted.days = [];
  writeFileSync(filePath, JSON.stringify(persisted));
  store.recordOutcome({ ...input, outcome: "completed", outcomeAt: acceptedAt + 1_000 });
  assert.equal(read().status, "ready");
  assert.equal(JSON.parse(readFileSync(filePath, "utf8")).days.length, 0);
});

test("out-of-order Pro acceptances keep the earliest lifetime timestamp", () => {
  const { filePath, store, input, read } = fixture();
  const pro = { tier: "pro6", proVersion: "6", source: "observed" } as const;
  store.recordAccepted({ ...input, ...pro });
  store.recordAccepted({ ...input, ...pro, id: "earlier", acceptedAt: acceptedAt - 1_000 });
  assert.equal(read().proLifetime[0]?.firstRecordedAt, new Date(acceptedAt - 1_000).toISOString());
  assert.equal(JSON.parse(readFileSync(filePath, "utf8")).version, 1);
});
