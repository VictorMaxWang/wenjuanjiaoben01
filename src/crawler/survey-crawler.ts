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

      if (questions.length === 0) {
        const html = await this.adapter.page.content();
        await this.persistLearnDebugArtifact("debug-no-questions.html", "debug-no-questions", html);
        console.error(
          "\x1b[31m\x1b[1m[ERROR] 未能抓取到任何考试题目！已保存当前页面 HTML 到 run_logs，请提供给 Cursor 进行 DOM 分析。\x1b[0m"
        );
        await waitForManualIntervention(
          "未能抓取到任何考试题目，已保存 debug-no-questions.html。请检查适配器或页面后重试。"
        );
        return;
      }

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

      if (await this.detectLearnSubmitBlocked()) {
        const html = await this.adapter.page.content();
        await this.persistLearnDebugArtifact("debug-submit-blocked.html", "debug-submit-blocked", html);
        console.error(
          "\x1b[31m\x1b[1m[ERROR] 提交被拦截（可能漏答或校验未通过）！已保存 HTML 到 run_logs/debug-submit-blocked.html，请检查。\x1b[0m"
        );
        await waitForManualIntervention(
          "提交被拦截，已将页面保存为 debug-submit-blocked.html。请处理表单或适配器后重试。"
        );
        return;
      }

      if (await this.adapter.detectCaptcha()) {
        await this.handleCaptcha();
      }

      const entries = await this.adapter.extractResultArtifacts();
      if (entries.length === 0) {
        const html = await this.adapter.page.content();
        await this.persistLearnDebugArtifact("debug-empty-result.html", "debug-empty-result", html);
        console.error(
          "\x1b[31m\x1b[1m抓取题库失败！请检查 `run_logs/debug-empty-result.html` 的结构，并提供给 Cursor 进行解析器升级！\x1b[0m"
        );
      }
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
    // 将阿拉伯数字转换为中文，绕过纯汉字校验
    const chineseNums = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    const suffix = chineseNums[attempt] || "多";

    return {
      name: `${this.config.learn.testIdentity.baseName}${suffix}`,
      studentId: `${this.config.learn.testIdentity.studentIdPrefix}${attempt}`,
      college: this.config.learn.testIdentity.college
    };
  }

  private async persistLearnDebugArtifact(fileName: string, category: string, html: string): Promise<void> {
    await fs.ensureDir(this.config.artifactsDir);
    await fs.writeFile(path.join(this.config.artifactsDir, fileName), html, "utf-8");
    await this.storage.saveRunArtifact({
      category,
      fileName: "page.html",
      content: html
    });
  }

  /**
   * 提交后仍停留在答题页且出现校验提示时，视为提交被拦截（漏答、必填等）。
   */
  private async detectLearnSubmitBlocked(): Promise<boolean> {
    const page = this.adapter.page;
    await sleep(500);

    const bodyText = (await page.locator("body").innerText().catch(() => "")) ?? "";

    const looksLikeResult =
      /正确答案|标准答案|参考答案|您的答[案]|得分|成绩|感谢您的?参与|提交成功|查看结果/i.test(bodyText) ||
      /感谢您的?填写|问卷已提交/i.test(bodyText);
    if (looksLikeResult) {
      return false;
    }

    const validationCue =
      /请完善|必填|不能为空|请选择|请回答|漏答|必须回答|还有.*未答|最少.*选|最多.*选|请选择.*项|请输入|格式不正确|未全部回答|尚有.*未/i;
    if (validationCue.test(bodyText)) {
      return true;
    }

    const errTip = page.locator(
      '[class*="error"], [class*="err"], [class*="warn_tip"], .field_error, .error-message, #validate_tip, [id*="error"], [id*="tip"]'
    );
    if (await errTip.first().isVisible().catch(() => false)) {
      if (await page.locator("#ctlNext").isVisible().catch(() => false)) {
        return true;
      }
    }

    return false;
  }

  private async evaluateLearnProgress(attempt: number, questions: QuestionSnapshot[]): Promise<LearnProgress> {
    const bank = await this.storage.loadBank();
    // 空数组时 Array.prototype.every 恒为 true，会误判「已全部掌握」并在从未提交的情况下提前退出 learn
    const allQuestionsKnown =
      questions.length > 0 && questions.every((question) => Boolean(bank.entries[question.normalizedText]));

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
