import { pathToFileURL } from "node:url";
import { runHarness } from "./lib/run-harness.mjs";

const USAGE = [
  "사용법:",
  "  npm run office:harness -- --job daily-briefing [--mock]",
  "  npm run office:harness -- --job agent-office-command --command \"명령\""
].join("\n");

export function parseArgs(argv) {
  const values = { jobType: "", mode: "oauth", command: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--job") values.jobType = argv[++index] || "";
    else if (arg === "--command") values.command = argv[++index] || "";
    else if (arg === "--mock") values.mode = "mock";
    else throw new Error("알 수 없는 인자입니다: " + arg + "\n" + USAGE);
  }
  if (!values.jobType) throw new Error(USAGE);
  if (!["daily-briefing", "agent-office-command"].includes(values.jobType)) {
    throw new Error("지원하지 않는 작업입니다: " + values.jobType + "\n" + USAGE);
  }
  if (values.jobType === "agent-office-command" && !values.command.trim()) {
    throw new Error("--command에 사무국에 맡길 내용을 입력해 주세요.\n" + USAGE);
  }
  return values;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const snapshot = await runHarness(options);
    console.log("실행 ID: " + snapshot.run.id);
    console.log("상태: " + snapshot.run.status);
    console.log("snapshot: reports/private/runs/" + snapshot.run.id + "/snapshot.json");
    if (snapshot.run.status === "FAILED" || snapshot.run.status === "NEEDS_ATTENTION") process.exitCode = 1;
    return snapshot;
  } catch (error) {
    console.error(error instanceof Error ? error.message : USAGE);
    process.exitCode = error instanceof Error && error.message.includes("사용법") ? 2 : 1;
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
