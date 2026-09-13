const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ensurePackagedRuntime } = require("../electron/runtime-install.cjs");
const { resolveLauncherProfile } = require("../electron/profile.cjs");
const { getUsageStatistics } = require("../electron/local-usage.cjs");

function writeBundle(resourcesPath, version) {
  const root = path.join(resourcesPath, "runtime");
  const launcher = `bin/${process.platform === "win32" ? "codex-chatgpt-web.cmd" : "codex-chatgpt-web"}`;
  const executable = `runtime/${process.platform === "win32" ? "bun.exe" : "bun"}`;
  const files = Object.entries({
    "app/browser-helper.cjs": "module.exports = {};",
    "app/cli.js": `// fixture ${version}`,
    [launcher]: "fixture launcher",
    [executable]: "fixture runtime",
  }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, content]) => {
    const filePath = path.join(root, ...name.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return { path: name, size: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex") };
  });
  if (process.platform !== "win32") fs.chmodSync(path.join(root, executable), 0o755);
  const digest = createHash("sha256");
  for (const file of files) digest.update(`${file.path}\0${file.size}\0${file.sha256}\0`);
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({
    schemaVersion: 2, appVersion: version, platform: process.platform, arch: process.arch,
    bunVersion: "1.4.0", playwright: "1.62.0", launcher, entrypoint: "app/cli.js",
    bundleId: digest.digest("hex"), files,
  }));
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-upgrade-"));
  const coreHome = path.join(root, "core-home");
  const filePath = path.join(coreHome, "usage", "local-usage.json");
  const counts = { accepted: 3, completed: 2, error: 1 };
  const at = "2026-09-13T06:00:00.000Z";
  const contents = JSON.stringify({
    version: 1, recordedSince: at, updatedAt: at, timezones: ["UTC"],
    days: [{ day: "2026-09-13", tiers: { pro6: counts } }],
    proLifetime: [{ version: "6", source: "observed", ...counts, firstRecordedAt: at, lastRecordedAt: at }],
    receipts: [], receiptHorizon: null,
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  fs.writeFileSync(`${filePath}.bak`, contents);
  function check() {
    assert.equal(fs.readFileSync(filePath, "utf8"), contents);
    assert.equal(fs.readFileSync(`${filePath}.bak`, "utf8"), contents);
    const stats = getUsageStatistics({ coreHome, input: { days: 7 }, now: Date.parse(at), timeZone: "UTC" });
    assert.equal(stats.status, "ready");
    assert.equal(stats.week6Pro.accepted, 3);
    assert.equal(stats.proLifetime[0].accepted, 3);
  }
  return { root, coreHome, check };
}

test("runtime upgrade and same-version repair leave usage and its backup byte-for-byte intact", () => {
  const { root, coreHome, check } = fixture();
  try {
    for (const version of ["0.1.0", "0.2.0"]) {
      const resourcesPath = path.join(root, `installation-${version}`);
      writeBundle(resourcesPath, version);
      const app = { isPackaged: true, getVersion: () => version };
      const installed = ensurePackagedRuntime({ app, coreHome, resourcesPath });
      check();
      fs.writeFileSync(path.join(installed, "app", "cli.js"), "incomplete update");
      ensurePackagedRuntime({ app, coreHome, resourcesPath });
      assert.equal(fs.readFileSync(path.join(installed, "app", "cli.js"), "utf8"), `// fixture ${version}`);
      check();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a rejected update does not reset usage", () => {
  const { root, coreHome, check } = fixture();
  try {
    const resourcesPath = path.join(root, "installation");
    writeBundle(resourcesPath, "0.1.0");
    assert.throws(() => ensurePackagedRuntime({
      app: { isPackaged: true, getVersion: () => "0.2.0" }, coreHome, resourcesPath,
    }), /identity mismatch/);
    check();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the production usage path is independent of launcher data and the DEV profile", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-profile-"));
  try {
    const defaults = { argv: [], env: {}, homeDir: root, appData: path.join(root, "app-data") };
    const production = resolveLauncherProfile(defaults);
    const relocated = resolveLauncherProfile({
      ...defaults, env: { CODEX_WEB_GPT_LAUNCHER_DATA_DIR: path.join(root, "new-launcher-data") },
    });
    assert.equal(production.coreHome, path.join(root, ".codex-chatgpt-web"));
    assert.equal(relocated.coreHome, production.coreHome);
    assert.notEqual(relocated.userData, production.userData);
    const custom = resolveLauncherProfile({ ...defaults, env: { CODEX_CHATGPT_WEB_HOME: path.join(root, "custom-home") } });
    assert.equal(custom.coreHome, path.join(root, "custom-home"));
    assert.notEqual(resolveLauncherProfile({ ...defaults, argv: ["--dev-profile"] }).coreHome, production.coreHome);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
