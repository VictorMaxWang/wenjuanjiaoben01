import type { Locator, Page } from "playwright";
import type { Identity, QuestionBankEntry, QuestionOption, QuestionSnapshot } from "../types.js";
import { normalizeQuestionText } from "../utils/text.js";
import type { SurveyAdapter } from "./survey-adapter.js";

interface WjxAdapterOptions {
  targetUrl: string;
  page: Page;
}

interface ResolvedOption {
  option: QuestionOption;
  root: Locator;
  input: Locator;
  label: Locator;
  normalizedLabel: string;
}

const CAPTCHA_TOKENS = ["captcha", "verify", "slider", "geetest", "yidun", "tcaptcha"] as const;
const RESULT_CUE_PATTERN = /(正确答案|标准答案|参考答案|答案\s*[:：]|解析\s*[:：])/u;
export class WjxAdapter implements SurveyAdapter {
  public readonly type = "wjx";

  public constructor(private readonly options: WjxAdapterOptions) {}

  public get page(): Page {
    return this.options.page;
  }

  public async open(): Promise<void> {
    await this.page.goto(this.options.targetUrl, { waitUntil: "domcontentloaded" });
  }

  public async fillIdentity(identity: Identity): Promise<void> {
    // 1. 处理文本输入框（填入姓名、学号）
    const selector =
      'input.ui-input-text, textarea.ui-input-text, .ui-input-text input[type="text"], .ui-input-text textarea';
    const fields = await this.page.locator(selector).all();
    const usableFields: Locator[] = [];

    for (const field of fields) {
      if ((await field.isVisible().catch(() => false)) && !(await field.isDisabled().catch(() => true))) {
        usableFields.push(field);
      }
    }

    if (usableFields.length > 0) {
      await usableFields[0].fill(identity.name);
    }
    if (usableFields.length > 1) {
      await usableFields[1].fill(identity.studentId);
    }

    // 2. 专门处理“学院”单选题
    const collegeContainer = this.page.locator(".div_question").filter({ hasText: "学院" }).first();
    if (await collegeContainer.isVisible().catch(() => false)) {
      // 放弃依赖特定 class，直接通过 getByText 精准文本匹配点击
      const optionLabel = collegeContainer.getByText(identity.college).first();
      if (await optionLabel.isVisible().catch(() => false)) {
        await optionLabel.click();
      }
    } else if (usableFields.length > 2) {
      await usableFields[2].fill(identity.college);
    }
  }

  public async extractQuestions(): Promise<QuestionSnapshot[]> {
    const containers = await this.page.locator(".div_question").all();
    const questions: QuestionSnapshot[] = [];

    for (const [index, container] of containers.entries()) {
      if (!(await container.isVisible().catch(() => false))) {
        continue;
      }

      const snapshot = await this.extractQuestionSnapshot(container, index);
      if (snapshot) {
        // 【核心防御】过滤掉基础信息题，绝不能让它们混入题库或干扰答题节奏
        if (/姓名|学号|学院|班级|手机号/.test(snapshot.text)) {
          continue;
        }
        questions.push(snapshot);
      }
    }

    return questions;
  }

  public async answerQuestion(question: QuestionSnapshot, answers: string[]): Promise<void> {
    const container = await this.findQuestionContainer(question);
    if (!container) {
      throw new Error(`Unable to locate question container for "${question.text}".`);
    }

    const resolvedOptions = await this.resolveOptionsForQuestion(container, question.type);
    if (resolvedOptions.length === 0) {
      throw new Error(`No selectable options found for "${question.text}".`);
    }

    if (question.type === "single" && answers.length !== 1) {
      throw new Error(`Single-choice question "${question.text}" requires exactly one answer.`);
    }

    const requestedAnswers =
      question.type === "multiple"
        ? [...new Set(answers.map((answer) => this.normalizeOptionLabel(answer)).filter(Boolean))]
        : answers.map((answer) => this.normalizeOptionLabel(answer)).filter(Boolean);

    const missingAnswers: string[] = [];

    for (const requestedAnswer of requestedAnswers) {
      const match = resolvedOptions.find((option) => option.normalizedLabel === requestedAnswer);
      if (!match) {
        missingAnswers.push(requestedAnswer);
        continue;
      }

      await this.selectResolvedOption(match);
    }

    if (missingAnswers.length > 0) {
      throw new Error(
        `Unable to match answers [${missingAnswers.join(", ")}] for question "${question.text}".`
      );
    }
  }

  public async submit(): Promise<void> {
    const button = this.page.locator("#ctlNext").first();
    if ((await button.count()) === 0) {
      throw new Error('Submit button "#ctlNext" was not found.');
    }

    await button.scrollIntoViewIfNeeded();
    await button.click();
  }

  public async detectCaptcha(): Promise<boolean> {
    for (const token of CAPTCHA_TOKENS) {
      const selector = [
        `[id*="${token}" i]`,
        `[class*="${token}" i]`,
        `iframe[id*="${token}" i]`,
        `iframe[class*="${token}" i]`,
        `iframe[src*="${token}" i]`
      ].join(", ");

      if (await this.page.locator(selector).first().isVisible().catch(() => false)) {
        return true;
      }
    }

    return (
      (await this.page.getByText(/验证码|安全验证|请完成验证|滑块/i).first().isVisible().catch(() => false)) ?? false
    );
  }

  public async extractResultArtifacts(): Promise<QuestionBankEntry[]> {
    const primaryEntries = await this.extractStructuredResultArtifacts();
    const fallbackEntries = await this.extractFallbackResultArtifacts();
    const mergedEntries = this.mergeEntries(primaryEntries, fallbackEntries);

    if (mergedEntries.length === 0 && (await this.looksLikeResultPage())) {
      console.warn("[wjx] result-like page detected but no complete result entries were parsed.");
    }

    return mergedEntries;
  }

  public async captureQuestionHtml(questionId: string): Promise<string> {
    const container = await this.findQuestionContainerById(questionId);
    if (container) {
      return (await container.evaluate((node) => node.outerHTML)) as string;
    }

    const questions = await this.extractQuestions();
    const question = questions.find((candidate) => candidate.id === questionId);
    if (!question) {
      throw new Error(`Unable to capture HTML for unknown question id "${questionId}".`);
    }

    const fallbackContainer = await this.findQuestionContainer(question);
    if (!fallbackContainer) {
      throw new Error(`Unable to capture HTML for question "${question.text}".`);
    }

    return (await fallbackContainer.evaluate((node) => node.outerHTML)) as string;
  }

  private async extractQuestionSnapshot(container: Locator, index: number): Promise<QuestionSnapshot | null> {
    const text = await this.extractQuestionTitle(container);
    if (!text) {
      return null;
    }

    const choiceInfo = await this.extractChoiceInfo(container);
    if (!choiceInfo) {
      return null;
    }

    return {
      id: await this.getQuestionId(container, index),
      type: choiceInfo.type,
      text,
      normalizedText: normalizeQuestionText(text),
      required: await this.isRequiredQuestion(container),
      options: choiceInfo.options
    };
  }

  private async extractQuestionTitle(scope: Locator): Promise<string> {
    const titleNode = scope.locator('[class*="div_title_question"]').first();
    if ((await titleNode.count()) === 0) {
      return "";
    }

    const rawText = (await titleNode.textContent()) ?? "";
    return this.cleanQuestionTitle(rawText);
  }

  private async extractFallbackTitle(scope: Locator): Promise<string> {
    const selectors = [
      '[class*="div_title_question"]',
      '[class*="question"]',
      '[class*="title"]',
      '[class*="topic"]',
      "h1",
      "h2",
      "h3",
      "h4",
      "strong",
      "dt"
    ];

    for (const selector of selectors) {
      const nodes = await scope.locator(selector).all();
      for (const node of nodes) {
        const text = this.cleanQuestionTitle((await node.textContent()) ?? "");
        if (text && !RESULT_CUE_PATTERN.test(text)) {
          return text;
        }
      }
    }

    const scopeText = this.collapseWhitespace((await scope.textContent()) ?? "");
    if (!scopeText) {
      return "";
    }

    const prefix = scopeText.split(RESULT_CUE_PATTERN)[0] ?? "";
    return this.cleanQuestionTitle(prefix);
  }

  private async extractChoiceInfo(
    scope: Locator
  ): Promise<{ type: QuestionSnapshot["type"]; options: QuestionOption[] } | null> {
    const checkboxOptions = await this.extractChoiceOptions(scope, ".ui-checkbox");
    if (checkboxOptions.length > 0) {
      return {
        type: "multiple",
        options: checkboxOptions
      };
    }

    const radioOptions = await this.extractChoiceOptions(scope, ".ui-radio");
    if (radioOptions.length > 0) {
      return {
        type: "single",
        options: radioOptions
      };
    }

    return null;
  }

  private async extractChoiceOptions(scope: Locator, selector: string): Promise<QuestionOption[]> {
    const roots = await scope.locator(selector).all();
    const options: QuestionOption[] = [];
    const seenLabels = new Set<string>();

    for (const [index, root] of roots.entries()) {
      const label = await this.readOptionLabel(root);
      const normalizedLabel = this.normalizeOptionLabel(label);
      if (!normalizedLabel || seenLabels.has(normalizedLabel)) {
        continue;
      }

      const input = root.locator('input[type="radio"], input[type="checkbox"]').first();
      const value =
        (await input.getAttribute("value").catch(() => null)) ??
        (await root.getAttribute("value")) ??
        (await root.getAttribute("data-value")) ??
        String(index + 1);

      options.push({
        value,
        label
      });
      seenLabels.add(normalizedLabel);
    }

    return options;
  }

  private async extractLooseOptions(scope: Locator, questionText: string): Promise<QuestionOption[]> {
    const nodes = await scope.locator('label, li, [class*="option"], [class*="item"]').all();
    const options: QuestionOption[] = [];
    const seenLabels = new Set<string>();
    const normalizedQuestionText = normalizeQuestionText(questionText);

    for (const [index, node] of nodes.entries()) {
      const text = this.cleanOptionLabel((await node.textContent()) ?? "");
      const normalizedText = this.normalizeOptionLabel(text);

      if (
        !normalizedText ||
        normalizedText === normalizedQuestionText ||
        RESULT_CUE_PATTERN.test(text) ||
        text.length > 120 ||
        seenLabels.has(normalizedText)
      ) {
        continue;
      }

      options.push({
        value: String(index + 1),
        label: text
      });
      seenLabels.add(normalizedText);
    }

    return options;
  }

  private async extractStructuredResultArtifacts(): Promise<QuestionBankEntry[]> {
    const containers = await this.page.locator(".div_question").all();
    const entries: QuestionBankEntry[] = [];

    for (const container of containers) {
      const entry = await this.extractResultEntryFromScope(container, false);
      if (entry) {
        entries.push(entry);
      }
    }

    return this.mergeEntries(entries, []);
  }

  private async extractFallbackResultArtifacts(): Promise<QuestionBankEntry[]> {
    const candidateLocators = await this.page
      .locator('[class*="result"], [class*="question"], [class*="topic"], section, article, li, tr, div')
      .all();
    const entries: QuestionBankEntry[] = [];

    for (const locator of candidateLocators) {
      if (!(await locator.isVisible().catch(() => false))) {
        continue;
      }

      const text = this.collapseWhitespace((await locator.textContent()) ?? "");
      if (!text || !RESULT_CUE_PATTERN.test(text)) {
        continue;
      }

      const entry = await this.extractResultEntryFromScope(locator, true);
      if (entry) {
        entries.push(entry);
      }
    }

    return this.mergeEntries([], entries);
  }

  private async extractResultEntryFromScope(scope: Locator, useFallbackTitle: boolean): Promise<QuestionBankEntry | null> {
    const questionText = useFallbackTitle
      ? await this.extractFallbackTitle(scope)
      : await this.extractQuestionTitle(scope);
    if (!questionText) {
      return null;
    }

    const explicitChoiceInfo = await this.extractChoiceInfo(scope);
    const options = explicitChoiceInfo?.options ?? (await this.extractLooseOptions(scope, questionText));
    const correctAnswers = await this.extractCorrectAnswersFromScope(scope, options);

    if (correctAnswers.length === 0) {
      return null;
    }

    const type =
      explicitChoiceInfo?.type ??
      (correctAnswers.length > 1 ? "multiple" : "single");

    return {
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
    };
  }

  private async extractCorrectAnswersFromScope(scope: Locator, options: QuestionOption[]): Promise<string[]> {
    const text = this.collapseWhitespace((await scope.textContent()) ?? "");
    if (!text) {
      return [];
    }

    const segments = this.extractAnswerSegments(text);
    const answers = new Set<string>();

    for (const segment of segments) {
      for (const answer of this.resolveAnswerSegment(segment, options)) {
        answers.add(answer);
      }
    }

    return [...answers];
  }

  private extractAnswerSegments(text: string): string[] {
    const normalizedText = this.collapseWhitespace(text);
    const segments: string[] = [];
    const patterns = [
      /(?:正确答案|标准答案|参考答案)\s*[:：]?\s*([^。；;\n\r]+)/gu,
      /(?:答案)\s*[:：]\s*([^。；;\n\r]+)/gu
    ];

    for (const pattern of patterns) {
      for (const match of normalizedText.matchAll(pattern)) {
        const segment = this.collapseWhitespace(match[1] ?? "");
        if (segment) {
          segments.push(segment);
        }
      }
    }

    return segments;
  }

  private resolveAnswerSegment(segment: string, options: QuestionOption[]): string[] {
    const cleanedSegment = this.collapseWhitespace(segment).replace(/^(?:为|是)\s*/u, "").trim();
    if (!cleanedSegment) {
      return [];
    }

    const fragments = cleanedSegment
      .split(/\s*(?:\||,|，|;|；|\/|、|&|\band\b)\s*/iu)
      .map((fragment) => this.cleanOptionLabel(fragment))
      .filter(Boolean);

    const normalizedFragments = fragments.map((fragment) => this.normalizeOptionLabel(fragment));
    const resolvedAnswers = new Set<string>();

    if (options.length > 0) {
      for (const fragment of normalizedFragments) {
        for (const option of options) {
          const normalizedOptionLabel = this.normalizeOptionLabel(option.label);
          const normalizedOptionValue = this.normalizeOptionValue(option.value);

          if (fragment === normalizedOptionLabel || fragment === normalizedOptionValue) {
            resolvedAnswers.add(option.label);
          }
        }
      }

      if (resolvedAnswers.size === 0) {
        const normalizedSegment = this.normalizeOptionLabel(cleanedSegment);
        for (const option of options) {
          const normalizedOptionLabel = this.normalizeOptionLabel(option.label);
          if (normalizedOptionLabel && normalizedSegment.includes(normalizedOptionLabel)) {
            resolvedAnswers.add(option.label);
          }
        }
      }
    }

    if (resolvedAnswers.size > 0) {
      return [...resolvedAnswers];
    }

    return fragments.length > 0 ? fragments : [this.cleanOptionLabel(cleanedSegment)];
  }

  private async resolveOptionsForQuestion(scope: Locator, type: QuestionSnapshot["type"]): Promise<ResolvedOption[]> {
    const selector = type === "multiple" ? ".ui-checkbox" : ".ui-radio";
    const roots = await scope.locator(selector).all();
    const resolvedOptions: ResolvedOption[] = [];

    for (const root of roots) {
      const labelText = await this.readOptionLabel(root);
      const normalizedLabel = this.normalizeOptionLabel(labelText);
      if (!normalizedLabel) {
        continue;
      }

      resolvedOptions.push({
        option: {
          value:
            (await root.locator('input[type="radio"], input[type="checkbox"]').first().getAttribute("value").catch(() => null)) ??
            (await root.getAttribute("value")) ??
            "",
          label: labelText
        },
        root,
        input: root.locator('input[type="radio"], input[type="checkbox"]').first(),
        label: root.locator("label").first(),
        normalizedLabel
      });
    }

    return resolvedOptions;
  }

  private async selectResolvedOption(option: ResolvedOption): Promise<void> {
    if ((await option.input.count()) > 0) {
      const alreadyChecked = await option.input.isChecked().catch(() => false);
      if (!alreadyChecked) {
        try {
          await option.input.check();
          return;
        } catch {
          try {
            await option.input.check({ force: true });
            return;
          } catch {
            // Fall through to label/root clicks.
          }
        }
      } else {
        return;
      }
    }

    if ((await option.label.count()) > 0) {
      await option.label.click();
      return;
    }

    await option.root.click();
  }

  private async findQuestionContainer(question: QuestionSnapshot): Promise<Locator | null> {
    const byId = await this.findQuestionContainerById(question.id);
    if (byId) {
      return byId;
    }

    const containers = await this.page.locator(".div_question").all();
    for (const container of containers) {
      const title = await this.extractQuestionTitle(container);
      if (title && normalizeQuestionText(title) === question.normalizedText) {
        return container;
      }
    }

    return null;
  }

  private async findQuestionContainerById(questionId: string): Promise<Locator | null> {
    if (!questionId) {
      return null;
    }

    const containers = await this.page.locator(".div_question").all();
    for (const container of containers) {
      const identifiers = [
        await container.getAttribute("id"),
        await container.getAttribute("topic"),
        await container.getAttribute("data-topic")
      ].filter((value): value is string => Boolean(value));

      if (identifiers.includes(questionId)) {
        return container;
      }
    }

    return null;
  }

  private async getQuestionId(container: Locator, index: number): Promise<string> {
    return (
      (await container.getAttribute("id")) ??
      (await container.getAttribute("topic")) ??
      (await container.getAttribute("data-topic")) ??
      `question-${index + 1}`
    );
  }

  private async isRequiredQuestion(container: Locator): Promise<boolean> {
    const requiredFlags = [
      await container.getAttribute("req"),
      await container.getAttribute("data-required"),
      await container.getAttribute("needcheck")
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());

    if (requiredFlags.includes("0") || requiredFlags.includes("false")) {
      return false;
    }

    if (requiredFlags.includes("1") || requiredFlags.includes("true")) {
      return true;
    }

    return true;
  }

  private async looksLikeResultPage(): Promise<boolean> {
    const bodyText = this.collapseWhitespace((await this.page.locator("body").textContent().catch(() => "")) ?? "");
    return RESULT_CUE_PATTERN.test(bodyText);
  }

  private async readOptionLabel(root: Locator): Promise<string> {
    const rawText = await root
      .evaluate((node) => {
        const localCandidates: string[] = [];
        const siblingCandidates: string[] = [];

        const normalizeCandidate = (value: string | null | undefined): string => {
          if (typeof value !== "string") {
            return "";
          }

          return value.replace(/\s+/g, " ").trim();
        };

        const pushLocalCandidate = (value: string | null | undefined): void => {
          const text = normalizeCandidate(value);
          if (text) {
            localCandidates.push(text);
          }
        };

        const pushSiblingCandidate = (value: string | null | undefined): void => {
          const text = normalizeCandidate(value);
          if (text) {
            siblingCandidates.push(text);
          }
        };

        pushLocalCandidate(node.textContent);

        const childSelectors = ["label", "span", "font", "p", "div"];
        for (const selector of childSelectors) {
          for (const child of Array.from(node.querySelectorAll(selector)).slice(0, 6)) {
            pushLocalCandidate(child.textContent);
          }
        }

        if (node.nextSibling?.nodeType === Node.TEXT_NODE) {
          pushSiblingCandidate(node.nextSibling.textContent);
        }

        if (node.previousSibling?.nodeType === Node.TEXT_NODE) {
          pushSiblingCandidate(node.previousSibling.textContent);
        }

        pushSiblingCandidate(node.nextElementSibling?.textContent);
        pushSiblingCandidate(node.previousElementSibling?.textContent);

        if (localCandidates.length > 0) {
          return localCandidates.sort((left, right) => right.length - left.length)[0] ?? "";
        }

        return siblingCandidates.sort((left, right) => right.length - left.length)[0] ?? "";
      })
      .catch(() => "");

    return this.cleanOptionLabel(rawText);
  }

  private cleanQuestionTitle(text: string): string {
    let value = this.collapseWhitespace(text);
    const leadingPatterns = [
      /^\s*[（(【\[]\s*(?:单选(?:题)?|多选(?:题)?|判断(?:题)?|填空(?:题)?)\s*[】)）\]]\s*/u,
      /^\s*(?:单选(?:题)?|多选(?:题)?|判断(?:题)?|填空(?:题)?)\s*[:：-]?\s*/u,
      /^\s*第?\d+\s*[.、．:：)]\s*/u
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const pattern of leadingPatterns) {
        const nextValue = value.replace(pattern, "").trim();
        if (nextValue !== value) {
          value = nextValue;
          changed = true;
        }
      }
    }

    return value.replace(/\s*[*＊]+\s*$/u, "").trim();
  }

  private cleanOptionLabel(text: string): string {
    let value = this.collapseWhitespace(text)
      .replace(/^[（(【\[]\s*[A-Z]\s*[)）】\]]\s*/u, "")
      .replace(/^[A-Z]\s*[.、．:：-]\s*/u, "")
      .replace(/^\d+\s*[.、．:：-]\s*/u, "")
      .replace(/^[√✔✓✗×]\s*/u, "")
      .trim();

    value = value.replace(/\s*(?:正确答案|标准答案|参考答案)\s*[:：]?.*$/u, "").trim();
    return value;
  }

  private collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  private normalizeOptionLabel(text: string): string {
    return normalizeQuestionText(this.cleanOptionLabel(text));
  }

  private normalizeOptionValue(value: string): string {
    return value.replace(/\s+/g, "").trim().toLowerCase();
  }

  private mergeEntries(primary: QuestionBankEntry[], secondary: QuestionBankEntry[]): QuestionBankEntry[] {
    const merged = new Map<string, QuestionBankEntry>();

    for (const entry of [...primary, ...secondary]) {
      if (!entry.questionText || entry.correctAnswers.length === 0) {
        continue;
      }

      if (!merged.has(entry.normalizedText)) {
        merged.set(entry.normalizedText, entry);
      }
    }

    return [...merged.values()];
  }
}
