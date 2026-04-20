export function normalizeQuestionText(input: string): string {
  return input.replace(/\s+/g, " ").replace(/[：:]\s*$/, "").trim().toLowerCase();
}

export function sanitizeFileSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "artifact";
}
