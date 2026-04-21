import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

function shouldBlockHeavyResource(resourceType: string): boolean {
  return resourceType === "image" || resourceType === "stylesheet" || resourceType === "font" || resourceType === "media";
}

export async function createBrowserSession(headless: boolean): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 960
    }
  });

  await context.route("**/*", async (route) => {
    if (shouldBlockHeavyResource(route.request().resourceType())) {
      await route.abort();
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();

  return { browser, context, page };
}
