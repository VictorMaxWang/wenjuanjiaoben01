import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/manual-intervention.js", () => ({
  waitForManualIntervention: vi.fn(async () => undefined)
}));

import { createBrowserSession } from "../src/browser/browser-factory.js";
import { createAdapter } from "../src/adapters/factory.js";
import { SurveyCrawler } from "../src/crawler/survey-crawler.js";
import { Storage } from "../src/storage/storage.js";
import type { AppConfig } from "../src/types.js";
import { buildAppConfig, buildMockTargetUrl, createTempDir, removeTempDir } from "./test-helpers.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await createTempDir("integration-test");
});

afterEach(async () => {
  await removeTempDir(tempDir);
});

async function runLearn(config: AppConfig): Promise<void> {
  const storage = new Storage(config.bankFilePath, config.artifactsDir);
  await storage.initialize();
  const session = await createBrowserSession(config.headless);
  const adapter = createAdapter(config, session.page);
  const crawler = new SurveyCrawler(config, storage, adapter, session);

  try {
    await crawler.runLearningMode();
  } finally {
    await crawler.close();
  }
}

async function runExecute(config: AppConfig) {
  const storage = new Storage(config.bankFilePath, config.artifactsDir);
  await storage.initialize();
  const session = await createBrowserSession(config.headless);
  const adapter = createAdapter(config, session.page);
  const crawler = new SurveyCrawler(config, storage, adapter, session);

  try {
    return await crawler.runExecutionMode();
  } finally {
    await crawler.close();
  }
}

describe("integration flows", () => {
  it("learn mode builds a stable question bank from the mock survey", async () => {
    const config = buildAppConfig(tempDir, {
      targetUrl: buildMockTargetUrl(123)
    });

    await runLearn(config);

    const bank = await fs.readJson(config.bankFilePath);
    expect(Object.keys(bank.entries)).toHaveLength(3);
  });

  it("execute mode uses the bank and respects the configured per-question delay", async () => {
    const config = buildAppConfig(tempDir, {
      targetUrl: buildMockTargetUrl(123)
    });

    await runLearn(config);

    const startedAt = Date.now();
    const summary = await runExecute(config);
    const elapsed = Date.now() - startedAt;

    expect(summary.pausedForManualIntervention).toBe(false);
    expect(summary.answeredCount).toBe(3);
    expect(elapsed).toBeGreaterThanOrEqual(140);
  });

  it("execute mode records unknown questions and pauses for manual handling", async () => {
    const seedConfig = buildAppConfig(tempDir, {
      targetUrl: buildMockTargetUrl(123)
    });
    await runLearn(seedConfig);

    const executeConfig = buildAppConfig(tempDir, {
      targetUrl: buildMockTargetUrl(321),
      adapter: {
        type: "mock",
        mock: {
          scenario: "unknown"
        }
      }
    });

    const summary = await runExecute(executeConfig);
    const unknownDir = path.join(executeConfig.artifactsDir, "unknown-questions");
    const files = await fs.readdir(unknownDir);

    expect(summary.pausedForManualIntervention).toBe(true);
    expect(files.some((file) => file.endsWith(".json"))).toBe(true);
    expect(files.some((file) => file.endsWith(".html"))).toBe(true);
    expect(files.some((file) => file.endsWith(".png"))).toBe(true);
  });

  it("execute mode records captcha artifacts and pauses for manual handling", async () => {
    const seedConfig = buildAppConfig(tempDir, {
      targetUrl: buildMockTargetUrl(123)
    });
    await runLearn(seedConfig);

    const executeConfig = buildAppConfig(tempDir, {
      targetUrl: buildMockTargetUrl(123),
      adapter: {
        type: "mock",
        mock: {
          scenario: "captcha"
        }
      }
    });

    const summary = await runExecute(executeConfig);
    const captchaDir = path.join(executeConfig.artifactsDir, "captcha");
    const files = await fs.readdir(captchaDir);

    expect(summary.pausedForManualIntervention).toBe(true);
    expect(files.some((file) => file.endsWith(".html"))).toBe(true);
    expect(files.some((file) => file.endsWith(".png"))).toBe(true);
  });
});
