// Real App + isolated IPC boundary. Never opens an account or sends a model request.
import { createRoot } from "react-dom/client";
import type { BrowserState, Language, LauncherApi, LauncherSnapshot } from "../src/types";
import { fixture } from "./usage-ui.fixture-data";
import "../src/tokens.css";
import "../src/styles.css";

const languageParam = new URLSearchParams(location.search).get("language");
const language: Language = languageParam === "en" || languageParam === "ja" ? languageParam : "zh-CN";
const browser: BrowserState = {
  status: "ready", message: "Synthetic browser", url: "about:blank", title: "Synthetic browser", authenticated: true,
  visible: true, surfaceActive: false, loading: false, canGoBack: false, canGoForward: false, zoomFactor: 1,
  activeTabId: "fixture-tab", maxTabs: 5,
  tabs: [{ id: "fixture-tab", traceId: null, title: "Synthetic browser", status: "ready", loading: false, active: true, closable: false, interactionMode: "automatic" }],
};
const snapshot: LauncherSnapshot = {
  profile: "development", profilePaths: { coreHome: "synthetic", codexHome: "synthetic", userData: "synthetic" },
  state: { version: 1, language, onboardingComplete: true, githubOpened: false, xOpened: false, autoStart: false,
    keepRunningOnClose: true, showBrowserDuringTurns: true, browserInteractionMode: "automatic", experimentalBiggerContext: true,
    zeroRiskProEnabled: false, sidebarOpen: true, sidebarWidth: 252, coreSetupComplete: true, codexCatalogVerified: true,
    mcpSetupComplete: true, mcpGuideStep: 0, sessionRefreshReminderAt: null },
  browser, connectorName: "Synthetic connector", connectorNames: { automatic: "Synthetic connector", manual: "Synthetic manual" },
  mcpCredentialsConfigured: false, logs: [], urls: { github: "about:blank", x: "about:blank", connectors: "about:blank", tunnels: "about:blank", keys: "about:blank" },
  platform: "darwin", packaged: false, version: "5.0.6", smokePassed: true, operation: null, update: { status: "idle" },
};
let browserListener: ((value: BrowserState) => void) | undefined;
const activationHistory: boolean[] = [];
const api: Partial<LauncherApi> = {
  snapshot: async () => snapshot,
  getUsageStatistics: async ({ days }) => fixture(days, "ready"),
  onBrowserState: (listener) => { browserListener = listener; return () => { browserListener = undefined; }; },
  onStateChanged: () => () => {}, onOperation: () => () => {}, onLog: () => () => {}, onUpdateState: () => () => {},
  setBrowserSurfaceActive: async (active) => {
    activationHistory.push(active);
    browser.surfaceActive = active;
    document.getElementById("fixture-browser-state")!.textContent = `Synthetic · browser active: ${active} · transitions: ${activationHistory.join(" → ")}`;
    document.documentElement.dataset.browserActive = String(active);
    browserListener?.({ ...browser });
    return { ...browser };
  },
  setBrowserBounds: async () => true,
  setSidebarState: async (next) => { snapshot.state.sidebarOpen = next.open; snapshot.state.sidebarWidth = next.width; return snapshot.state; },
  setLanguage: async (next) => { snapshot.state.language = next; return snapshot.state; },
};
window.codexWebLauncher = new Proxy(api, { get(target, property) {
  if (property in target) return target[property as keyof LauncherApi];
  return () => { throw new Error(`Synthetic fixture blocks ${String(property)}`); };
} }) as LauncherApi;
const { App } = await import("../src/App");
createRoot(document.getElementById("root")!).render(<App />);
