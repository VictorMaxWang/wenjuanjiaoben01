import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Storage } from "../src/storage/storage.js";
import { createTempDir, removeTempDir } from "./test-helpers.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await removeTempDir(tempDir);
    tempDir = undefined;
  }
});

describe("Storage", () => {
  it("merges entries and persists them atomically", async () => {
    tempDir = await createTempDir("storage-test");
    const storage = new Storage(path.join(tempDir, "question_bank.json"), path.join(tempDir, "run_logs"));
    await storage.initialize();

    await storage.upsertEntries([
      {
        questionText: "HTML 的标准缩写是？",
        normalizedText: "html 的标准缩写是？",
        type: "single",
        options: [{ value: "A", label: "HTML" }],
        correctAnswers: ["HTML"],
        source: {
          adapterType: "mock",
          url: "file:///mock",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      }
    ]);

    await storage.upsertEntries([
      {
        questionText: "Node.js 常用来运行哪种语言？",
        normalizedText: "node.js 常用来运行哪种语言？",
        type: "single",
        options: [{ value: "A", label: "JavaScript" }],
        correctAnswers: ["JavaScript"],
        source: {
          adapterType: "mock",
          url: "file:///mock",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      }
    ]);

    const bank = await storage.loadBank();
    expect(Object.keys(bank.entries)).toHaveLength(2);
    expect(bank.entries["html 的标准缩写是？"]?.correctAnswers).toEqual(["HTML"]);
    expect(bank.entries["node.js 常用来运行哪种语言？"]?.correctAnswers).toEqual(["JavaScript"]);
  });
});
