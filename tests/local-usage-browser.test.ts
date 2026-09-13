import { expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import type { Locator, Page } from "playwright-core";
import { ChatGptBrowserWorker, observeChatGptUsageProVersion } from "../src/adapters/chatgpt-web/browser-worker";

test("usage observation reads individual live description nodes without mistaking help text for Pro", async () => {
  const descriptions: Record<string, string> = { help: "Choose Pro for the hardest tasks", state: "5.6 Instant, item 1 of 5." };
  const context = createContext({ document: { getElementById: (id: string) => ({ textContent: descriptions[id] }) } });
  const slider = { evaluate: async (fn: Function) => runInContext(`(${fn.toString()})`, context)({
    getAttribute: () => "help state",
  }) } as unknown as Locator;
  expect(await observeChatGptUsageProVersion(slider)).toBeUndefined();
  descriptions.state = "5.6 Pro，第 5 项，共 5 项。";
  expect(await observeChatGptUsageProVersion(slider)).toBe("5.6");
  descriptions.state = "GPT-6 Astra Pro, item 5 of 5.";
  expect(await observeChatGptUsageProVersion(slider)).toBe("6");
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
