import { afterEach, describe, expect, it } from "vitest";
import { createBrowserSession, type BrowserSession } from "../src/browser/browser-factory.js";
import { createAdapter } from "../src/adapters/factory.js";
import { WjxAdapter } from "../src/adapters/wjx-adapter.js";
import type { QuestionSnapshot } from "../src/types.js";
import { buildAppConfig } from "./test-helpers.js";

const QUESTION_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>WJX Question Fixture</title>
  </head>
  <body>
    <input class="ui-input-text" />
    <input class="ui-input-text" />
    <input class="ui-input-text" />

    <div class="div_question" id="q1" topic="1" req="1">
      <div class="field-label">ignore</div>
      <div class="div_title_question">1. 你常用的前端框架是？ *</div>
      <div class="options">
        <div class="ui-radio">
          <input id="q1-a" type="radio" name="q1" value="A" />
          <label for="q1-a"><span>A. React</span></label>
        </div>
        <div class="ui-radio">
          <input id="q1-b" type="radio" name="q1" value="B" />
          <label for="q1-b"><span>B. Vue</span></label>
        </div>
        <div class="ui-radio">
          <input id="q1-c" type="radio" name="q1" value="C" />
          <label for="q1-c"><span>C. Angular</span></label>
        </div>
      </div>
    </div>

    <div class="div_question" id="q2" topic="2" req="1">
      <div class="div_title_question">（多选）2、你熟悉哪些测试类型？</div>
      <div class="ui-checkbox">
        <input id="q2-a" type="checkbox" value="A" />
        <label for="q2-a"><span>A、单元测试</span></label>
      </div>
      <div class="ui-checkbox">
        <input id="q2-b" type="checkbox" value="B" />
        <label for="q2-b"><span>B、集成测试</span></label>
      </div>
      <div class="ui-checkbox">
        <input id="q2-c" type="checkbox" value="C" />
        <label for="q2-c"><span>C、端到端测试</span></label>
      </div>
    </div>

    <div class="div_question" id="q3" topic="3">
      <div class="div_title_question">3. 请填写备注</div>
      <textarea></textarea>
    </div>

    <button id="ctlNext" type="button">提交</button>

    <script>
      document.getElementById("ctlNext").addEventListener("click", () => {
        document.body.dataset.submitted = "yes";
      });
    </script>
  </body>
</html>`;

const STRUCTURED_RESULT_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>WJX Structured Result Fixture</title>
  </head>
  <body>
    <div class="div_question" id="r1" topic="1">
      <div class="div_title_question">1. 你常用的前端框架是？</div>
      <div class="ui-radio"><input type="radio" value="A" /><span>A. React</span></div>
      <div class="ui-radio"><input type="radio" value="B" /><span>B. Vue</span></div>
      <div class="result-answer">正确答案：A</div>
      <div class="analysis">解析：React 生态成熟。</div>
    </div>
    <div class="div_question" id="r2" topic="2">
      <div class="div_title_question">2、你熟悉哪些测试类型？</div>
      <div class="ui-checkbox"><input type="checkbox" value="A" /><span>A、单元测试</span></div>
      <div class="ui-checkbox"><input type="checkbox" value="B" /><span>B、集成测试</span></div>
      <div class="ui-checkbox"><input type="checkbox" value="C" /><span>C、端到端测试</span></div>
      <div class="result-answer">标准答案：A、C</div>
    </div>
  </body>
</html>`;

const FALLBACK_RESULT_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>WJX Fallback Result Fixture</title>
  </head>
  <body>
    <section class="result-block">
      <h3 class="summary-question">你熟悉哪些语言？</h3>
      <div class="summary-answer">参考答案：TypeScript | JavaScript</div>
    </section>
    <section class="result-block">
      <h3 class="summary-question">这道题没有答案</h3>
      <div class="summary-note">解析中</div>
    </section>
  </body>
</html>`;

const CAPTCHA_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>WJX Captcha Fixture</title>
  </head>
  <body>
    <div class="slider-verify-panel">请完成滑块验证</div>
  </body>
</html>`;

function buildDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

const sessions: BrowserSession[] = [];

afterEach(async () => {
  while (sessions.length > 0) {
    const session = sessions.pop();
    if (session) {
      await session.context.close();
      await session.browser.close();
    }
  }
});

async function createWjxAdapter(html: string): Promise<{ adapter: WjxAdapter; session: BrowserSession }> {
  const session = await createBrowserSession(true);
  sessions.push(session);

  const adapter = new WjxAdapter({
    targetUrl: buildDataUrl(html),
    page: session.page
  });

  await adapter.open();
  return { adapter, session };
}

describe("WjxAdapter", () => {
  it("extracts single-choice and multiple-choice questions while skipping unsupported blocks", async () => {
    const { adapter } = await createWjxAdapter(QUESTION_PAGE_HTML);

    const questions = await adapter.extractQuestions();

    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      id: "q1",
      type: "single",
      text: "你常用的前端框架是？",
      required: true
    });
    expect(questions[0].options.map((option) => option.label)).toEqual(["React", "Vue", "Angular"]);
    expect(questions[1]).toMatchObject({
      id: "q2",
      type: "multiple",
      text: "你熟悉哪些测试类型？"
    });
    expect(questions[1].options.map((option) => option.label)).toEqual([
      "单元测试",
      "集成测试",
      "端到端测试"
    ]);
  });

  it("fills identity fields, answers matched options, and submits via #ctlNext", async () => {
    const { adapter, session } = await createWjxAdapter(QUESTION_PAGE_HTML);
    const questions = await adapter.extractQuestions();

    await adapter.fillIdentity({
      name: "王振欢",
      studentId: "25130119",
      college: "信息工程学院、人工智能学院"
    });
    await adapter.answerQuestion(questions[0] as QuestionSnapshot, ["Vue"]);
    await adapter.answerQuestion(questions[1] as QuestionSnapshot, ["单元测试", "端到端测试"]);
    await adapter.submit();

    await expect(session.page.locator(".ui-input-text").nth(0).inputValue()).resolves.toBe("王振欢");
    await expect(session.page.locator(".ui-input-text").nth(1).inputValue()).resolves.toBe("25130119");
    await expect(session.page.locator(".ui-input-text").nth(2).inputValue()).resolves.toBe("信息工程学院、人工智能学院");
    await expect(session.page.locator("#q1-b").isChecked()).resolves.toBe(true);
    await expect(session.page.locator("#q2-a").isChecked()).resolves.toBe(true);
    await expect(session.page.locator("#q2-c").isChecked()).resolves.toBe(true);
    await expect(session.page.locator("body").getAttribute("data-submitted")).resolves.toBe("yes");
  });

  it("throws a descriptive error when an answer cannot be matched exactly", async () => {
    const { adapter } = await createWjxAdapter(QUESTION_PAGE_HTML);
    const questions = await adapter.extractQuestions();

    await expect(adapter.answerQuestion(questions[0] as QuestionSnapshot, ["Svelte"])).rejects.toThrow(
      /Unable to match answers/
    );
  });

  it("best-effort parses structured result pages into complete bank entries", async () => {
    const { adapter } = await createWjxAdapter(STRUCTURED_RESULT_HTML);

    const entries = await adapter.extractResultArtifacts();

    expect(entries).toHaveLength(2);
    expect(entries[0]?.questionText).toBe("你常用的前端框架是？");
    expect(entries[0]?.correctAnswers).toEqual(["React"]);
    expect(entries[1]?.questionText).toBe("你熟悉哪些测试类型？");
    expect(entries[1]?.correctAnswers).toEqual(["单元测试", "端到端测试"]);
  });

  it("falls back to result-like sections and only returns complete entries", async () => {
    const { adapter } = await createWjxAdapter(FALLBACK_RESULT_HTML);

    const entries = await adapter.extractResultArtifacts();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.questionText).toBe("你熟悉哪些语言？");
    expect(entries[0]?.correctAnswers).toEqual(["TypeScript", "JavaScript"]);
    expect(entries[0]?.options).toEqual([]);
  });

  it("detects visible captcha-like markup", async () => {
    const { adapter } = await createWjxAdapter(CAPTCHA_HTML);

    await expect(adapter.detectCaptcha()).resolves.toBe(true);
  });

  it("is returned by the adapter factory when adapter.type is wjx", async () => {
    const session = await createBrowserSession(true);
    sessions.push(session);

    const config = buildAppConfig(process.cwd(), {
      targetUrl: buildDataUrl(QUESTION_PAGE_HTML),
      adapter: {
        type: "wjx"
      }
    });

    const adapter = createAdapter(config, session.page);
    expect(adapter).toBeInstanceOf(WjxAdapter);
  });
});
