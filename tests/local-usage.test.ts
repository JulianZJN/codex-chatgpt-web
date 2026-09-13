import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalUsageAttempt,
  LocalUsageStore,
  parseObservedChatGptProVersion,
  readLocalUsageStatistics,
  usageDescriptorForAutomaticMode,
  usageDescriptorForManualMode,
  type LocalUsageDescriptor,
} from "../src/usage/local-usage";

const require = createRequire(import.meta.url);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(timeZone = "UTC") {
  const root = mkdtempSync(join(tmpdir(), "codex-local-usage-"));
  roots.push(root);
  const filePath = join(root, "usage", "local-usage.json");
  return { root, filePath, store: new LocalUsageStore({ filePath, timeZone }) };
}

const instant: LocalUsageDescriptor = {
  tier: "instant",
  proVersion: null,
  source: "unknown",
};

const pro56: LocalUsageDescriptor = {
  tier: "pro5_6",
  proVersion: "5.6",
  source: "observed",
};

const pro6: LocalUsageDescriptor = {
  tier: "pro6",
  proVersion: "6",
  source: "observed",
};

test("pre-send retries record nothing, duplicate callbacks record once, and a new accepted retry records separately", () => {
  const { filePath, store } = fixture();
  const first = new LocalUsageAttempt(store, { attemptId: "attempt-first" });

  first.failPending(Date.parse("2026-09-10T08:00:00.000Z"));
  expect(readLocalUsageStatistics(filePath, {
    days: 7,
    now: Date.parse("2026-09-10T12:00:00.000Z"),
    timeZone: "UTC",
  }).status).toBe("empty");

  first.accept("final", instant, Date.parse("2026-09-10T08:01:00.000Z"));
  first.accept("final", instant, Date.parse("2026-09-10T08:01:01.000Z"));
  first.complete("final", Date.parse("2026-09-10T08:02:00.000Z"));
  first.complete("final", Date.parse("2026-09-10T08:02:01.000Z"));

  const acceptedRetry = new LocalUsageAttempt(store, { attemptId: "attempt-retry" });
  acceptedRetry.accept("final", instant, Date.parse("2026-09-10T08:03:00.000Z"));
  acceptedRetry.failPending(Date.parse("2026-09-10T08:04:00.000Z"));

  const stats = readLocalUsageStatistics(filePath, {
    days: 7,
    now: Date.parse("2026-09-10T12:00:00.000Z"),
    timeZone: "UTC",
  });
  expect(stats.status).toBe("ready");
  expect(stats.days.at(-1)?.tiers.instant).toEqual({ accepted: 2, completed: 1, error: 1 });
});

test("accepted multipart browser messages retain separate completion and post-accept error outcomes", () => {
  const { filePath, store } = fixture();
  const attempt = new LocalUsageAttempt(store, { attemptId: "multipart-attempt" });
  const acceptedAt = Date.parse("2026-09-10T09:00:00.000Z");

  attempt.accept("multipart-1", instant, acceptedAt);
  attempt.complete("multipart-1", acceptedAt + 1_000);
  attempt.accept("multipart-2", instant, acceptedAt + 2_000);
  attempt.complete("multipart-2", acceptedAt + 3_000);
  attempt.accept("final", pro56, acceptedAt + 4_000);
  attempt.failPending(acceptedAt + 5_000);

  const today = readLocalUsageStatistics(filePath, {
    days: 7,
    now: acceptedAt + 10_000,
    timeZone: "UTC",
  }).days.at(-1)!;
  expect(today.tiers.instant).toEqual({ accepted: 2, completed: 2, error: 0 });
  expect(today.tiers.pro5_6).toEqual({ accepted: 1, completed: 0, error: 1 });
});

test("statistics persist across store instances without replaying an accepted receipt", () => {
  const { filePath, store } = fixture();
  const acceptedAt = Date.parse("2026-09-10T10:00:00.000Z");
  store.recordAccepted({
    id: "persistent-receipt:final",
    acceptedAt,
    ...pro56,
  });

  const restarted = new LocalUsageStore({ filePath, timeZone: "UTC" });
  restarted.recordAccepted({
    id: "persistent-receipt:final",
    acceptedAt,
    ...pro56,
  });
  restarted.recordOutcome({
    id: "persistent-receipt:final",
    acceptedAt,
    outcomeAt: acceptedAt + 60_000,
    outcome: "completed",
    ...pro56,
  });

  const stats = readLocalUsageStatistics(filePath, {
    days: 7,
    now: acceptedAt + 120_000,
    timeZone: "UTC",
  });
  expect(stats.days.at(-1)?.tiers.pro5_6).toEqual({ accepted: 1, completed: 1, error: 0 });
  expect(stats.proLifetime).toEqual([{
    version: "5.6",
    source: "observed",
    accepted: 1,
    completed: 1,
    error: 0,
    firstRecordedAt: "2026-09-10T10:00:00.000Z",
    lastRecordedAt: "2026-09-10T10:01:00.000Z",
  }]);
});

test("a transient acceptance-write failure is recovered by the terminal outcome without losing that outcome", () => {
  const { filePath, store } = fixture();
  const acceptedAt = Date.parse("2026-09-10T10:00:00.000Z");
  let failFirstAcceptance = true;
  const recoveringStore = {
    recordAccepted(input: Parameters<LocalUsageStore["recordAccepted"]>[0]) {
      if (failFirstAcceptance) {
        failFirstAcceptance = false;
        throw new Error("temporary write failure");
      }
      store.recordAccepted(input);
    },
    recordOutcome: store.recordOutcome.bind(store),
  };
  const attempt = new LocalUsageAttempt(recoveringStore, { attemptId: "recovered-write" });

  attempt.accept("final", instant, acceptedAt);
  attempt.complete("final", acceptedAt + 1_000);

  const stats = readLocalUsageStatistics(filePath, {
    days: 7,
    now: acceptedAt + 2_000,
    timeZone: "UTC",
  });
  expect(stats.days.at(-1)?.tiers.instant).toEqual({ accepted: 1, completed: 1, error: 0 });
});

test("an outcome after local midnight updates the acceptance-day cohort", () => {
  const { filePath, store } = fixture("America/New_York");
  const acceptedAt = Date.parse("2026-03-08T04:59:00.000Z"); // Mar 7, 23:59 EST
  const completedAt = Date.parse("2026-03-08T07:01:00.000Z"); // Mar 8, 03:01 EDT
  const attempt = new LocalUsageAttempt(store, { attemptId: "midnight" });
  attempt.accept("final", instant, acceptedAt);
  attempt.complete("final", completedAt);

  const stats = readLocalUsageStatistics(filePath, {
    days: 3,
    now: Date.parse("2026-03-09T16:00:00.000Z"),
    timeZone: "America/New_York",
  });
  expect(stats.range).toEqual({
    days: 3,
    startDay: "2026-03-07",
    endDay: "2026-03-09",
    dayBoundary: "local-calendar",
    weekStartsOn: "monday",
  });
  expect(stats.days.map(day => day.day)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  expect(stats.days[0]?.tiers.instant).toEqual({ accepted: 1, completed: 1, error: 0 });
  expect(stats.days[1]?.tiers.instant).toEqual({ accepted: 0, completed: 0, error: 0 });
});

test("a restart in another timezone still records the outcome on the persisted acceptance day", () => {
  const { filePath } = fixture("America/New_York");
  const acceptedAt = Date.parse("2026-03-08T04:59:00.000Z"); // Mar 7 in New York, Mar 8 in UTC
  const acceptanceStore = new LocalUsageStore({ filePath, timeZone: "America/New_York" });
  acceptanceStore.recordAccepted({ id: "timezone-restart:final", acceptedAt, ...instant });

  const outcomeStore = new LocalUsageStore({ filePath, timeZone: "UTC" });
  outcomeStore.recordOutcome({
    id: "timezone-restart:final",
    acceptedAt,
    outcome: "completed",
    outcomeAt: Date.parse("2026-03-08T07:01:00.000Z"),
    ...instant,
  });

  const stats = readLocalUsageStatistics(filePath, {
    days: 3,
    now: Date.parse("2026-03-09T16:00:00.000Z"),
    timeZone: "America/New_York",
  });
  expect(stats.status).toBe("ready");
  expect(stats.days[0]?.day).toBe("2026-03-07");
  expect(stats.days[0]?.tiers.instant).toEqual({ accepted: 1, completed: 1, error: 0 });
});

test("an expired pending receipt becomes a bounded dedupe tombstone instead of being accepted twice", () => {
  const { filePath } = fixture();
  const acceptedAt = Date.parse("2026-09-01T10:00:00.000Z");
  const store = new LocalUsageStore({ filePath, timeZone: "UTC" });
  store.recordAccepted({ id: "expired-pending:final", acceptedAt, ...instant });
  store.recordAccepted({
    id: "newer-message:final",
    acceptedAt: Date.parse("2026-09-10T10:00:00.000Z"),
    ...instant,
  });

  store.recordOutcome({
    id: "expired-pending:final",
    acceptedAt,
    outcome: "completed",
    outcomeAt: Date.parse("2026-09-10T10:01:00.000Z"),
    ...instant,
  });

  const persisted = JSON.parse(readFileSync(filePath, "utf8")) as {
    days: Array<{ day: string; tiers: Record<string, { accepted: number; completed: number; error: number }> }>;
    receipts: Array<{ id: string }>;
    receiptHorizon: { id: string } | null;
  };
  expect(persisted.days.find(day => day.day === "2026-09-01")?.tiers.instant).toEqual({
    accepted: 1,
    completed: 0,
    error: 0,
  });
  expect(persisted.receipts.some(receipt => receipt.id === "expired-pending:final")).toBeFalse();
  expect(persisted.receiptHorizon?.id).toBe("expired-pending:final");
});

test("Monday-based GPT-6 Pro week excludes the preceding Sunday across a calendar boundary", () => {
  const { filePath, store } = fixture();
  const sunday = new LocalUsageAttempt(store, { attemptId: "sunday" });
  sunday.accept("final", pro6, Date.parse("2026-09-06T12:00:00.000Z"));
  sunday.complete("final", Date.parse("2026-09-06T12:01:00.000Z"));
  const monday = new LocalUsageAttempt(store, { attemptId: "monday" });
  monday.accept("final", pro6, Date.parse("2026-09-07T12:00:00.000Z"));
  monday.failPending(Date.parse("2026-09-07T12:01:00.000Z"));

  const stats = readLocalUsageStatistics(filePath, {
    days: 30,
    now: Date.parse("2026-09-13T12:00:00.000Z"),
    timeZone: "UTC",
  });
  expect(stats.week6Pro).toEqual({
    startDay: "2026-09-07",
    endDay: "2026-09-13",
    weekStartsOn: "monday",
    accepted: 1,
    completed: 0,
    error: 1,
  });
});

test("observed Pro parsing never infers an unknown or future version", () => {
  expect(parseObservedChatGptProVersion(["5.6 Pro，第 5 项，共 5 项。"])) .toBe("5.6");
  expect(parseObservedChatGptProVersion(["GPT-6 Astra Pro, item 5 of 5."])) .toBe("6");
  expect(parseObservedChatGptProVersion(["GPT-5.5 Pro, item 5 of 5."])) .toBe("5.5");
  expect(parseObservedChatGptProVersion(["Pro, item 5 of 5."])).toBeUndefined();
  expect(parseObservedChatGptProVersion(["GPT-7 Pro, item 5 of 5."])).toBeUndefined();
  expect(parseObservedChatGptProVersion(["Use arrows; Pro is the fifth item."])).toBeUndefined();
  expect(parseObservedChatGptProVersion([
    "5.6 Pro, item 5 of 5.",
    "GPT-6 Astra Pro, item 5 of 5.",
  ])).toBeUndefined();
});

test("automatic and manual mappings isolate unknown Pro identity from exact quota cards", () => {
  expect(usageDescriptorForAutomaticMode({ displayLabel: "Pro" })).toEqual({
    tier: "proUnknown",
    proVersion: "unknown",
    source: "unknown",
  });
  expect(usageDescriptorForAutomaticMode({ displayLabel: "Pro", observedProVersion: "6" })).toEqual(pro6);
  expect(usageDescriptorForAutomaticMode({ displayLabel: "Extra High", observedProVersion: "6" })).toEqual({
    tier: "extraHigh",
    proVersion: null,
    source: "unknown",
  });
  expect(usageDescriptorForManualMode(false)).toEqual({
    tier: "manualUnknown",
    proVersion: null,
    source: "unknown",
  });
  expect(usageDescriptorForManualMode(true)).toEqual({
    tier: "proUnknown",
    proVersion: "unknown",
    source: "self-reported",
  });
});

test("a malformed existing store remains unreadable and telemetry does not overwrite or throw", () => {
  const { filePath, store } = fixture();
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, "{not valid json", { mode: 0o600 });
  const before = readFileSync(filePath, "utf8");
  const attempt = new LocalUsageAttempt(store, { attemptId: "malformed" });

  expect(() => {
    attempt.accept("final", instant, Date.parse("2026-09-10T10:00:00.000Z"));
    attempt.complete("final", Date.parse("2026-09-10T10:01:00.000Z"));
  }).not.toThrow();
  expect(readFileSync(filePath, "utf8")).toBe(before);
  const stats = readLocalUsageStatistics(filePath, {
    days: 7,
    now: Date.parse("2026-09-10T12:00:00.000Z"),
    timeZone: "UTC",
  });
  expect(stats.status).toBe("unreadable");
  expect(stats.days).toEqual([]);
  expect(stats.warnings[0]).toContain("could not be read");
});

test("the packaged Electron reader returns the same projection as the core reader", () => {
  const { filePath, store } = fixture("America/New_York");
  const acceptedAt = Date.parse("2026-03-08T04:59:00.000Z");
  const attempt = new LocalUsageAttempt(store, { attemptId: "reader-parity" });
  attempt.accept("multipart-1", instant, acceptedAt);
  attempt.complete("multipart-1", acceptedAt + 1_000);
  attempt.accept("final", pro6, acceptedAt + 2_000);
  attempt.failPending(acceptedAt + 3_000);
  const options = {
    days: 30,
    now: Date.parse("2026-03-09T16:00:00.000Z"),
    timeZone: "America/New_York",
  };
  const launcherReader = require("../launcher/electron/local-usage.cjs") as {
    readLocalUsageStatistics: typeof readLocalUsageStatistics;
  };

  expect(launcherReader.readLocalUsageStatistics(filePath, options)).toEqual(
    readLocalUsageStatistics(filePath, options),
  );
});
