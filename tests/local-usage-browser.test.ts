import { expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import type { Locator, Page } from "playwright-core";
import { ChatGptBrowserWorker, observeChatGptUsageProVersion } from "../src/adapters/chatgpt-web/browser-worker";

function usageSliderForDom({
  descriptions,
  ownerDescribedBy,
  sliderDescribedBy,
}: {
  descriptions: Record<string, string>;
  ownerDescribedBy?: string;
  sliderDescribedBy?: string;
}): Locator {
  const context = createContext({
    document: {
      getElementById: (id: string) => id in descriptions ? { textContent: descriptions[id] } : null,
    },
  });
  const menuitem = ownerDescribedBy === undefined ? null : {
    getAttribute: (name: string) => name === "aria-describedby" ? ownerDescribedBy : null,
  };
  const slider = {
    getAttribute: (name: string) => name === "aria-describedby" ? sliderDescribedBy ?? null : null,
    closest: (selector: string) => selector === '[role="menuitem"]' ? menuitem : null,
  };
  return {
    evaluate: async (fn: Function) => runInContext(`(${fn.toString()})`, context)(slider),
  } as unknown as Locator;
}

test("usage observation reads Pro versions from the slider's owning menuitem descriptions", async () => {
  for (const [description, version] of [
    ["GPT-5.5 Pro, item 5 of 5.", "5.5"],
    ["5.6 Pro，第 5 项，共 5 项。", "5.6"],
    ["GPT-6 Astra Pro, item 5 of 5.", "6"],
  ] as const) {
    const slider = usageSliderForDom({
      ownerDescribedBy: "picker-value picker-instructions",
      descriptions: {
        "picker-value": description,
        "picker-instructions": "Use the left and right arrow keys to adjust capability.",
      },
    });
    expect(await observeChatGptUsageProVersion(slider)).toBe(version);
  }
});

test("usage observation does not infer Pro from help, missing, non-Pro, or ambiguous descriptions", async () => {
  const cases: Record<string, string>[] = [
    { help: "Choose Pro for the hardest tasks", state: "5.6 Instant, item 1 of 5." },
    { state: "5.6 Instant, item 1 of 5." },
    { first: "5.6 Pro, item 5 of 5.", second: "GPT-6 Astra Pro, item 5 of 5." },
    {},
  ];
  for (const descriptions of cases) {
    const slider = usageSliderForDom({
      ownerDescribedBy: Object.keys(descriptions).join(" "),
      descriptions,
    });
    expect(await observeChatGptUsageProVersion(slider)).toBeUndefined();
  }
});

test("usage observation keeps legacy slider-owned descriptions and treats detached DOM as unknown", async () => {
  const slider = usageSliderForDom({
    sliderDescribedBy: "state",
    descriptions: { state: "5.6 Pro, item 5 of 5." },
  });
  expect(await observeChatGptUsageProVersion(slider)).toBe("5.6");
  const unavailable = { evaluate: async () => { throw new Error("detached"); } } as unknown as Locator;
  expect(await observeChatGptUsageProVersion(unavailable)).toBeUndefined();
});

for (const accepted of [false, true]) test(`usage callback follows semantic acceptance, not Send activation (${accepted})`, async () => {
  const events: string[] = [];
  const hidden = { filter() { return this; }, last() { return this; }, getByText() { return this; }, isVisible: async () => false };
  const page = { isClosed: () => false, locator: () => hidden } as unknown as Page;
  const send = { waitFor: async () => {}, isEnabled: async () => true, press: async () => { events.push("send"); } };
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    activeComposer: async () => ({ locator: () => ({ getByTestId: () => send }) }),
    waitForSubmissionAcceptedWithRecovery: async () => {
      events.push("evidence");
      if (!accepted) throw new Error("not accepted");
      return "user_turn";
    },
  });
  const operation = worker.sendAttachedPrompt(page, {}, undefined, undefined, undefined, {
    onSubmitted: () => { events.push("submitted"); },
  }, undefined, undefined, () => { events.push("usage"); });
  if (accepted) {
    expect(await operation).toBe("user_turn");
    expect(events).toEqual(["send", "evidence", "usage", "submitted"]);
  } else {
    await expect(operation).rejects.toThrow("not accepted");
    expect(events).toEqual(["send", "evidence"]);
  }
});
