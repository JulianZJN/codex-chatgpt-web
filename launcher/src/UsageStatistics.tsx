import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { Language, LauncherApi, UsageCounts, UsageStatistics, UsageTier } from "./types";
import { usageCopyFor } from "./usage-copy";

const tiers: UsageTier[] = ["instant", "medium", "high", "extraHigh", "pro5_5", "pro5_6", "pro6", "proUnknown", "luna", "think", "manualUnknown"];
const colors: Record<UsageTier, string> = {
  instant: "#8585d4", medium: "#a6a6e8", high: "#c4c4f2", extraHigh: "#e0dffa",
  pro5_5: "#4a8fb9", pro5_6: "#78bce7", pro6: "#b2def5", proUnknown: "#71818d",
  luna: "#b79d72", think: "#d6bd92", manualUnknown: "#767676",
};
function count(values: UsageCounts[]) { return values.reduce((total, value) => total + value.accepted, 0); }
function formatDay(day: string, language: Language, long = false) {
  // A calendar label is not an instant: UTC formatting prevents shifting its day.
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric", ...(long ? { year: "numeric" as const } : {}), timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

export function UsageStatisticsSection({ api, language }: { api: LauncherApi; language: Language }) {
  const [days, setDays] = useState<7 | 30>(7);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<UsageStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    let inFlight = false;
    async function load(quiet = false) {
      if (!current || inFlight) return;
      inFlight = true;
      if (!quiet) {
        setLoading(true);
        setData(null);
      }
      try {
        const result = await api.getUsageStatistics({ days });
        if (current) setData(result);
      } catch {
        if (current) setData(null);
      } finally {
        inFlight = false;
        if (current) setLoading(false);
      }
    }
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    void load();
    const timer = window.setInterval(refreshVisible, 30_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [api, days, refresh]);
  return <UsageStatisticsView data={data} days={days} language={language} loading={loading}
    onDaysChange={setDays} onRefresh={() => setRefresh((value) => value + 1)} />;
}

export function UsageStatisticsView({ data, days, language, loading, onDaysChange, onRefresh }: {
  data: UsageStatistics | null; days: 7 | 30; language: Language; loading: boolean;
  onDaysChange: (days: 7 | 30) => void; onRefresh: () => void;
}) {
  const copy = usageCopyFor(language);
  const id = useId();
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const activeDay = dismissed ? null : hoveredDay ?? focusedDay;
  const labels: Record<UsageTier, string> = { instant: "Instant", medium: "Medium", high: "High", extraHigh: "Extra High", pro5_5: "GPT-5.5 Pro", pro5_6: "GPT-5.6 Pro", pro6: "GPT-6 Pro", proUnknown: copy.proUnknown, luna: "Luna", think: "Think", manualUnknown: copy.manualUnknown };
  const ready = !loading && data?.status === "ready" && data.range.days === days;
  const total = ready ? count(data.days.flatMap((day) => Object.values(day.tiers))) : 0;
  const activeTiers = ready ? tiers.filter((tier) => data.days.some((day) => day.tiers[tier].accepted > 0)) : [];
  const tabDay = ready
    ? data.days.find((day) => day.day === focusedDay)?.day ?? data.days.at(-1)?.day
    : undefined;
  const peak = ready ? Math.max(1, ...data.days.map((day) => count(Object.values(day.tiers)))) : 1;
  const ceiling = Math.max(2, Math.ceil(peak / 2) * 2);
  const selected = ready ? data.days.find((day) => day.day === activeDay) : undefined;
  const number = (value: number) => value.toLocaleString(language);
  const unrecorded = (values: UsageCounts) => values.accepted - values.completed - values.error;
  function moveDay(event: KeyboardEvent<SVGGElement>, index: number) {
    if (event.key === "Escape") {
      setDismissed(true);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setHoveredDay(null);
      setDismissed(false);
      return;
    }
    const bars = event.currentTarget.parentElement?.querySelectorAll<SVGGElement>(".usage-day");
    if (!bars?.length) return;
    const next = event.key === "ArrowLeft" ? Math.max(0, index - 1)
      : event.key === "ArrowRight" ? Math.min(bars.length - 1, index + 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? bars.length - 1 : null;
    if (next !== null) {
      event.preventDefault();
      setHoveredDay(null);
      setDismissed(false);
      bars[next]?.focus();
    }
  }
  const sourceLabel = (source: "observed" | "self-reported" | "unknown") => source === "observed" ? copy.observed : source === "self-reported" ? copy.selfReported : copy.unknown;
  type LifetimeDisplayRow = UsageCounts & { version: "5.5" | "5.6" | "6" | "unknown"; source: "observed" | "self-reported" | "unknown" | null };
  const lifetimeRows = ready ? (["5.5", "5.6", "6", "unknown"] as const).flatMap<LifetimeDisplayRow>((version) => {
    const recorded = data.proLifetime.filter((row) => row.version === version);
    return recorded.length ? recorded : [{ version, source: null, accepted: 0, completed: 0, error: 0 }];
  }) : [];
  const card = (version: string, title: string, values: UsageCounts, dates: string) => <div className="usage-pro-card" data-pro-card={version}>
    <div className="usage-pro-heading"><strong>GPT-{version} Pro</strong><span>{title}</span></div>
    <div className="usage-pro-value"><strong data-accepted={values.accepted}>{number(values.accepted)}</strong><span>{copy.accepted}</span></div>
    <p>{dates}</p><p>{copy.completed} {number(values.completed)} <span aria-hidden="true">·</span> {copy.error} {number(values.error)}</p>
    {unrecorded(values) > 0 && <p>{copy.noOutcome} {number(unrecorded(values))}</p>}
  </div>;
  return <section className="usage-section" aria-labelledby={`${id}-title`} aria-busy={loading}>
    <div className="usage-header"><div><h2 id={`${id}-title`}>{copy.title}</h2><p>{copy.subtitle}</p></div>
      <button className="usage-refresh" onClick={onRefresh} disabled={loading}>{copy.refresh}</button></div>
    <div className="usage-range" role="group" aria-label={copy.range}>
      {([7, 30] as const).map((value) => <button key={value} aria-pressed={days === value} onClick={() => onDaysChange(value)}>{value === 7 ? copy.days7 : copy.days30}</button>)}
    </div>
    {loading ? <div className="usage-state" role="status">{copy.loading}</div> : !data || data.status === "error" || data.status === "unreadable" ?
      <div className="usage-state is-error" role="alert"><strong>{data?.status === "unreadable" ? copy.unreadable : copy.failed}</strong><p>{copy.errorBody}</p></div> : data.status === "empty" ?
        <div className="usage-state" role="status"><strong>{copy.empty}</strong><p>{copy.emptyBody}</p></div> : null}
    {ready && <>
      {data.warnings.length > 0 && <p className="usage-warning" role="status">{copy.timezoneChanged}</p>}
      <div className="usage-pro-cards">
        {card("5.6", copy.today, data.today5_6Pro, formatDay(data.today5_6Pro.day, language, true))}
        {card("6", copy.week, data.week6Pro, `${formatDay(data.week6Pro.startDay, language)} – ${formatDay(data.week6Pro.endDay, language, true)}`)}
      </div>
      <div className="usage-chart-heading"><h3>{copy.daily}</h3><div><strong data-usage-total={total}>{number(total)}</strong><span>{copy.total}</span></div></div>
      <div className="usage-chart">
        <svg viewBox="0 0 600 218" role="group" aria-label={`${copy.daily}: ${number(total)} ${copy.total}`}>
          {[0, 1, 2].map((tick) => <g key={tick} aria-hidden="true"><line className="usage-grid" x1="35" x2="594" y1={176 - tick * 76} y2={176 - tick * 76} /><text className="usage-axis" x="29" y={180 - tick * 76} textAnchor="end">{number(ceiling * tick / 2)}</text></g>)}
          {data.days.map((day, index) => {
            const step = 552 / Math.max(1, data.days.length);
            const x = 39 + index * step;
            let bottom = 176;
            const accepted = count(Object.values(day.tiers));
            const description = `${formatDay(day.day, language, true)}: ${number(accepted)} ${copy.accepted}. ${tiers.filter((tier) => day.tiers[tier].accepted > 0).map((tier) => `${labels[tier]} ${number(day.tiers[tier].accepted)}`).join(", ")}`;
            return <g key={day.day} tabIndex={day.day === tabDay ? 0 : -1} role="button"
              aria-label={description} className="usage-day"
              onFocus={() => { setFocusedDay(day.day); setHoveredDay(null); setDismissed(false); }}
              onBlur={() => setFocusedDay(null)}
              onMouseEnter={() => { setHoveredDay(day.day); setDismissed(false); }}
              onMouseLeave={() => setHoveredDay(null)}
              onClick={(event) => { event.currentTarget.focus(); setDismissed(false); }}
              onKeyDown={(event) => moveDay(event, index)}>
              <title>{description}</title>
              <rect className="usage-hit" x={x} y="18" width={step} height="160" rx="3" />
              {tiers.map((tier) => { const height = day.tiers[tier].accepted / ceiling * 152; bottom -= height;
                return height > 0 ? <rect key={tier} data-tier={tier} x={x + step * 0.18} y={bottom} width={step * 0.64} height={height} fill={colors[tier]} /> : null;
              })}
              {(index === 0 || index === data.days.length - 1 || (days === 7 ? index % 2 === 0 : index % 7 === 0 && data.days.length - 1 - index >= 3)) &&
                <text className="usage-axis" x={x + step / 2} y="200" textAnchor="middle" aria-hidden="true">{formatDay(day.day, language)}</text>}
            </g>;
          })}
        </svg>
        {selected && <div className="usage-tooltip" role="status"><strong>{formatDay(selected.day, language, true)}</strong><span>{copy.accepted} · {number(count(Object.values(selected.tiers)))}</span>
          {tiers.filter((tier) => selected.tiers[tier].accepted > 0).map((tier) => <div key={tier}><span><i style={{ background: colors[tier] }} />{labels[tier]}</span><b>{number(selected.tiers[tier].accepted)}</b></div>)}</div>}
      </div>
      <ul className="usage-legend" aria-label={copy.tier}>{activeTiers.map((tier) => <li key={tier}><i style={{ background: colors[tier] }} /><span>{labels[tier]}</span><b>{number(count(data.days.map((day) => day.tiers[tier])))}</b></li>)}</ul>
      {activeTiers.length === 0 && <p className="usage-note">{copy.none}</p>}
      <h3 className="usage-table-title">{copy.lifetime}</h3>
      <div className="usage-table-scroll"><table className="usage-table"><thead><tr>{[copy.version, copy.source, copy.accepted, copy.completed, copy.error, copy.noOutcome].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
        {lifetimeRows.map((row) => <tr key={`${row.version}-${row.source}`}><th scope="row">{row.version === "unknown" ? copy.proUnknown : `GPT-${row.version} Pro`}</th><td>{row.source ? sourceLabel(row.source) : "—"}</td><td>{number(row.accepted)}</td><td>{number(row.completed)}</td><td>{number(row.error)}</td><td>{number(unrecorded(row))}</td></tr>)}
      </tbody></table></div>
      <details className="usage-details"><summary>{copy.details}</summary><div className="usage-table-scroll"><table className="usage-table"><thead><tr>{[copy.date, copy.tier, copy.accepted, copy.completed, copy.error, copy.noOutcome].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
        {data.days.flatMap((day) => {
          const active = tiers.filter((tier) => Object.values(day.tiers[tier]).some((value) => value > 0));
          return active.length ? active.map((tier) => <tr key={`${day.day}-${tier}`}><th scope="row">{formatDay(day.day, language)}</th><td>{labels[tier]}</td><td>{number(day.tiers[tier].accepted)}</td><td>{number(day.tiers[tier].completed)}</td><td>{number(day.tiers[tier].error)}</td><td>{number(unrecorded(day.tiers[tier]))}</td></tr>) : [<tr key={day.day}><th scope="row">{formatDay(day.day, language)}</th><td>{copy.none}</td><td>0</td><td>0</td><td>0</td><td>0</td></tr>];
        })}
      </tbody></table></div></details>
    </>}
    <div className="usage-footnotes"><p>{copy.boundary}</p>
      {data && <p>{copy.timezone}: <span>{data.timezone}</span>{data.recordedSince && <> · {copy.since}: {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: data.timezone }).format(new Date(data.recordedSince))}</>}</p>}
      <details><summary>{copy.accepted} / {copy.completed}</summary><p>{copy.semantics}</p><p>{copy.outcomeHelp}</p><p>{copy.privacy}</p></details>
      <details><summary>{copy.storage}</summary><p>{copy.storageBody}</p><p>{copy.recovery}</p></details>
    </div>
  </section>;
}
