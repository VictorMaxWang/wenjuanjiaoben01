export type QuestionType = "single" | "multiple" | "text";

export interface Identity {
  name: string;
  studentId: string;
  college: string;
}

export interface QuestionOption {
  value: string;
  label: string;
}

export interface QuestionSnapshot {
  id: string;
  type: QuestionType;
  text: string;
  normalizedText: string;
  required: boolean;
  options: QuestionOption[];
}

export interface QuestionBankEntry {
  questionText: string;
  normalizedText: string;
  type: QuestionType;
  options: QuestionOption[];
  correctAnswers: string[];
  source: {
    adapterType: string;
    url: string;
    updatedAt: string;
  };
}

export interface QuestionBankFile {
  updatedAt: string;
  entries: Record<string, QuestionBankEntry>;
}

export interface LearnProgress {
  attempt: number;
  allQuestionsKnown: boolean;
  questionCount: number;
}

export interface ExecutionConfig {
  timePerQuestion: number;
  identity: Identity;
}

export interface LearnConfig {
  consecutiveKnownRuns: number;
  maxAttempts: number;
  testIdentity: {
    baseName: string;
    studentIdPrefix: string;
    college: string;
  };
}

export interface MockAdapterConfig {
  type: "mock";
  mock?: {
    scenario?: "default" | "captcha" | "unknown";
  };
}

export interface WjxAdapterConfig {
  type: "wjx";
}

export type AdapterConfig = MockAdapterConfig | WjxAdapterConfig;

export interface AppConfig {
  targetUrl: string;
  adapter: AdapterConfig;
  headless: boolean;
  bankFilePath: string;
  artifactsDir: string;
  learn: LearnConfig;
  execute: ExecutionConfig;
}

export interface RunArtifactPayload {
  category: string;
  fileName: string;
  content: string | Buffer;
}

export interface ExecuteRunSummary {
  answeredCount: number;
  pausedForManualIntervention: boolean;
}
