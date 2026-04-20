import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import type { AppConfig, Identity } from "./types.js";

const identitySchema = z.object({
  name: z.string().min(1),
  studentId: z.string().min(1),
  college: z.string().min(1)
});

const appConfigSchema = z.object({
  targetUrl: z.string().min(1),
  adapter: z.object({
    type: z.literal("mock"),
    mock: z
      .object({
        scenario: z.enum(["default", "captcha", "unknown"]).default("default")
      })
      .optional()
  }),
  headless: z.boolean().default(false),
  bankFilePath: z.string().default("./question_bank.json"),
  artifactsDir: z.string().default("./run_logs"),
  learn: z.object({
    consecutiveKnownRuns: z.number().int().positive().default(2),
    maxAttempts: z.number().int().positive().default(10),
    testIdentity: z.object({
      baseName: z.string().min(1).default("测试账号"),
      studentIdPrefix: z.string().min(1).default("0000000"),
      college: z.string().min(1).default("软件学院")
    })
  }),
  execute: z.object({
    timePerQuestion: z.number().nonnegative().default(2),
    identity: identitySchema
  })
});

export interface CliExecutionOverrides {
  configPath?: string;
  name?: string;
  studentId?: string;
  college?: string;
  timePerQuestion?: number;
  headless?: boolean;
}

export interface CliLearnOverrides {
  configPath?: string;
  headless?: boolean;
}

export async function loadAppConfig(configPath?: string): Promise<AppConfig> {
  const resolvedPath = path.resolve(configPath ?? "./config.json");
  const configDir = path.dirname(resolvedPath);
  const raw = await fs.readJson(resolvedPath);
  const parsed = appConfigSchema.parse(raw);

  return {
    ...parsed,
    bankFilePath: path.resolve(configDir, parsed.bankFilePath),
    artifactsDir: path.resolve(configDir, parsed.artifactsDir)
  };
}

export async function resolveExecutionConfig(overrides: CliExecutionOverrides): Promise<AppConfig> {
  const config = await loadAppConfig(overrides.configPath);

  const identity: Identity = {
    name: overrides.name ?? config.execute.identity.name,
    studentId: overrides.studentId ?? config.execute.identity.studentId,
    college: overrides.college ?? config.execute.identity.college
  };

  return {
    ...config,
    headless: overrides.headless ?? config.headless,
    execute: {
      ...config.execute,
      timePerQuestion: overrides.timePerQuestion ?? config.execute.timePerQuestion,
      identity
    }
  };
}

export async function resolveLearnConfig(overrides: CliLearnOverrides): Promise<AppConfig> {
  const config = await loadAppConfig(overrides.configPath);

  return {
    ...config,
    headless: overrides.headless ?? config.headless
  };
}
