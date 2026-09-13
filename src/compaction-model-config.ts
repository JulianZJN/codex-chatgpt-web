import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import {
  parseChatGptWebCompactionModel,
  type ChatGptWebCompactionModel,
} from "./chatgpt-web-compaction-policy";
import { loadConfig, saveConfig, type AppConfig } from "./config";
import { readLauncherBrowserHostDescriptor } from "./launcher-browser-host";

export function authorizeLauncherControl(operation: string): string {
  const descriptorPath = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR?.trim();
  const supplied = process.env.CODEX_WEB_GPT_LAUNCHER_CONTROL_TOKEN?.trim();
  delete process.env.CODEX_WEB_GPT_LAUNCHER_CONTROL_TOKEN;
  if (!descriptorPath || !supplied) {
    throw new Error(`Launcher-controlled ${operation} requires a live launcher authorization`);
  }
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const expectedBytes = Buffer.from(descriptor.control.token);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    throw new Error(`Launcher-controlled ${operation} authorization is invalid`);
  }
  return descriptorPath;
}

function updateCompactionModel(
  config: AppConfig,
  model: ChatGptWebCompactionModel | undefined,
): void {
  if (model === undefined) delete config.compactionModel;
  else config.compactionModel = model;
}

export async function runCompactionModelConfigCommand(args: string[]): Promise<void> {
  const action = args.shift();
  const rawModel = args.shift();
  const launcherControlIndex = args.indexOf("--launcher-control");
  const launcherControl = launcherControlIndex >= 0;
  if (launcherControl) args.splice(launcherControlIndex, 1);
  if (action !== "compaction-model" || !rawModel || args.length > 0) {
    throw new Error(
      "Config command must be: config compaction-model <follow|extra-high|5.6-pro|5.5-pro> --launcher-control",
    );
  }
  let model: ChatGptWebCompactionModel | undefined;
  if (rawModel !== "follow") {
    try {
      model = parseChatGptWebCompactionModel(rawModel);
    } catch {
      throw new Error("Invalid compaction model; choose follow, extra-high, 5.6-pro, or 5.5-pro");
    }
  }
  if (!launcherControl) {
    throw new Error("Compaction model must be changed through Codex Web GPT Settings");
  }
  const authorizedDescriptorPath = authorizeLauncherControl("compaction model configuration");
  const config = loadConfig();
  if (config.browserHost !== "launcher" || !config.browserHostDescriptorPath
    || resolve(config.browserHostDescriptorPath) !== resolve(authorizedDescriptorPath)) {
    throw new Error("Launcher authorization does not own this configuration");
  }
  // The daemon samples this preference once when the next eligible compaction request begins.
  // Saving it does not interrupt or retarget a browser operation that is already active.
  updateCompactionModel(config, model);
  saveConfig(config);
  process.stdout.write(`${JSON.stringify({ compactionModel: model ?? null })}\n`);
}
