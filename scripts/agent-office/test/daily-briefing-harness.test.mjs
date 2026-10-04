import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBriefing } from "../daily-briefing.mjs";

test("runBriefing can return normalized data without writing a second report", async (t) => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "office-briefing-harness-"));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  const result = await runBriefing({
    mode: "mock",
    config: { outputDir, aliasConfigPath: "missing-aliases.json", timezone: "Asia/Seoul" },
    now: new Date("2026-09-24T12:00:00+09:00"),
    writeOutput: false
  });

  assert.equal(result.outputPath, null);
  assert.deepEqual(await fs.readdir(outputDir), []);
});
