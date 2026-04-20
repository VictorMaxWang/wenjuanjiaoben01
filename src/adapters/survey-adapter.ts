import type { Page } from "playwright";
import type { Identity, QuestionBankEntry, QuestionSnapshot } from "../types.js";

export interface SurveyAdapter {
  readonly type: string;
  readonly page: Page;

  open(): Promise<void>;
  fillIdentity(identity: Identity): Promise<void>;
  extractQuestions(): Promise<QuestionSnapshot[]>;
  answerQuestion(question: QuestionSnapshot, answers: string[]): Promise<void>;
  submit(): Promise<void>;
  detectCaptcha(): Promise<boolean>;
  extractResultArtifacts(): Promise<QuestionBankEntry[]>;
  captureQuestionHtml(questionId: string): Promise<string>;
}
