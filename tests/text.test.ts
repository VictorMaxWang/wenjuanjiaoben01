import { describe, expect, it } from "vitest";
import { normalizeQuestionText } from "../src/utils/text.js";

describe("normalizeQuestionText", () => {
  it("collapses whitespace, trims punctuation, and lowercases the string", () => {
    expect(normalizeQuestionText("  HTML   的标准缩写是？  ")).toBe("html 的标准缩写是？");
    expect(normalizeQuestionText("题目内容：   ")).toBe("题目内容");
  });
});
