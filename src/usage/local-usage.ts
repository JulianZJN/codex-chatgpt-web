import { randomUUID } from "node:crypto";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteFile, getConfigDir } from "../config";

export const LOCAL_USAGE_STORE_VERSION = 1;
export const LOCAL_USAGE_MAX_DAYS = 400;
export const LOCAL_USAGE_MAX_RECEIPTS = 8_192;
export const LOCAL_USAGE_PENDING_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const LOCAL_USAGE_RELATIVE_PATH = join("usage", "local-usage.json");

export const LOCAL_USAGE_TIERS = [
  "instant",
  "medium",
  "high",
  "extraHigh",
  "pro5_5",
  "pro5_6",
  "pro6",
  "proUnknown",
  "luna",
  "think",
  "manualUnknown",
] as const;

export type LocalUsageTier = typeof LOCAL_USAGE_TIERS[number];
export type LocalUsageProVersion = "5.5" | "5.6" | "6" | "unknown";
export type LocalUsageSource = "observed" | "self-reported" | "unknown";
export type LocalUsageOutcome = "completed" | "error";

export interface LocalUsageCounts {
  accepted: number;
  completed: number;
  error: number;
}

export interface LocalUsageDescriptor {
  tier: LocalUsageTier;
  proVersion: LocalUsageProVersion | null;
  source: LocalUsageSource;
}

export interface LocalUsageReceipt extends LocalUsageDescriptor {
  id: string;
  acceptedAt: number;
  day: string;
  outcome?: LocalUsageOutcome;
  outcomeAt?: number;
}

interface LocalUsageReceiptKey {
  acceptedAt: number;
  id: string;
}

export interface LocalUsageDay {
  day: string;
  tiers: Record<LocalUsageTier, LocalUsageCounts>;
}

export interface LocalUsageProLifetimeRow extends LocalUsageCounts {
  version: LocalUsageProVersion;
  source: LocalUsageSource;
  firstRecordedAt: string;
  lastRecordedAt: string;
}

interface StoredLocalUsageDay {
  day: string;
  tiers: Partial<Record<LocalUsageTier, LocalUsageCounts>>;
}

interface StoredLocalUsage {
  version: typeof LOCAL_USAGE_STORE_VERSION;
  recordedSince: string;
  updatedAt: string;
  timezones: string[];
  days: StoredLocalUsageDay[];
  proLifetime: LocalUsageProLifetimeRow[];
  receipts: LocalUsageReceipt[];
  receiptHorizon: LocalUsageReceiptKey | null;
}

export interface LocalUsageStatistics {
  status: "ready" | "empty" | "unreadable" | "error";
  timezone: string;
  recordedSince: string | null;
  range: {
    days: number;
    startDay: string;
    endDay: string;
    dayBoundary: "local-calendar";
    weekStartsOn: "monday";
  };
  days: LocalUsageDay[];
  today5_6Pro: LocalUsageCounts & { day: string };
  week6Pro: LocalUsageCounts & {
    startDay: string;
    endDay: string;
    weekStartsOn: "monday";
  };
  proLifetime: LocalUsageProLifetimeRow[];
  warnings: string[];
}

interface LocalUsageRecordInput extends LocalUsageDescriptor {
  id: string;
  acceptedAt: number;
}

interface LocalUsageOutcomeInput extends LocalUsageRecordInput {
  outcome: LocalUsageOutcome;
  outcomeAt: number;
}

interface LocalUsageAttemptRecord extends LocalUsageRecordInput {
  outcome?: LocalUsageOutcome;
  outcomeAt?: number;
}

interface LocalUsageStoreOptions {
  filePath?: string;
  timeZone?: string;
}

interface ReadLocalUsageOptions {
  days: number;
  now?: number;
  timeZone?: string;
}

const EMPTY_COUNTS: Readonly<LocalUsageCounts> = Object.freeze({ accepted: 0, completed: 0, error: 0 });
const LOCK_TIMEOUT_MS = 500;
const STALE_LOCK_MS = 30_000;
const lockWaitCell = new Int32Array(new SharedArrayBuffer(4));

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year!, month! - 1, day!));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month! - 1
    && candidate.getUTCDate() === day;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseCounts(value: unknown): LocalUsageCounts | undefined {
  if (!isRecord(value)
    || !isCount(value.accepted)
    || !isCount(value.completed)
    || !isCount(value.error)
    || value.completed + value.error > value.accepted) return undefined;
  return { accepted: value.accepted, completed: value.completed, error: value.error };
}

function isTier(value: unknown): value is LocalUsageTier {
  return typeof value === "string" && (LOCAL_USAGE_TIERS as readonly string[]).includes(value);
}

function isProVersion(value: unknown): value is LocalUsageProVersion {
  return value === "5.5" || value === "5.6" || value === "6" || value === "unknown";
}

function isSource(value: unknown): value is LocalUsageSource {
  return value === "observed" || value === "self-reported" || value === "unknown";
}

function descriptorIsConsistent(descriptor: LocalUsageDescriptor): boolean {
  if (descriptor.tier === "pro5_5") {
    return descriptor.proVersion === "5.5" && descriptor.source === "observed";
  }
  if (descriptor.tier === "pro5_6") {
    return descriptor.proVersion === "5.6" && descriptor.source === "observed";
  }
  if (descriptor.tier === "pro6") {
    return descriptor.proVersion === "6" && descriptor.source === "observed";
  }
  if (descriptor.tier === "proUnknown") {
    return descriptor.proVersion === "unknown" && descriptor.source !== "observed";
  }
  return descriptor.proVersion === null && descriptor.source === "unknown";
}

function parseStoredUsage(value: unknown): StoredLocalUsage {
  if (!isRecord(value)
    || value.version !== LOCAL_USAGE_STORE_VERSION
    || !isIsoInstant(value.recordedSince)
    || !isIsoInstant(value.updatedAt)
    || !Array.isArray(value.timezones)
    || value.timezones.some(zone => typeof zone !== "string" || !zone || zone.length > 100)
    || !Array.isArray(value.days)
    || !Array.isArray(value.proLifetime)
    || !Array.isArray(value.receipts)
    || (value.receiptHorizon !== undefined
      && value.receiptHorizon !== null
      && (!isRecord(value.receiptHorizon)
        || typeof value.receiptHorizon.id !== "string"
        || value.receiptHorizon.id.length < 1
        || value.receiptHorizon.id.length > 256
        || typeof value.receiptHorizon.acceptedAt !== "number"
        || !Number.isFinite(value.receiptHorizon.acceptedAt)))) {
    throw new Error("Local usage store has an invalid top-level schema");
  }

  const days: StoredLocalUsageDay[] = value.days.map(candidate => {
    if (!isRecord(candidate) || !isCalendarDay(candidate.day) || !isRecord(candidate.tiers)) {
      throw new Error("Local usage store has an invalid daily aggregate");
    }
    const tiers: Partial<Record<LocalUsageTier, LocalUsageCounts>> = {};
    for (const [tier, rawCounts] of Object.entries(candidate.tiers)) {
      if (!isTier(tier)) throw new Error("Local usage store has an unknown tier");
      const counts = parseCounts(rawCounts);
      if (!counts) throw new Error("Local usage store has invalid daily counts");
      tiers[tier] = counts;
    }
    return { day: candidate.day, tiers };
  });
  if (new Set(days.map(day => day.day)).size !== days.length) {
    throw new Error("Local usage store has duplicate calendar days");
  }

  const proLifetime: LocalUsageProLifetimeRow[] = value.proLifetime.map(candidate => {
    const counts = parseCounts(candidate);
    if (!isRecord(candidate)
      || !counts
      || !isProVersion(candidate.version)
      || !isSource(candidate.source)
      || !isIsoInstant(candidate.firstRecordedAt)
      || !isIsoInstant(candidate.lastRecordedAt)) {
      throw new Error("Local usage store has an invalid Pro lifetime row");
    }
    return {
      version: candidate.version,
      source: candidate.source,
      ...counts,
      firstRecordedAt: candidate.firstRecordedAt,
      lastRecordedAt: candidate.lastRecordedAt,
    };
  });
  if (new Set(proLifetime.map(row => `${row.version}:${row.source}`)).size !== proLifetime.length) {
    throw new Error("Local usage store has duplicate Pro lifetime rows");
  }

  const receipts: LocalUsageReceipt[] = value.receipts.map(candidate => {
    if (!isRecord(candidate)
      || typeof candidate.id !== "string"
      || candidate.id.length < 1
      || candidate.id.length > 256
      || typeof candidate.acceptedAt !== "number"
      || !Number.isFinite(candidate.acceptedAt)
      || !isCalendarDay(candidate.day)
      || !isTier(candidate.tier)
      || (candidate.proVersion !== null && !isProVersion(candidate.proVersion))
      || !isSource(candidate.source)
      || (candidate.outcome !== undefined && candidate.outcome !== "completed" && candidate.outcome !== "error")
      || (candidate.outcomeAt !== undefined && !Number.isFinite(candidate.outcomeAt))) {
      throw new Error("Local usage store has an invalid receipt");
    }
    const receipt: LocalUsageReceipt = {
      id: candidate.id,
      acceptedAt: candidate.acceptedAt,
      day: candidate.day,
      tier: candidate.tier,
      proVersion: candidate.proVersion as LocalUsageProVersion | null,
      source: candidate.source,
      ...(candidate.outcome ? { outcome: candidate.outcome as LocalUsageOutcome } : {}),
      ...(typeof candidate.outcomeAt === "number" ? { outcomeAt: candidate.outcomeAt } : {}),
    };
    if (!descriptorIsConsistent(receipt)
      || (receipt.outcome === undefined) !== (receipt.outcomeAt === undefined)) {
      throw new Error("Local usage store has an inconsistent receipt");
    }
    return receipt;
  });
  if (new Set(receipts.map(receipt => receipt.id)).size !== receipts.length) {
    throw new Error("Local usage store has duplicate receipts");
  }

  return {
    version: LOCAL_USAGE_STORE_VERSION,
    recordedSince: value.recordedSince,
    updatedAt: value.updatedAt,
    timezones: [...value.timezones] as string[],
    days,
    proLifetime,
    receipts,
    receiptHorizon: isRecord(value.receiptHorizon)
      ? { id: value.receiptHorizon.id as string, acceptedAt: value.receiptHorizon.acceptedAt as number }
      : null,
  };
}

function resolvedTimeZone(timeZone?: string): string {
  const resolved = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!resolved) return "UTC";
  // Construction is a cheap validation and keeps an invalid injected test/config value explicit.
  new Intl.DateTimeFormat("en-US", { timeZone: resolved }).format(0);
  return resolved;
}

export function localCalendarDay(timestamp: number, timeZone?: string): string {
  if (!Number.isFinite(timestamp)) throw new Error("Local usage timestamp must be finite");
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: resolvedTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const values = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
    .filter(part => part.type === "year" || part.type === "month" || part.type === "day")
    .map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftCalendarDay(day: string, offset: number): string {
  if (!isCalendarDay(day) || !Number.isSafeInteger(offset)) throw new Error("Invalid calendar-day shift");
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, date! + offset));
  return [
    shifted.getUTCFullYear().toString().padStart(4, "0"),
    (shifted.getUTCMonth() + 1).toString().padStart(2, "0"),
    shifted.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function mondayFor(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, date!)).getUTCDay();
  return shiftCalendarDay(day, -(weekday === 0 ? 6 : weekday - 1));
}

function emptyTiers(): Record<LocalUsageTier, LocalUsageCounts> {
  return Object.fromEntries(LOCAL_USAGE_TIERS.map(tier => [tier, { ...EMPTY_COUNTS }])) as Record<
    LocalUsageTier,
    LocalUsageCounts
  >;
}

function countsFor(day: StoredLocalUsageDay | undefined, tier: LocalUsageTier): LocalUsageCounts {
  return { ...(day?.tiers[tier] ?? EMPTY_COUNTS) };
}

function increment(counts: LocalUsageCounts, field: keyof LocalUsageCounts): void {
  if (counts[field] >= Number.MAX_SAFE_INTEGER) throw new Error("Local usage counter overflow");
  counts[field] += 1;
}

function dateIso(timestamp: number): string {
  if (!Number.isFinite(timestamp)) throw new Error("Local usage timestamp must be finite");
  return new Date(timestamp).toISOString();
}

function emptyStoredUsage(acceptedAt: number, timeZone: string): StoredLocalUsage {
  const at = dateIso(acceptedAt);
  return {
    version: LOCAL_USAGE_STORE_VERSION,
    recordedSince: at,
    updatedAt: at,
    timezones: [timeZone],
    days: [],
    proLifetime: [],
    receipts: [],
    receiptHorizon: null,
  };
}

function validateRecordInput(input: LocalUsageRecordInput): void {
  if (typeof input.id !== "string" || input.id.length < 1 || input.id.length > 256) {
    throw new Error("Local usage receipt id is invalid");
  }
  if (!Number.isFinite(input.acceptedAt) || !descriptorIsConsistent(input)) {
    throw new Error("Local usage receipt descriptor is invalid");
  }
}

function sameDescriptor(left: LocalUsageDescriptor, right: LocalUsageDescriptor): boolean {
  return left.tier === right.tier
    && left.proVersion === right.proVersion
    && left.source === right.source;
}

function dayAggregate(store: StoredLocalUsage, day: string): StoredLocalUsageDay {
  let aggregate = store.days.find(candidate => candidate.day === day);
  if (!aggregate) {
    aggregate = { day, tiers: {} };
    store.days.push(aggregate);
  }
  return aggregate;
}

function mutableCounts(day: StoredLocalUsageDay, tier: LocalUsageTier): LocalUsageCounts {
  let counts = day.tiers[tier];
  if (!counts) {
    counts = { ...EMPTY_COUNTS };
    day.tiers[tier] = counts;
  }
  return counts;
}

function lifetimeRow(store: StoredLocalUsage, input: LocalUsageRecordInput): LocalUsageProLifetimeRow | undefined {
  if (input.proVersion === null) return undefined;
  let row = store.proLifetime.find(candidate => (
    candidate.version === input.proVersion && candidate.source === input.source
  ));
  if (!row) {
    const at = dateIso(input.acceptedAt);
    row = {
      version: input.proVersion,
      source: input.source,
      ...EMPTY_COUNTS,
      firstRecordedAt: at,
      lastRecordedAt: at,
    };
    store.proLifetime.push(row);
  }
  row.lastRecordedAt = dateIso(Math.max(input.acceptedAt, Date.parse(row.lastRecordedAt)));
  return row;
}

function compareReceiptKeys(left: LocalUsageReceiptKey, right: LocalUsageReceiptKey): number {
  return left.acceptedAt - right.acceptedAt || left.id.localeCompare(right.id);
}

function receiptWasDiscarded(store: StoredLocalUsage, input: LocalUsageReceiptKey): boolean {
  return store.receiptHorizon !== null && compareReceiptKeys(input, store.receiptHorizon) <= 0;
}

function ensureAccepted(
  store: StoredLocalUsage,
  input: LocalUsageRecordInput,
  timeZone: string,
): { receipt: LocalUsageReceipt | undefined; inserted: boolean } {
  validateRecordInput(input);
  const existing = store.receipts.find(receipt => receipt.id === input.id);
  if (existing) {
    if (existing.acceptedAt !== input.acceptedAt || !sameDescriptor(existing, input)) {
      throw new Error("Local usage receipt identity was reused with different metadata");
    }
    return { receipt: existing, inserted: false };
  }
  if (receiptWasDiscarded(store, input)) return { receipt: undefined, inserted: false };
  const day = localCalendarDay(input.acceptedAt, timeZone);
  const receipt: LocalUsageReceipt = {
    id: input.id,
    acceptedAt: input.acceptedAt,
    day,
    tier: input.tier,
    proVersion: input.proVersion,
    source: input.source,
  };
  store.receipts.push(receipt);
  increment(mutableCounts(dayAggregate(store, day), input.tier), "accepted");
  const lifetime = lifetimeRow(store, input);
  if (lifetime) increment(lifetime, "accepted");
  if (Date.parse(store.recordedSince) > input.acceptedAt) store.recordedSince = dateIso(input.acceptedAt);
  return { receipt, inserted: true };
}

function updateOutcome(
  store: StoredLocalUsage,
  input: LocalUsageOutcomeInput,
  timeZone: string,
): void {
  const { receipt } = ensureAccepted(store, input, timeZone);
  if (!receipt || receipt.outcome !== undefined) return;
  receipt.outcome = input.outcome;
  receipt.outcomeAt = input.outcomeAt;
  const field = input.outcome;
  increment(mutableCounts(dayAggregate(store, receipt.day), receipt.tier), field);
  const lifetime = lifetimeRow(store, receipt);
  if (lifetime) {
    increment(lifetime, field);
    lifetime.lastRecordedAt = dateIso(Math.max(input.outcomeAt, Date.parse(lifetime.lastRecordedAt)));
  }
}

function advanceReceiptHorizon(store: StoredLocalUsage, discarded: readonly LocalUsageReceipt[]): void {
  for (const receipt of discarded) {
    if (!store.receiptHorizon || compareReceiptKeys(receipt, store.receiptHorizon) > 0) {
      store.receiptHorizon = { acceptedAt: receipt.acceptedAt, id: receipt.id };
    }
  }
}

function pruneStoredUsage(store: StoredLocalUsage, now: number): void {
  store.days.sort((left, right) => left.day.localeCompare(right.day));
  if (store.days.length > LOCAL_USAGE_MAX_DAYS) {
    store.days.splice(0, store.days.length - LOCAL_USAGE_MAX_DAYS);
  }
  const pendingCutoff = now - LOCAL_USAGE_PENDING_RETENTION_MS;
  const discarded = store.receipts.filter(receipt => (
    receipt.outcome === undefined && receipt.acceptedAt < pendingCutoff
  ));
  const expiredIds = new Set(discarded.map(receipt => receipt.id));
  store.receipts = store.receipts.filter(receipt => !expiredIds.has(receipt.id));
  if (store.receipts.length > LOCAL_USAGE_MAX_RECEIPTS) {
    const excess = store.receipts.length - LOCAL_USAGE_MAX_RECEIPTS;
    const capDiscarded = [...store.receipts]
      .sort((left, right) => (
        Number(left.outcome === undefined) - Number(right.outcome === undefined)
        || compareReceiptKeys(left, right)
      ))
      .slice(0, excess);
    const capDiscardedIds = new Set(capDiscarded.map(receipt => receipt.id));
    discarded.push(...capDiscarded);
    store.receipts = store.receipts.filter(receipt => !capDiscardedIds.has(receipt.id));
  }
  advanceReceiptHorizon(store, discarded);
  store.receipts.sort(compareReceiptKeys);
  const versionOrder: Record<LocalUsageProVersion, number> = { "5.5": 0, "5.6": 1, "6": 2, unknown: 3 };
  const sourceOrder: Record<LocalUsageSource, number> = { observed: 0, "self-reported": 1, unknown: 2 };
  store.proLifetime.sort((left, right) => (
    versionOrder[left.version] - versionOrder[right.version]
    || sourceOrder[left.source] - sourceOrder[right.source]
  ));
}

function nearestExistingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function acquireLock(lockPath: string): () => void {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      return () => {
        try { closeSync(fd); } finally { rmSync(lockPath, { force: true }); }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
        continue;
      }
      if (Date.now() >= deadline) throw new Error("Local usage store is busy");
      Atomics.wait(lockWaitCell, 0, 0, 10);
    }
  }
}

export class LocalUsageStore {
  readonly filePath: string;
  readonly timeZone: string;

  constructor(options: LocalUsageStoreOptions = {}) {
    this.filePath = options.filePath ?? join(getConfigDir(), LOCAL_USAGE_RELATIVE_PATH);
    this.timeZone = resolvedTimeZone(options.timeZone);
  }

  recordAccepted(input: LocalUsageRecordInput): void {
    this.mutate(input.acceptedAt, input.acceptedAt, store => {
      ensureAccepted(store, input, this.timeZone);
    });
  }

  recordOutcome(input: LocalUsageOutcomeInput): void {
    if (input.outcome !== "completed" && input.outcome !== "error") {
      throw new Error("Local usage outcome is invalid");
    }
    if (!Number.isFinite(input.outcomeAt)) throw new Error("Local usage outcome timestamp is invalid");
    this.mutate(input.acceptedAt, input.outcomeAt, store => {
      updateOutcome(store, input, this.timeZone);
    });
  }

  private mutate(
    initialTimestamp: number,
    mutationTimestamp: number,
    update: (store: StoredLocalUsage) => void,
  ): void {
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { chmodSync(directory, 0o700); } catch { /* Windows ACLs are installer-owned. */ }
    const release = acquireLock(`${this.filePath}.lock`);
    try {
      const store = existsSync(this.filePath)
        ? parseStoredUsage(JSON.parse(readFileSync(this.filePath, "utf8")) as unknown)
        : emptyStoredUsage(initialTimestamp, this.timeZone);
      update(store);
      if (!store.timezones.includes(this.timeZone)) {
        store.timezones.push(this.timeZone);
        if (store.timezones.length > 16) store.timezones.splice(0, store.timezones.length - 16);
      }
      const latestTimestamp = Math.max(mutationTimestamp, Date.parse(store.updatedAt));
      store.updatedAt = dateIso(latestTimestamp);
      pruneStoredUsage(store, latestTimestamp);
      atomicWriteFile(this.filePath, `${JSON.stringify(store)}\n`);
    } finally {
      release();
    }
  }
}

export class LocalUsageAttempt {
  private readonly records = new Map<string, LocalUsageAttemptRecord>();
  private readonly attemptId: string;

  constructor(
    private readonly store: Pick<LocalUsageStore, "recordAccepted" | "recordOutcome">,
    options: { attemptId?: string } = {},
  ) {
    this.attemptId = options.attemptId ?? randomUUID();
  }

  accept(messageKey: string, descriptor: LocalUsageDescriptor, acceptedAt = Date.now()): void {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(messageKey)) {
      this.warn(new Error("Local usage message key is invalid"));
      return;
    }
    let record = this.records.get(messageKey);
    if (!record) {
      record = {
        id: `${this.attemptId}:${messageKey}`,
        acceptedAt,
        ...descriptor,
      };
      this.records.set(messageKey, record);
    }
    this.safe(() => this.store.recordAccepted(record!));
  }

  complete(messageKey: string, outcomeAt = Date.now()): void {
    this.finish(messageKey, "completed", outcomeAt);
  }

  failPending(outcomeAt = Date.now()): void {
    for (const messageKey of this.records.keys()) this.finish(messageKey, "error", outcomeAt);
  }

  private finish(messageKey: string, outcome: LocalUsageOutcome, outcomeAt: number): void {
    const record = this.records.get(messageKey);
    if (!record || record.outcome !== undefined) return;
    const recorded = this.safe(() => this.store.recordOutcome({
      ...record,
      outcome,
      outcomeAt,
    }));
    if (recorded) {
      record.outcome = outcome;
      record.outcomeAt = outcomeAt;
    }
  }

  private safe(operation: () => void): boolean {
    try {
      operation();
      return true;
    } catch (error) {
      this.warn(error);
      return false;
    }
  }

  private warn(error: unknown): void {
    console.warn(
      `[chatgpt-web] local usage telemetry unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function parseObservedChatGptProVersion(
  descriptions: readonly string[],
): Exclude<LocalUsageProVersion, "unknown"> | undefined {
  const state = /^(?:GPT[-\s]?)?(5\.5|5\.6|6)(?:\s+(?:Sol|Astra))?\s+Pro(?=\s*(?:[,，]|$))/i;
  const observed = new Set<Exclude<LocalUsageProVersion, "unknown">>();
  for (const description of descriptions) {
    const match = state.exec(description.replace(/\s+/g, " ").trim());
    if (match?.[1] === "5.5" || match?.[1] === "5.6" || match?.[1] === "6") observed.add(match[1]);
  }
  return observed.size === 1 ? observed.values().next().value : undefined;
}

export function usageDescriptorForAutomaticMode(mode: {
  displayLabel: "Luna" | "Think" | "Instant" | "Medium" | "High" | "Extra High" | "Pro";
  observedProVersion?: Exclude<LocalUsageProVersion, "unknown">;
}): LocalUsageDescriptor {
  if (mode.displayLabel === "Pro") {
    if (mode.observedProVersion === "5.5") {
      return { tier: "pro5_5", proVersion: "5.5", source: "observed" };
    }
    if (mode.observedProVersion === "5.6") {
      return { tier: "pro5_6", proVersion: "5.6", source: "observed" };
    }
    if (mode.observedProVersion === "6") {
      return { tier: "pro6", proVersion: "6", source: "observed" };
    }
    return { tier: "proUnknown", proVersion: "unknown", source: "unknown" };
  }
  const tierByLabel = {
    Luna: "luna",
    Think: "think",
    Instant: "instant",
    Medium: "medium",
    High: "high",
    "Extra High": "extraHigh",
  } as const;
  return { tier: tierByLabel[mode.displayLabel], proVersion: null, source: "unknown" };
}

export function usageDescriptorForManualMode(explicitPro: boolean): LocalUsageDescriptor {
  return explicitPro
    ? { tier: "proUnknown", proVersion: "unknown", source: "self-reported" }
    : { tier: "manualUnknown", proVersion: null, source: "unknown" };
}

function statusWithoutData(
  status: "empty" | "unreadable" | "error",
  days: number,
  now: number,
  timeZone: string,
  warning?: string,
): LocalUsageStatistics {
  const endDay = localCalendarDay(now, timeZone);
  const startDay = shiftCalendarDay(endDay, -(days - 1));
  const weekStart = mondayFor(endDay);
  const base = {
    status,
    timezone: timeZone,
    recordedSince: null,
    range: { days, startDay, endDay, dayBoundary: "local-calendar" as const, weekStartsOn: "monday" as const },
    days: status === "empty"
      ? Array.from({ length: days }, (_value, index) => ({
        day: shiftCalendarDay(startDay, index),
        tiers: emptyTiers(),
      }))
      : [],
    today5_6Pro: { day: endDay, ...EMPTY_COUNTS },
    week6Pro: {
      startDay: weekStart,
      endDay: shiftCalendarDay(weekStart, 6),
      weekStartsOn: "monday" as const,
      ...EMPTY_COUNTS,
    },
    proLifetime: [],
    warnings: warning ? [warning] : [],
  };
  return base;
}

export function readLocalUsageStatistics(
  filePath: string,
  options: ReadLocalUsageOptions,
): LocalUsageStatistics {
  const days = options.days;
  if (!Number.isSafeInteger(days) || days < 1 || days > LOCAL_USAGE_MAX_DAYS) {
    throw new Error("Local usage range must contain between 1 and 400 days");
  }
  const now = options.now ?? Date.now();
  const timeZone = resolvedTimeZone(options.timeZone);
  if (!existsSync(filePath)) {
    try {
      accessSync(nearestExistingAncestor(dirname(filePath)), constants.R_OK | constants.W_OK);
      return statusWithoutData("empty", days, now, timeZone);
    } catch (error) {
      return statusWithoutData(
        "error",
        days,
        now,
        timeZone,
        `Local usage storage is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let store: StoredLocalUsage;
  try {
    store = parseStoredUsage(JSON.parse(readFileSync(filePath, "utf8")) as unknown);
  } catch (error) {
    return statusWithoutData(
      "unreadable",
      days,
      now,
      timeZone,
      `Local usage statistics could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const endDay = localCalendarDay(now, timeZone);
    const startDay = shiftCalendarDay(endDay, -(days - 1));
    const storedByDay = new Map(store.days.map(day => [day.day, day]));
    const projectedDays = Array.from({ length: days }, (_value, index): LocalUsageDay => {
      const day = shiftCalendarDay(startDay, index);
      const stored = storedByDay.get(day);
      const tiers = emptyTiers();
      for (const tier of LOCAL_USAGE_TIERS) tiers[tier] = countsFor(stored, tier);
      return { day, tiers };
    });
    const today = storedByDay.get(endDay);
    const weekStart = mondayFor(endDay);
    const weekEnd = shiftCalendarDay(weekStart, 6);
    const week6 = { ...EMPTY_COUNTS };
    for (const day of store.days) {
      if (day.day < weekStart || day.day > weekEnd) continue;
      const counts = countsFor(day, "pro6");
      week6.accepted += counts.accepted;
      week6.completed += counts.completed;
      week6.error += counts.error;
    }
    const timezoneWarning = store.timezones.some(zone => zone !== timeZone)
      ? `Historical local days include another timezone (${store.timezones.join(", ")}); the displayed range uses ${timeZone}.`
      : undefined;
    return {
      status: "ready",
      timezone: timeZone,
      recordedSince: store.recordedSince,
      range: { days, startDay, endDay, dayBoundary: "local-calendar", weekStartsOn: "monday" },
      days: projectedDays,
      today5_6Pro: { day: endDay, ...countsFor(today, "pro5_6") },
      week6Pro: {
        startDay: weekStart,
        endDay: weekEnd,
        weekStartsOn: "monday",
        ...week6,
      },
      proLifetime: store.proLifetime.map(row => ({ ...row })),
      warnings: timezoneWarning ? [timezoneWarning] : [],
    };
  } catch (error) {
    return statusWithoutData(
      "error",
      days,
      now,
      timeZone,
      `Local usage statistics could not be calculated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
