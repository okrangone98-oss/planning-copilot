import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAuthProvider } from "./lib/auth-provider.mjs";
import { buildDailyBriefing } from "./lib/briefing-logic.mjs";
import { renderDailyBriefing } from "./lib/briefing-renderer.mjs";
import { readCalendarEvents } from "./lib/calendar-adapter.mjs";
import { loadBriefingConfig } from "./lib/config.mjs";
import { readProjectState } from "./lib/drive-sheets-adapter.mjs";
import { readRecentEmails } from "./lib/gmail-adapter.mjs";
import { loadAliases } from "./lib/project-aliases.mjs";
import { sampleCalendarEvents, sampleEmails, sampleProjects } from "./sample-data.mjs";

const MOCK_CONFIG = {
  outputDir: "reports/private",
  aliasConfigPath: "automation/project-aliases.example.json",
  timezone: "Asia/Seoul"
};

export async function runBriefing({ mode = "oauth", config, now = new Date(), adapters, provider, googleClientFactory } = {}) {
  const resolvedConfig = config || (mode === "mock" ? MOCK_CONFIG : loadBriefingConfig());
  const resolvedAdapters = adapters || (mode === "mock"
    ? mockAdapters()
    : await createGoogleAdapters(await (provider || createAuthProvider(resolvedConfig, mode)).getAuthorizedClient(), resolvedConfig, googleClientFactory));
  const detectedAt = now.toISOString();
  const [calendarEvents, emails, projects, aliases] = await Promise.all([
    resolvedAdapters.calendar({ now, detectedAt }),
    resolvedAdapters.gmail({ now, detectedAt }),
    resolvedAdapters.projects({ detectedAt }),
    loadAliases(resolvedConfig.aliasConfigPath)
  ]);
  const briefing = buildDailyBriefing({ now, calendarEvents, emails, projects, aliases, detectedAt, timezone: resolvedConfig.timezone });
  const outputPath = await writeBriefing(resolvedConfig.outputDir, briefing, now, resolvedConfig.timezone);
  return { briefing, outputPath };
}

export async function createGoogleAdapters(client, config, googleClientFactory) {
  const google = googleClientFactory ? await googleClientFactory(client) : (await import("googleapis")).google;
  const calendarApi = google.calendar({ version: "v3", auth: client });
  const gmailApi = google.gmail({ version: "v1", auth: client });
  const driveApi = google.drive({ version: "v3", auth: client });
  const sheetsApi = google.sheets({ version: "v4", auth: client });
  return {
    calendar: ({ now, detectedAt }) => readCalendarEvents({ calendarApi, calendarId: config.calendarId || "primary", now, timezone: config.timezone, detectedAt }),
    gmail: ({ now, detectedAt }) => readRecentEmails({ gmailApi, now, detectedAt }),
    projects: ({ detectedAt }) => readProjectState({ driveApi, sheetsApi, spreadsheetId: config.spreadsheetId, sheetName: config.sheetName, detectedAt })
  };
}

export async function writeBriefing(outputDir, briefing, now, timezone = "Asia/Seoul") {
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).reduce((value, part) => part.type === "year" || part.type === "month" || part.type === "day" ? { ...value, [part.type]: part.value } : value, {});
  const outputPath = path.join(outputDir, `${dateKey.year}-${dateKey.month}-${dateKey.day}-daily-briefing.md`);
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  await fs.chmod(outputDir, 0o700);
  await fs.writeFile(outputPath, `${renderDailyBriefing(briefing)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(outputPath, 0o600);
  return outputPath;
}

function mockAdapters() {
  return {
    calendar: async () => sampleCalendarEvents,
    gmail: async () => sampleEmails,
    projects: async () => sampleProjects
  };
}

async function main() {
  const mode = process.argv.includes("--mock") ? "mock" : "oauth";
  try {
    const { briefing, outputPath } = await runBriefing({ mode });
    console.log(`Collected calendar=${briefing.collectionSummary.calendar} gmail=${briefing.collectionSummary.gmail} sheets=${briefing.collectionSummary.sheets}`);
    console.log(`Output: ${outputPath}`);
  } catch (error) {
    console.error(`Daily briefing failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}

export function isCliEntrypoint(moduleUrl, executablePath) {
  return moduleUrl === pathToFileURL(executablePath).href;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) main();
