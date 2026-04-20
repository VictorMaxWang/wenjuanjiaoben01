export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function timestampTag(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
