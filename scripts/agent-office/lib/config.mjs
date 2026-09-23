import path from "node:path";

const REQUIRED_PATHS = [
  "GOOGLE_OAUTH_CLIENT_SECRET_PATH",
  "GOOGLE_OAUTH_TOKEN_PATH"
];

function requiredPaths(env) {
  const missing = REQUIRED_PATHS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`${missing.join(", ")} 환경 변수가 필요합니다.`);
  }
}

function externalPath(value, name) {
  const resolvedPath = path.resolve(value);
  const relativePath = path.relative(process.cwd(), resolvedPath);
  const isInRepository = relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath));

  if (isInRepository) {
    throw new Error(`${name} must be outside the repository.`);
  }

  return resolvedPath;
}

export function loadBriefingConfig(env = process.env) {
  requiredPaths(env);

  return {
    clientSecretPath: externalPath(env.GOOGLE_OAUTH_CLIENT_SECRET_PATH, "GOOGLE_OAUTH_CLIENT_SECRET_PATH"),
    tokenPath: externalPath(env.GOOGLE_OAUTH_TOKEN_PATH, "GOOGLE_OAUTH_TOKEN_PATH"),
    calendarId: env.GOOGLE_CALENDAR_ID || "primary",
    spreadsheetId: env.PROJECT_STATE_SPREADSHEET_ID || "",
    sheetName: env.PROJECT_STATE_SHEET_NAME || "",
    aliasConfigPath: env.PROJECT_ALIAS_CONFIG_PATH || "automation/project-aliases.example.json",
    timezone: "Asia/Seoul",
    outputDir: env.OFFICE_BRIEFING_OUTPUT_DIR || "reports/private"
  };
}
