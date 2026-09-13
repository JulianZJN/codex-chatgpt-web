// Real React DOM with a controlled IPC boundary, no Electron or account access.
import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UsageStatisticsSection } from "../src/UsageStatistics";
import type { LauncherApi, UsageStatistics } from "../src/types";
import { fixture } from "./usage-ui.fixture-data";
import "../src/tokens.css";
import "../src/styles.css";

type Request = { id: number; days: 7 | 30; settled: boolean; resolve: (data: UsageStatistics) => void; reject: (error: Error) => void };
function RefreshFixture() {
  const [mounted, setMounted] = useState(true);
  const [requests, setRequests] = useState<Request[]>([]);
  const nextId = useRef(0);
  const api = useMemo(() => ({ getUsageStatistics({ days }: { days: 7 | 30 }) {
    return new Promise<UsageStatistics>((resolve, reject) => {
      const request = { id: ++nextId.current, days, settled: false, resolve, reject };
      setRequests((current) => [...current, request]);
    });
  } }) as LauncherApi, []);
  function settle(request: Request, status: UsageStatistics["status"] | "reject") {
    if (status === "reject") request.reject(new Error("Synthetic read failure"));
    else {
      const data = fixture(request.days, status);
      if (status === "ready") {
        // A visible request identity on the exact today card, with matching totals.
        data.days = structuredClone(data.days);
        data.days.at(-1)!.tiers.pro5_6.accepted += request.id;
        data.today5_6Pro.accepted += request.id;
        data.proLifetime.find((row) => row.version === "5.6")!.accepted += request.id;
      } else if (status === "error" || status === "unreadable") data.days = [];
      request.resolve(data);
    }
    setRequests((current) => current.map((row) => row.id === request.id ? { ...row, settled: true } : row));
  }
  return <main style={{ maxWidth: 720, margin: "24px auto", padding: "0 24px" }}>
    <header style={{ marginBottom: 24, fontSize: 12, lineHeight: 1.7 }}>
      <strong>Real React · synthetic IPC · no account access</strong>
      <p>Resolve the latest initial request. Strict Mode intentionally starts then cleans up the first effect. Request IDs appear on the GPT-5.6 Pro today card.</p>
      <button onClick={() => setMounted((value) => !value)}>{mounted ? "Unmount statistics" : "Mount statistics"}</button>{" "}
      <button onClick={() => window.dispatchEvent(new Event("focus"))}>Notify window focus</button>
      <p>Requests: {requests.length}. Quiet refreshes must preserve the chart while waiting. Resolve old requests last to check range and unmount races.</p>
      <ol>{requests.map((request) => <li key={request.id}>
        Request {request.id} · {request.days} days · {request.settled ? "settled" : "pending"}{" "}
        {!request.settled && (["ready", "empty", "unreadable", "reject"] as const).map((status) => <button key={status} onClick={() => settle(request, status)}>{status} #{request.id}</button>)}
      </li>)}</ol>
    </header>
    {mounted ? <UsageStatisticsSection api={api} language="en" /> : <p>Statistics unmounted</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><RefreshFixture /></StrictMode>);
