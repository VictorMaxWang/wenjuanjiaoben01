import type { Page } from "playwright";
import type { AppConfig } from "../types.js";
import type { SurveyAdapter } from "./survey-adapter.js";
import { MockSurveyAdapter } from "./mock-survey-adapter.js";
import { WjxAdapter } from "./wjx-adapter.js";

export function createAdapter(config: AppConfig, page: Page): SurveyAdapter {
  switch (config.adapter.type) {
    case "mock":
      return new MockSurveyAdapter({
        targetUrl: config.targetUrl,
        adapterConfig: config.adapter,
        page
      });
    case "wjx":
      return new WjxAdapter({
        targetUrl: config.targetUrl,
        page
      });
    default:
      throw new Error(`Unsupported adapter type: ${String((config.adapter as { type?: string }).type)}`);
  }
}
