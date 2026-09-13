// Synthetic, network-free UI fixture. Does not import the launcher or call IPC.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { UsageStatisticsView } from "../src/UsageStatistics";
import type { Language, UsageStatistics } from "../src/types";
import { fixture } from "./usage-ui.fixture-data";
import "../src/tokens.css";
import "../src/styles.css";

function Fixture() {
  const [days, setDays] = useState<7 | 30>(7);
  const [language, setLanguage] = useState<Language>("zh-CN");
  const [state, setState] = useState<UsageStatistics["status"] | "loading">("ready");
  return <main style={{ maxWidth: 672, margin: "24px auto", padding: "0 24px", overflow: "visible" }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 28, fontSize: 12, color: "#afafaf" }}>
      <span>Synthetic fixture · no account access</span>
      <label>Language <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option></select></label>
      <label>State <select value={state} onChange={(event) => setState(event.target.value as typeof state)}>{["ready", "empty", "loading", "unreadable", "error"].map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>
    <UsageStatisticsView data={fixture(days, state === "loading" ? "ready" : state)} language={language} days={days} loading={state === "loading"} onDaysChange={setDays} onRefresh={() => setState("ready")} />
  </main>;
}
document.body.style.overflow = "auto";
createRoot(document.getElementById("root")!).render(<Fixture />);
