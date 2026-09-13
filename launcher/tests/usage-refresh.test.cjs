const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// Characterize the effect's request lifecycle with a lightweight hook harness.
// This does not simulate React commits, DOM focus, or event batching; the real
// React DOM boundary is available in usage-ui.refresh.fixture.html.
function mount(api) {
  const state = [];
  const effects = [];
  const timers = new Map();
  let cursor = 0;
  let collectEffects = true;
  const window = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = "visible";
  window.setInterval = (callback, milliseconds) => {
    assert.equal(milliseconds, 30_000);
    const id = timers.size + 1;
    timers.set(id, callback);
    return id;
  };
  window.clearInterval = (id) => timers.delete(id);
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useEffect(effect) { if (collectEffects) effects.push(effect); },
    useId() { return "usage-test"; },
  };
  const filename = path.join(__dirname, "../src/UsageStatistics.tsx");
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  Function("module", "exports", "require", "window", "document", output)(
    module, module.exports, (id) => {
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      if (id === "./usage-copy") return {};
      throw new Error(`Unexpected component dependency: ${id}`);
    }, window, document,
  );
  function render() {
    cursor = 0;
    const element = module.exports.UsageStatisticsSection({ api, language: "en" });
    collectEffects = false;
    return element.props;
  }
  render();
  let cleanup = effects.shift()();
  return {
    props: render,
    timers,
    focus: () => window.dispatchEvent(new Event("focus")),
    tick: () => { for (const callback of timers.values()) callback(); },
    visibility(value) {
      document.visibilityState = value;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    range(days) {
      render().onDaysChange(days);
      cleanup();
      collectEffects = true;
      render();
      cleanup = effects.shift()();
    },
    unmount: () => cleanup(),
  };
}

function controlledApi() {
  const calls = [];
  const pending = [];
  return {
    calls, pending,
    getUsageStatistics(input) {
      calls.push(input);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
  };
}
function statistics(days = 7, status = "ready") {
  const filename = path.join(__dirname, "usage-ui.fixture-data.ts");
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText;
  const module = { exports: {} };
  Function("module", "exports", output)(module, module.exports);
  const result = module.exports.fixture(days, status);
  if (status === "unreadable" || status === "error") result.days = [];
  return result;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("visible refreshes keep the current view and coalesce overlapping reads", async () => {
  const api = controlledApi();
  const view = mount(api);
  try {
    assert.deepEqual(api.calls, [{ days: 7 }]);
    const first = statistics();
    api.pending.shift().resolve(first);
    await settle();
    assert.equal(view.props().data, first);
    assert.equal(view.props().loading, false);
    view.tick();
    view.focus();
    view.tick();
    assert.equal(api.calls.length, 2);
    assert.equal(view.props().data, first);
    assert.equal(view.props().loading, false);
    const next = statistics();
    api.pending.shift().resolve(next);
    await settle();
    assert.equal(view.props().data, next);
  } finally { view.unmount(); }
});

test("hidden pages do not poll, and a failed refresh does not leave stale totals", async () => {
  const api = controlledApi();
  const view = mount(api);
  try {
    api.pending.shift().resolve(statistics());
    await settle();
    view.visibility("hidden");
    view.tick();
    view.focus();
    assert.equal(api.calls.length, 1);
    view.visibility("visible");
    assert.equal(api.calls.length, 2);
    api.pending.shift().reject(new Error("read failed"));
    await settle();
    assert.equal(view.props().data, null);
    assert.equal(view.props().loading, false);
  } finally { view.unmount(); }
});

test("range changes ignore the old request even when it finishes last", async () => {
  const api = controlledApi();
  const view = mount(api);
  try {
    const old = api.pending.shift();
    view.range(30);
    assert.deepEqual(api.calls, [{ days: 7 }, { days: 30 }]);
    const current = statistics(30);
    api.pending.shift().resolve(current);
    await settle();
    old.resolve(statistics());
    await settle();
    assert.equal(view.props().days, 30);
    assert.equal(view.props().data, current);
    assert.equal(view.timers.size, 1);
  } finally { view.unmount(); }
});

test("unmount removes timers and listeners and ignores an in-flight response", async () => {
  const api = controlledApi();
  const view = mount(api);
  view.unmount();
  assert.equal(view.timers.size, 0);
  view.focus();
  view.visibility("visible");
  view.tick();
  assert.equal(api.calls.length, 1);
  api.pending.shift().resolve(statistics());
  await settle();
  assert.equal(view.props().data, null);
});

test("an older launcher without the statistics method produces an error state", async () => {
  const view = mount({});
  try {
    await settle();
    assert.equal(view.props().data, null);
    assert.equal(view.props().loading, false);
  } finally { view.unmount(); }
});
test("a quiet unreadable response replaces previous totals and the next refresh can recover", async () => {
  const api = controlledApi();
  const view = mount(api);
  try {
    api.pending.shift().resolve(statistics());
    await settle();
    view.focus();
    api.pending.shift().resolve(statistics(7, "unreadable"));
    await settle();
    assert.equal(view.props().data.status, "unreadable");
    assert.deepEqual(view.props().data.days, []);
    view.focus();
    const recovered = statistics();
    api.pending.shift().resolve(recovered);
    await settle();
    assert.equal(view.props().data, recovered);
    assert.equal(view.props().loading, false);
  } finally { view.unmount(); }
});
