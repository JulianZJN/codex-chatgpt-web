const fs = require("node:fs");
const path = require("node:path");

const STORE_VERSION = 1;
const MAX_DAYS = 400;
const TIERS = Object.freeze([
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
]);
const EMPTY_COUNTS = Object.freeze({ accepted: 0, completed: 0, error: 0 });

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoInstant(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isCalendarDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function parseCounts(value) {
  if (!isRecord(value)
    || !isCount(value.accepted)
    || !isCount(value.completed)
    || !isCount(value.error)
    || value.completed + value.error > value.accepted) return undefined;
  return { accepted: value.accepted, completed: value.completed, error: value.error };
}

function isTier(value) {
  return typeof value === "string" && TIERS.includes(value);
}

function isProVersion(value) {
  return value === "5.5" || value === "5.6" || value === "6" || value === "unknown";
}

function isSource(value) {
  return value === "observed" || value === "self-reported" || value === "unknown";
}

function descriptorIsConsistent(descriptor) {
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

function parseStoredUsage(value) {
  if (!isRecord(value)
    || value.version !== STORE_VERSION
    || !isIsoInstant(value.recordedSince)
    || !isIsoInstant(value.updatedAt)
    || !Array.isArray(value.timezones)
    || value.timezones.some((zone) => typeof zone !== "string" || !zone || zone.length > 100)
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

  const days = value.days.map((candidate) => {
    if (!isRecord(candidate) || !isCalendarDay(candidate.day) || !isRecord(candidate.tiers)) {
      throw new Error("Local usage store has an invalid daily aggregate");
    }
    const tiers = {};
    for (const [tier, rawCounts] of Object.entries(candidate.tiers)) {
      if (!isTier(tier)) throw new Error("Local usage store has an unknown tier");
      const counts = parseCounts(rawCounts);
      if (!counts) throw new Error("Local usage store has invalid daily counts");
      tiers[tier] = counts;
    }
    return { day: candidate.day, tiers };
  });
  if (new Set(days.map((day) => day.day)).size !== days.length) {
    throw new Error("Local usage store has duplicate calendar days");
  }

  const proLifetime = value.proLifetime.map((candidate) => {
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
  if (new Set(proLifetime.map((row) => `${row.version}:${row.source}`)).size !== proLifetime.length) {
    throw new Error("Local usage store has duplicate Pro lifetime rows");
  }

  const receiptIds = new Set();
  for (const candidate of value.receipts) {
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
      || (candidate.outcomeAt !== undefined && !Number.isFinite(candidate.outcomeAt))
      || !descriptorIsConsistent(candidate)
      || (candidate.outcome === undefined) !== (candidate.outcomeAt === undefined)) {
      throw new Error("Local usage store has an invalid receipt");
    }
    if (receiptIds.has(candidate.id)) throw new Error("Local usage store has duplicate receipts");
    receiptIds.add(candidate.id);
  }

  return {
    recordedSince: value.recordedSince,
    timezones: [...value.timezones],
    days,
    proLifetime,
  };
}

function resolvedTimeZone(timeZone) {
  const resolved = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!resolved) return "UTC";
  new Intl.DateTimeFormat("en-US", { timeZone: resolved }).format(0);
  return resolved;
}

function localCalendarDay(timestamp, timeZone) {
  if (!Number.isFinite(timestamp)) throw new Error("Local usage timestamp must be finite");
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: resolvedTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const values = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
    .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
    .map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftCalendarDay(day, offset) {
  if (!isCalendarDay(day) || !Number.isSafeInteger(offset)) throw new Error("Invalid calendar-day shift");
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + offset));
  return [
    shifted.getUTCFullYear().toString().padStart(4, "0"),
    (shifted.getUTCMonth() + 1).toString().padStart(2, "0"),
    shifted.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function mondayFor(day) {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return shiftCalendarDay(day, -(weekday === 0 ? 6 : weekday - 1));
}

function emptyTiers() {
  return Object.fromEntries(TIERS.map((tier) => [tier, { ...EMPTY_COUNTS }]));
}

function countsFor(day, tier) {
  return { ...(day?.tiers[tier] ?? EMPTY_COUNTS) };
}

function nearestExistingAncestor(targetPath) {
  let current = targetPath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function statusWithoutData(status, days, now, timeZone, warning) {
  const endDay = localCalendarDay(now, timeZone);
  const startDay = shiftCalendarDay(endDay, -(days - 1));
  const weekStart = mondayFor(endDay);
  return {
    status,
    timezone: timeZone,
    recordedSince: null,
    range: {
      days,
      startDay,
      endDay,
      dayBoundary: "local-calendar",
      weekStartsOn: "monday",
    },
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
      weekStartsOn: "monday",
      ...EMPTY_COUNTS,
    },
    proLifetime: [],
    warnings: warning ? [warning] : [],
  };
}

function readLocalUsageStatistics(filePath, options) {
  const days = options?.days;
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error("Local usage range must contain between 1 and 400 days");
  }
  const now = options.now ?? Date.now();
  const timeZone = resolvedTimeZone(options.timeZone);
  if (!fs.existsSync(filePath)) {
    try {
      fs.accessSync(
        nearestExistingAncestor(path.dirname(filePath)),
        fs.constants.R_OK | fs.constants.W_OK,
      );
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

  let store;
  try {
    store = parseStoredUsage(JSON.parse(fs.readFileSync(filePath, "utf8")));
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
    const storedByDay = new Map(store.days.map((day) => [day.day, day]));
    const projectedDays = Array.from({ length: days }, (_value, index) => {
      const day = shiftCalendarDay(startDay, index);
      const stored = storedByDay.get(day);
      const tiers = emptyTiers();
      for (const tier of TIERS) tiers[tier] = countsFor(stored, tier);
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
    const timezoneWarning = store.timezones.some((zone) => zone !== timeZone)
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
      proLifetime: store.proLifetime.map((row) => ({ ...row })),
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

function getUsageStatistics({ coreHome, input, now, timeZone } = {}) {
  if (typeof coreHome !== "string" || !path.isAbsolute(coreHome)) {
    throw new Error("Local usage core home must be an absolute path");
  }
  if (!isRecord(input) || (input.days !== 7 && input.days !== 30)) {
    throw new Error("Local usage statistics supports only 7 or 30 days");
  }
  return readLocalUsageStatistics(path.join(coreHome, "usage", "local-usage.json"), {
    days: input.days,
    now,
    timeZone,
  });
}

module.exports = {
  getUsageStatistics,
  readLocalUsageStatistics,
};
