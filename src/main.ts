import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { createBrowserSession } from "./browser/browser-factory.js";
import { resolveExecutionConfig, resolveLearnConfig } from "./config.js";
import { SurveyCrawler } from "./crawler/survey-crawler.js";
import { Storage } from "./storage/storage.js";
import { createAdapter } from "./adapters/factory.js";

export function buildProgram(): Command {
  const program = new Command();

  program.name("survey-automation").description("Authorized survey automation framework");

  program
    .command("learn")
    .description("Collect question and answer artifacts into the local bank.")
    .requiredOption("-c, --config <path>", "Path to the JSON config file.")
    .option("--headless", "Run the browser in headless mode.")
    .action(async (options: { config: string; headless?: boolean }) => {
      const config = await resolveLearnConfig({
        configPath: options.config,
        headless: options.headless
      });
      await runLearnCommand(config);
    });

  program
    .command("execute")
    .description("Answer questions using the local question bank.")
    .requiredOption("-c, --config <path>", "Path to the JSON config file.")
    .option("--name <value>", "Real participant name.")
    .option("--student-id <value>", "Real participant student id.")
    .option("--college <value>", "Real participant college.")
    .option("--time-per-question <seconds>", "Delay between questions in seconds.", Number)
    .option("--headless", "Run the browser in headless mode.")
    .action(
      async (options: {
        config: string;
        name?: string;
        studentId?: string;
        college?: string;
        timePerQuestion?: number;
        headless?: boolean;
      }) => {
        const config = await resolveExecutionConfig({
          configPath: options.config,
          name: options.name,
          studentId: options.studentId,
          college: options.college,
          timePerQuestion: options.timePerQuestion,
          headless: options.headless
        });
        await runExecuteCommand(config);
      }
    );

  return program;
}

export async function runLearnCommand(config: Awaited<ReturnType<typeof resolveLearnConfig>>): Promise<void> {
  const storage = new Storage(config.bankFilePath, config.artifactsDir);
  await storage.initialize();

  const session = await createBrowserSession(config.headless);
  const adapter = createAdapter(config, session.page);
  const crawler = new SurveyCrawler(config, storage, adapter, session);

  try {
    await crawler.runLearningMode();
  } finally {
    await crawler.close();
  }
}

export async function runExecuteCommand(
  config: Awaited<ReturnType<typeof resolveExecutionConfig>>
): Promise<void> {
  const storage = new Storage(config.bankFilePath, config.artifactsDir);
  await storage.initialize();

  const session = await createBrowserSession(config.headless);
  const adapter = createAdapter(config, session.page);
  const crawler = new SurveyCrawler(config, storage, adapter, session);

  try {
    const summary = await crawler.runExecutionMode();
    console.log(
      `[execute] answered=${summary.answeredCount} pausedForManualIntervention=${summary.pausedForManualIntervention}`
    );
  } finally {
    await crawler.close();
  }
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
