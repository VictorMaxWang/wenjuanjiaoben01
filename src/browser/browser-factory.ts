import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function createBrowserSession(headless: boolean): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 960
    }
  });
  const page = await context.newPage();

  return { browser, context, page };
}
