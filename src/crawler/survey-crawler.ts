import path from "node:path";
import fs from "fs-extra";
import type { BrowserSession } from "../browser/browser-factory.js";
import type { SurveyAdapter } from "../adapters/survey-adapter.js";
import type {
  AppConfig,
  ExecuteRunSummary,
  Identity,
  LearnProgress,
  QuestionBankEntry,
  QuestionSnapshot
} from "../types.js";
import { Storage } from "../storage/storage.js";
import { sanitizeFileSegment } from "../utils/text.js";
import { waitForManualIntervention } from "../utils/manual-intervention.js";
import { sleep } from "../utils/time.js";

export class SurveyCrawler {
  public constructor(
    private readonly config: AppConfig,
    private readonly storage: Storage,
    private readonly adapter: SurveyAdapter,
    private readonly session: BrowserSession
  ) {}

  public async runLearningMode(): Promise<void> {
    let consecutiveKnownRuns = 0;

    for (let attempt = 1; attempt <= this.config.learn.maxAttempts; attempt += 1) {
      const identity = this.buildTestIdentity(attempt);
      await this.adapter.open();
      await this.adapter.fillIdentity(identity);

      const questions = await this.adapter.extractQuestions();
      const progress = await this.evaluateLearnProgress(attempt, questions);
      consecutiveKnownRuns = progress.allQuestionsKnown ? consecutiveKnownRuns + 1 : 0;

      console.log(
        `[learn] attempt=${attempt} questions=${progress.questionCount} allKnown=${progress.allQuestionsKnown} consecutive=${consecutiveKnownRuns}`
      );

      if (consecutiveKnownRuns >= this.config.learn.consecutiveKnownRuns) {
        console.log("题库收集完成");
        return;
      }

      await this.answerRandomly(questions);
      await this.adapter.submit();

      if (await this.adapter.detectCaptcha()) {
        await this.handleCaptcha();
      }

      const entries = await this.adapter.extractResultArtifacts();
      await this.storage.upsertEntries(entries);
    }

    console.log("[learn] reached max attempts before convergence");
  }

  public async runExecutionMode(): Promise<ExecuteRunSummary> {
    await this.adapter.open();
    await this.adapter.fillIdentity(this.config.execute.identity);

    const questions = await this.adapter.extractQuestions();
    let pausedForManualIntervention = false;
    let answeredCount = 0;

    for (const [index, question] of questions.entries()) {
      const entry = await this.storage.findByQuestionText(question.text);

      if (!entry) {
        pausedForManualIntervention = true;
        await this.handleUnknownQuestion(question, index + 1);
        continue;
      }

      await this.adapter.answerQuestion(question, entry.correctAnswers);
      answeredCount += 1;
      await sleep(this.config.execute.timePerQuestion * 1000);
    }

    await this.adapter.submit();

    if (await this.adapter.detectCaptcha()) {
      pausedForManualIntervention = true;
      await this.handleCaptcha();
    }

    return {
      answeredCount,
      pausedForManualIntervention
    };
  }

  public async close(): Promise<void> {
    await this.session.context.close();
    await this.session.browser.close();
  }

  private buildTestIdentity(attempt: number): Identity {
    return {
      name: `${this.config.learn.testIdentity.baseName}${attempt}`,
      studentId: `${this.config.learn.testIdentity.studentIdPrefix}${attempt}`,
      college: this.config.learn.testIdentity.college
    };
  }

  private async evaluateLearnProgress(attempt: number, questions: QuestionSnapshot[]): Promise<LearnProgress> {
    const bank = await this.storage.loadBank();
    const allQuestionsKnown = questions.every((question) => Boolean(bank.entries[question.normalizedText]));

    return {
      attempt,
      allQuestionsKnown,
      questionCount: questions.length
    };
  }

  private async answerRandomly(questions: QuestionSnapshot[]): Promise<void> {
    for (const question of questions) {
      const answers = this.pickRandomAnswers(question);
      await this.adapter.answerQuestion(question, answers);
    }
  }

  private pickRandomAnswers(question: QuestionSnapshot): string[] {
    if (question.type === "text") {
      return ["自动化测试填空示例"];
    }

    if (question.type === "single") {
      const option = question.options[Math.floor(Math.random() * question.options.length)];
      return option ? [option.label] : [];
    }

    const shuffled = [...question.options].sort(() => Math.random() - 0.5);
    const count = Math.max(1, Math.ceil(Math.random() * shuffled.length));
    return shuffled.slice(0, count).map((option) => option.label);
  }

  private async handleUnknownQuestion(question: QuestionSnapshot, index: number): Promise<void> {
    const fileStem = `${index}-${sanitizeFileSegment(question.text)}`;
    const questionHtml = await this.adapter.captureQuestionHtml(question.id);

    await this.storage.saveRunArtifact({
      category: "unknown-questions",
      fileName: `${fileStem}.json`,
      content: JSON.stringify(question, null, 2)
    });

    await this.storage.saveRunArtifact({
      category: "unknown-questions",
      fileName: `${fileStem}.html`,
      content: questionHtml
    });

    const screenshotPath = path.join(
      this.config.artifactsDir,
      "unknown-questions",
      `${new Date().toISOString().replace(/[:.]/g, "-")}-${fileStem}.png`
    );

    await fs.ensureDir(path.dirname(screenshotPath));
    await this.adapter.page.screenshot({ path: screenshotPath, fullPage: true });

    console.warn(`[execute] unknown question encountered: ${question.text}`);
    await waitForManualIntervention("检测到题库中不存在的新题，已保存现场。请人工处理当前页面。");
  }

  private async handleCaptcha(): Promise<void> {
    await this.storage.saveRunArtifact({
      category: "captcha",
      fileName: "captcha-page.html",
      content: await this.adapter.page.content()
    });

    const screenshotPath = path.join(
      this.config.artifactsDir,
      "captcha",
      `${new Date().toISOString().replace(/[:.]/g, "-")}-captcha.png`
    );

    await fs.ensureDir(path.dirname(screenshotPath));
    await this.adapter.page.screenshot({ path: screenshotPath, fullPage: true });
    console.warn("[submit] captcha detected; waiting for manual intervention");
    await waitForManualIntervention("检测到验证码或人工确认步骤，请在浏览器中完成处理。");
  }
}
