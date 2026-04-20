import type { Page } from "playwright";
import type { Identity, MockAdapterConfig, QuestionBankEntry, QuestionOption, QuestionSnapshot } from "../types.js";
import { normalizeQuestionText } from "../utils/text.js";
import type { SurveyAdapter } from "./survey-adapter.js";

interface MockAdapterOptions {
  targetUrl: string;
  adapterConfig: MockAdapterConfig;
  page: Page;
}

export class MockSurveyAdapter implements SurveyAdapter {
  public readonly type = "mock";

  public constructor(private readonly options: MockAdapterOptions) {}

  public get page(): Page {
    return this.options.page;
  }

  public async open(): Promise<void> {
    const url = new URL(this.options.targetUrl);
    const scenario = this.options.adapterConfig.mock?.scenario ?? "default";
    url.searchParams.set("scenario", scenario);
    if (!url.searchParams.has("seed")) {
      url.searchParams.set("seed", String(Date.now()));
    }
    await this.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  }

  public async fillIdentity(identity: Identity): Promise<void> {
    await this.page.getByLabel("姓名").fill(identity.name);
    await this.page.getByLabel("学号").fill(identity.studentId);
    await this.page.getByLabel("学院").fill(identity.college);
  }

  public async extractQuestions(): Promise<QuestionSnapshot[]> {
    const cards = await this.page.locator('[data-testid="question-card"]').all();
    const questions: QuestionSnapshot[] = [];

    for (const card of cards) {
      const id = (await card.getAttribute("data-question-id")) ?? "";
      const type = (await card.getAttribute("data-question-type")) as QuestionSnapshot["type"];
      const text = ((await card.locator('[data-testid="question-title"]').textContent()) ?? "").trim();
      const required = ((await card.getAttribute("data-required")) ?? "true") === "true";

      const options = await this.extractOptions(card);
      questions.push({
        id,
        type,
        text,
        normalizedText: normalizeQuestionText(text),
        required,
        options
      });
    }

    return questions;
  }

  public async answerQuestion(question: QuestionSnapshot, answers: string[]): Promise<void> {
    const card = this.page.locator(`[data-testid="question-card"][data-question-id="${question.id}"]`);

    if (question.type === "text") {
      await card.getByRole("textbox").fill(answers[0] ?? "");
      return;
    }

    for (const answer of answers) {
      const normalizedAnswer = answer.trim();
      await card.getByLabel(normalizedAnswer, { exact: true }).check();
    }
  }

  public async submit(): Promise<void> {
    await this.page.getByRole("button", { name: "提交" }).click();
  }

  public async detectCaptcha(): Promise<boolean> {
    return this.page.locator('[data-testid="captcha-challenge"]:not([hidden])').isVisible();
  }

  public async extractResultArtifacts(): Promise<QuestionBankEntry[]> {
    const resultCards = await this.page.locator('[data-testid="result-card"]').all();
    const entries: QuestionBankEntry[] = [];

    for (const card of resultCards) {
      const questionText = ((await card.locator('[data-testid="result-question"]').textContent()) ?? "").trim();
      const options = await this.extractResultOptions(card);
      const correctAnswers = (
        ((await card.locator('[data-testid="result-correct-answer"]').textContent()) ?? "")
          .split("|")
          .map((item) => item.trim())
          .filter(Boolean)
      );
      const type = ((await card.getAttribute("data-question-type")) ?? "single") as QuestionBankEntry["type"];

      entries.push({
        questionText,
        normalizedText: normalizeQuestionText(questionText),
        type,
        options,
        correctAnswers,
        source: {
          adapterType: this.type,
          url: this.page.url(),
          updatedAt: new Date().toISOString()
        }
      });
    }

    return entries;
  }

  public async captureQuestionHtml(questionId: string): Promise<string> {
    const card = this.page.locator(`[data-testid="question-card"][data-question-id="${questionId}"]`);
    return (await card.evaluate((node) => node.outerHTML)) as string;
  }

  private async extractOptions(card: ReturnType<Page["locator"]>): Promise<QuestionOption[]> {
    const labels = await card.locator('[data-testid="option-label"]').all();
    const options: QuestionOption[] = [];

    for (const label of labels) {
      const value = (await label.getAttribute("data-option-value")) ?? "";
      const text = ((await label.textContent()) ?? "").trim();
      options.push({ value, label: text });
    }

    return options;
  }

  private async extractResultOptions(card: ReturnType<Page["locator"]>): Promise<QuestionOption[]> {
    const nodes = await card.locator('[data-testid="result-option"]').all();
    const options: QuestionOption[] = [];

    for (const node of nodes) {
      const value = (await node.getAttribute("data-option-value")) ?? "";
      const text = ((await node.textContent()) ?? "").trim();
      options.push({ value, label: text });
    }

    return options;
  }
}
