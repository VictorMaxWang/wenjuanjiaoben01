import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import { resolveExecutionConfig } from "../src/config.js";
import { createTempDir, removeTempDir } from "./test-helpers.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await removeTempDir(tempDir);
    tempDir = undefined;
  }
});

describe("resolveExecutionConfig", () => {
  it("applies CLI overrides on top of the JSON config", async () => {
    tempDir = await createTempDir("config-test");
    const configPath = path.join(tempDir, "config.json");

    await fs.writeJson(
      configPath,
      {
        targetUrl: "file:///mock.html",
        adapter: { type: "mock", mock: { scenario: "default" } },
        headless: false,
        bankFilePath: "./question_bank.json",
        artifactsDir: "./run_logs",
        learn: {
          consecutiveKnownRuns: 1,
          maxAttempts: 2,
          testIdentity: {
            baseName: "测试账号",
            studentIdPrefix: "0000000",
            college: "软件学院"
          }
        },
        execute: {
          timePerQuestion: 2,
          identity: {
            name: "默认姓名",
            studentId: "0001",
            college: "默认学院"
          }
        }
      },
      { spaces: 2 }
    );

    const config = await resolveExecutionConfig({
      configPath,
      name: "真实姓名",
      studentId: "20260002",
      timePerQuestion: 5,
      headless: true
    });

    expect(config.execute.identity.name).toBe("真实姓名");
    expect(config.execute.identity.studentId).toBe("20260002");
    expect(config.execute.identity.college).toBe("默认学院");
    expect(config.execute.timePerQuestion).toBe(5);
    expect(config.headless).toBe(true);
  });

  it("accepts the wjx adapter type from JSON config", async () => {
    tempDir = await createTempDir("config-test");
    const configPath = path.join(tempDir, "config.json");

    await fs.writeJson(
      configPath,
      {
        targetUrl: "https://example.test/form",
        adapter: { type: "wjx" },
        headless: true,
        bankFilePath: "./question_bank.json",
        artifactsDir: "./run_logs",
        learn: {
          consecutiveKnownRuns: 1,
          maxAttempts: 2,
          testIdentity: {
            baseName: "测试账号",
            studentIdPrefix: "0000000",
            college: "软件学院"
          }
        },
        execute: {
          timePerQuestion: 1,
          identity: {
            name: "默认姓名",
            studentId: "0001",
            college: "默认学院"
          }
        }
      },
      { spaces: 2 }
    );

    const config = await resolveExecutionConfig({
      configPath
    });

    expect(config.adapter.type).toBe("wjx");
    expect(config.headless).toBe(true);
  });
});
