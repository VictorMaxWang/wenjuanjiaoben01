import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function waitForManualIntervention(message: string): Promise<void> {
  output.write("\u0007");

  const rl = readline.createInterface({ input, output });

  try {
    await rl.question(`${message}\n处理完成后按 Enter 继续... `);
  } finally {
    rl.close();
  }
}
