import path from "node:path";
import fs from "fs-extra";
import type { QuestionBankEntry, QuestionBankFile, RunArtifactPayload } from "../types.js";
import { normalizeQuestionText } from "../utils/text.js";
import { nowIso, timestampTag } from "../utils/time.js";

const EMPTY_BANK: QuestionBankFile = {
  updatedAt: "",
  entries: {}
};

export class Storage {
  public constructor(
    private readonly bankFilePath: string,
    private readonly artifactsDir: string
  ) {}

  public async initialize(): Promise<void> {
    await fs.ensureDir(path.dirname(this.bankFilePath));
    await fs.ensureDir(this.artifactsDir);
  }

  public async loadBank(): Promise<QuestionBankFile> {
    if (!(await fs.pathExists(this.bankFilePath))) {
      return {
        updatedAt: EMPTY_BANK.updatedAt,
        entries: {}
      };
    }

    const bank = (await fs.readJson(this.bankFilePath)) as QuestionBankFile;
    return {
      updatedAt: bank.updatedAt,
      entries: bank.entries ?? {}
    };
  }

  public async findByQuestionText(text: string): Promise<QuestionBankEntry | undefined> {
    const bank = await this.loadBank();
    return bank.entries[normalizeQuestionText(text)];
  }

  public async upsertEntries(entries: QuestionBankEntry[]): Promise<QuestionBankFile> {
    const bank = await this.loadBank();

    for (const entry of entries) {
      bank.entries[entry.normalizedText] = entry;
    }

    bank.updatedAt = nowIso();
    await this.atomicWriteJson(this.bankFilePath, bank);
    return bank;
  }

  public async saveRunArtifact(payload: RunArtifactPayload): Promise<string> {
    const dir = path.join(this.artifactsDir, payload.category);
    await fs.ensureDir(dir);

    const filePath = path.join(dir, `${timestampTag()}-${payload.fileName}`);
    await fs.writeFile(filePath, payload.content);
    return filePath;
  }

  private async atomicWriteJson(filePath: string, content: unknown): Promise<void> {
    const tempPath = `${filePath}.${timestampTag()}.tmp`;
    await fs.writeJson(tempPath, content, { spaces: 2 });
    await fs.move(tempPath, filePath, { overwrite: true });
  }
}
