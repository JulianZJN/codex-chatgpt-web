import type { UsageCounts, UsageDay, UsageStatistics, UsageTier } from "../src/types";

const tiers: UsageTier[] = ["instant", "medium", "high", "extraHigh", "pro5_5", "pro5_6", "pro6", "proUnknown", "luna", "think", "manualUnknown"];
const today = "2026-09-13";
const monday = "2026-09-07";
// One fixed synthetic history; a range change only selects from this history.
const history: UsageDay[] = Array.from({ length: 30 }, (_, index) => {
  const day = new Date(Date.UTC(2026, 7, 15 + index)).toISOString().slice(0, 10);
  return { day, tiers: Object.fromEntries(tiers.map((tier, i) => {
    const accepted = (index + i * 3) % 5 === 0 ? 0 : Math.max(0, Math.round((Math.sin(index * 1.7 + i) + 1) * (i < 4 ? 6 : 2)));
    return [tier, { accepted, completed: Math.max(0, accepted - 1), error: accepted > 4 ? 1 : 0 }];
  })) as UsageDay["tiers"] };
});
function sum(rows: UsageDay[], tier: UsageTier): UsageCounts {
  return rows.reduce((total, day) => ({ accepted: total.accepted + day.tiers[tier].accepted,
    completed: total.completed + day.tiers[tier].completed, error: total.error + day.tiers[tier].error,
  }), { accepted: 0, completed: 0, error: 0 });
}
export function fixture(days: 7 | 30, status: UsageStatistics["status"]): UsageStatistics {
  const selected = history.slice(-days);
  const proVersions = [["5.5", "pro5_5"], ["5.6", "pro5_6"], ["6", "pro6"], ["unknown", "proUnknown"]] as const;
  return {
    status, timezone: "Asia/Taipei", recordedSince: "2026-08-15T04:00:00Z",
    range: { days, startDay: selected[0].day, endDay: today, dayBoundary: "local-calendar", weekStartsOn: "monday" },
    days: selected,
    today5_6Pro: { day: today, ...sum(history.filter((day) => day.day === today), "pro5_6") },
    week6Pro: { startDay: monday, endDay: today, weekStartsOn: "monday", ...sum(history.filter((day) => day.day >= monday), "pro6") },
    proLifetime: proVersions.map(([version, tier]) => ({ version, source: version === "unknown" ? "self-reported" : "observed",
      ...sum(history, tier), firstRecordedAt: "2026-08-15T04:00:00Z", lastRecordedAt: "2026-09-13T08:00:00Z",
    })),
    warnings: [],
  };
}
