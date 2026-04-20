import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import type { AppConfig } from "../src/types.js";

export async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

export async function removeTempDir(dirPath: string): Promise<void> {
  await fs.remove(dirPath);
}

export function buildMockTargetUrl(seed: number): string {
  const filePath = path.resolve(process.cwd(), "mock", "mock-survey.html");
  const url = pathToFileURL(filePath);
  url.searchParams.set("seed", String(seed));
  return url.toString();
}

export function buildAppConfig(baseDir: string, overrides?: Partial<AppConfig>): AppConfig {
  return {
    targetUrl: buildMockTargetUrl(123),
    adapter: {
      type: "mock",
      mock: {
        scenario: "default"
      }
    },
    headless: true,
    bankFilePath: path.join(baseDir, "question_bank.json"),
    artifactsDir: path.join(baseDir, "run_logs"),
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
      timePerQuestion: 0.05,
      identity: {
        name: "张三",
        studentId: "20260001",
        college: "软件学院"
      }
    },
    ...overrides
  };
}
