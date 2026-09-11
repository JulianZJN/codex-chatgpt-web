from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"{label}: expected source block not found in {path}")
    path.write_text(text.replace(old, new, 1))


worker = Path("src/adapters/chatgpt-web/browser-worker.ts")
replace_once(
    worker,
    '''function chatGptPinnedModelError(version: ChatGptWebProModelVersion, cause?: unknown): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    `ChatGPT Pro model version ${version} could not be selected and verified. The pending prompt was not sent; check that this version is available in ChatGPT.`,
    { status: 400, errorType: "invalid_request_error", code: "model_version_unavailable", retryable: false, cause },
  );
}

async function assertChatGptSelectedModelVersion(
''',
    '''function chatGptPinnedModelError(version: ChatGptWebProModelVersion, cause?: unknown): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    `ChatGPT Pro model version ${version} could not be selected and verified. The pending prompt was not sent; check that this version is available in ChatGPT.`,
    { status: 400, errorType: "invalid_request_error", code: "model_version_unavailable", retryable: false, cause },
  );
}

function chatGptProModelOptionName(version: ChatGptWebProModelVersion): RegExp {
  if (version === "5.6") return /^GPT[-\s]?5\.6\s+Sol(?:\s+Pro)?$/i;
  if (version === "5.5") return /^GPT[-\s]?5\.5(?:\s+Pro)?$/i;
  return /^(?:Latest|最新|GPT[-\s]?6(?:\s+Astra)?(?:\s+Pro)?)$/i;
}

function chatGptModelStateMatches(
  descriptions: readonly string[],
  version: ChatGptWebProModelVersion,
  requirePro: boolean,
): boolean {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const versionPrefix = new RegExp(
    `^(?:GPT[-\\s]?)?${escapedVersion}(?=$|\\s|[,，:：;；()（）·•—–-])`,
    "i",
  );
  return descriptions.some(description => {
    const normalized = description.replace(/\s+/g, " ").trim();
    return versionPrefix.test(normalized)
      && (!requirePro || /\bPro\b/i.test(normalized));
  });
}

async function assertChatGptSelectedModelVersion(
''',
    "add strict model-option and state helpers",
)
replace_once(
    worker,
    '''  const keyboardControl = slider.locator("xpath=ancestor::*[@role='menuitem'][1]");
  const descriptionIds = (await keyboardControl.getAttribute("aria-describedby"))?.trim().split(/\s+/).filter(Boolean) ?? [];
  const label = (await page.evaluate(ids => ids.map(id => document.getElementById(id)?.textContent ?? "").join(" "), descriptionIds)).trim();
  // "Latest" is not a version. Its slider must still prove 6; a future 7 fails closed.
  const prefix = version.replaceAll(".", "\\.");
  if (!new RegExp(`^(?:GPT[-\\s]?)?${prefix}(?:\\s|$)`, "i").test(label)
    || (requirePro && !/\bPro\b/i.test(label))) {
    throw chatGptPinnedModelError(version);
  }
''',
    '''  const keyboardControl = slider.locator("xpath=ancestor::*[@role='menuitem'][1]");
  const descriptionIds = (await keyboardControl.getAttribute("aria-describedby"))?.trim().split(/\s+/).filter(Boolean) ?? [];
  const descriptions = await page.evaluate(
    ids => ids
      .map(id => document.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean),
    descriptionIds,
  );
  // "Latest" is not a version. Its slider must still prove 6; a future 7 fails closed.
  // Version and Pro must come from the same described state node: unrelated instructions
  // mentioning Pro are not proof that the selected effort is actually Pro.
  if (!chatGptModelStateMatches(descriptions, version, requirePro)) {
    throw chatGptPinnedModelError(version);
  }
''',
    "make aria-describedby verification order-independent and same-node strict",
)
replace_once(
    worker,
    '''        const modelName = modelVersion === "5.6" ? "GPT-5.6 Sol"
          : modelVersion === "5.5" ? "GPT-5.5" : /^(?:Latest|最新)$/;
        const option = activation.menu.getByRole("menuitemradio", { name: modelName, exact: true });
''',
    '''        const modelName = chatGptProModelOptionName(modelVersion);
        const option = activation.menu.getByRole("menuitemradio", { name: modelName, exact: true });
''',
    "accept explicit current GPT-6 labels without broad fallback matching",
)
replace_once(
    worker,
    '''      try {
        const { slider } = await activateChatGptEffortMenu(page, control);
        await assertChatGptSelectedModelVersion(page, slider, expectedMode.modelVersion, expectedMode.effort === "max");
        const state = parseChatGptEffortSliderState(
          await slider.getAttribute("aria-valuemin"), await slider.getAttribute("aria-valuemax"),
          await slider.getAttribute("aria-valuenow"),
        );
        if (!state || expectedMode.uiEffortIndex === null || state.value !== state.min + expectedMode.uiEffortIndex) {
          throw chatGptPinnedModelError(expectedMode.modelVersion);
        }
      } catch (error) {
        throw chatGptPinnedModelError(expectedMode.modelVersion, error);
      } finally {
        await page.keyboard.press("Escape");
      }
''',
    '''      let verificationError: ChatGptWebAdapterError | undefined;
      try {
        const { slider } = await activateChatGptEffortMenu(page, control);
        await assertChatGptSelectedModelVersion(page, slider, expectedMode.modelVersion, expectedMode.effort === "max");
        const state = parseChatGptEffortSliderState(
          await slider.getAttribute("aria-valuemin"), await slider.getAttribute("aria-valuemax"),
          await slider.getAttribute("aria-valuenow"),
        );
        if (!state || expectedMode.uiEffortIndex === null || state.value !== state.min + expectedMode.uiEffortIndex) {
          throw chatGptPinnedModelError(expectedMode.modelVersion);
        }
      } catch (error) {
        verificationError = chatGptPinnedModelError(expectedMode.modelVersion, error);
        throw verificationError;
      } finally {
        try {
          await page.keyboard.press("Escape");
        } catch (cleanupError) {
          // Preserve a safety-relevant model mismatch instead of replacing it with cleanup noise.
          // After successful verification, however, a menu that cannot be closed still fails closed.
          if (!verificationError) throw cleanupError;
        }
      }
''',
    "preserve primary verification errors while keeping successful cleanup fail-closed",
)

test_file = Path("tests/pro-model-selection.test.ts")
replace_once(
    test_file,
    '''function picker(options: { unavailable?: boolean; actualVersion?: string; max?: number } = {}) {
  let version = "6", value = 0, submenu = false;
''',
    '''function picker(options: {
  unavailable?: boolean;
  actualVersion?: string;
  max?: number;
  descriptionTexts?: readonly string[];
  modelOptions?: Array<{ role: string; name: string; version: string }>;
} = {}) {
  let version = "6", value = 0, submenu = false;
  let keyboardFailure: string | undefined;
''',
    "extend picker fixture controls",
)
replace_once(
    test_file,
    "  const modelOptions = observedPicker.options;\n",
    "  const modelOptions = options.modelOptions ?? observedPicker.options;\n",
    "allow explicit model-option fixtures",
)
replace_once(
    test_file,
    '''    evaluate: async (_fn: unknown, ids: string[]) => {
      expect(ids).toEqual(["picker-value", "picker-instructions"]);
      return `${options.actualVersion ?? version} ${value === 4 ? "Pro" : "Instant"}，第 ${value + 1} 项，共 5 项。 ${observedPicker.descriptions["picker-instructions"]}`;
    },
''',
    '''    evaluate: async (fn: unknown, ids: string[]) => {
      expect(ids).toEqual(["picker-value", "picker-instructions"]);
      const descriptions = options.descriptionTexts ?? [
        `${options.actualVersion ?? version} ${value === 4 ? "Pro" : "Instant"}，第 ${value + 1} 项，共 5 项。`,
        observedPicker.descriptions["picker-instructions"],
      ];
      const previousDocument = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: (id: string) => {
          const index = ids.indexOf(id);
          return index < 0 ? null : { textContent: descriptions[index] };
        },
      };
      try {
        return (fn as (descriptionIds: string[]) => unknown)(ids);
      } finally {
        if (previousDocument === undefined) delete (globalThis as any).document;
        else (globalThis as any).document = previousDocument;
      }
    },
''',
    "execute the real page.evaluate DOM parser in tests",
)
replace_once(
    test_file,
    "    keyboard: { press: async () => {} },\n",
    '''    keyboard: { press: async () => {
      if (keyboardFailure) throw new Error(keyboardFailure);
    } },
''',
    "inject keyboard cleanup failures",
)
replace_once(
    test_file,
    "    setEffort: (next: number) => { value = next; },\n",
    '''    setEffort: (next: number) => { value = next; },
    failKeyboardCleanup: (message = "keyboard cleanup failed") => { keyboardFailure = message; },
''',
    "expose keyboard failure control",
)
replace_once(
    test_file,
    '''test.each(["5.6", "5.5", "6"])("explicit Pro version %s is selected before effort", async version => {
  const fixture = picker();
  await fixture.select(version);
  expect(fixture.state()).toEqual({ version, value: 4 });
  expect(fixture.actions[0]).toBe("open-versions");
  expect(fixture.actions[1]).toBe(`selected:${version}`);
  expect(fixture.actions.slice(2)).toEqual(Array(4).fill(`${version}:ArrowRight`));
});
''',
    '''test.each(["5.6", "5.5", "6"])("explicit Pro version %s is selected before effort", async version => {
  const fixture = picker();
  await fixture.select(version);
  expect(fixture.state()).toEqual({ version, value: 4 });
  expect(fixture.actions[0]).toBe("open-versions");
  expect(fixture.actions[1]).toBe(`selected:${version}`);
  expect(fixture.actions.slice(2)).toEqual(Array(4).fill(`${version}:ArrowRight`));
});

test("an explicit GPT-6 Astra option is accepted without weakening version proof", async () => {
  const fixture = picker({
    modelOptions: [
      { role: "menuitemradio", name: "GPT-6 Astra", version: "6" },
      ...observedPicker.options.filter(option => option.version !== "6"),
    ],
  });
  await fixture.select("6");
  expect(fixture.state()).toEqual({ version: "6", value: 4 });
});

test("nearby GPT-6 labels are not accepted as the pinned model", async () => {
  const fixture = picker({
    modelOptions: [
      { role: "menuitemradio", name: "GPT-6 Mini", version: "6" },
      ...observedPicker.options.filter(option => option.version !== "6"),
    ],
  });
  await expect(fixture.select("6")).rejects.toThrow("6");
});

test("model-state verification is independent of aria-describedby order", async () => {
  const fixture = picker({
    descriptionTexts: [
      observedPicker.descriptions["picker-instructions"],
      "5.6 Pro，第 5 项，共 5 项。",
    ],
  });
  await fixture.select("5.6");
  expect(fixture.state()).toEqual({ version: "5.6", value: 4 });
});

test("an unrelated instruction mentioning Pro cannot validate an Instant state", async () => {
  const fixture = picker({
    descriptionTexts: [
      "5.6 Instant，第 1 项，共 5 项。",
      "Choose Pro for the most difficult tasks.",
    ],
  });
  await expect(fixture.select("5.6")).rejects.toThrow("5.6");
});
''',
    "add model-option and described-state regressions",
)
replace_once(
    test_file,
    '''test("a version reset during connector or file attachment prevents the send activation", async () => {
  const fixture = picker({ actualVersion: "6" });
  await expect(fixture.send("5.6")).rejects.toThrow("5.6");
  expect(fixture.actions).not.toContain("SEND");
});
''',
    '''test("a version reset during connector or file attachment prevents the send activation", async () => {
  const fixture = picker({ actualVersion: "6" });
  await expect(fixture.send("5.6")).rejects.toThrow("5.6");
  expect(fixture.actions).not.toContain("SEND");
});

test("menu cleanup failure cannot mask a pre-send model mismatch", async () => {
  const fixture = picker({ actualVersion: "6" });
  fixture.failKeyboardCleanup();
  await expect(fixture.send("5.6")).rejects.toThrow("5.6");
  expect(fixture.actions).not.toContain("SEND");
});

test("menu cleanup failure still blocks a send after successful verification", async () => {
  const fixture = picker();
  await fixture.select("5.6");
  fixture.failKeyboardCleanup();
  await expect(fixture.send("5.6")).rejects.toThrow("keyboard cleanup failed");
  expect(fixture.actions).not.toContain("SEND");
});
''',
    "add cleanup error precedence regressions",
)
