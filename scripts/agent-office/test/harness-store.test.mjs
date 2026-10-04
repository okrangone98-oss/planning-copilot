import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRunStore } from "../lib/harness-store.mjs";

test("run store writes records atomically and rejects artifact path traversal", async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "office-harness-store-"));
  t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
  const store = await createRunStore({ outputRoot, runId: "run-test-001" });

  await store.writeManifest({ id: "run-test-001", status: "QUEUED" });
  await store.appendEvent({ type: "RUN_STARTED", at: "2026-09-24T00:00:00.000Z" });
  await store.appendEvent({ type: "STEP_FINISHED", at: "2026-09-24T00:00:01.000Z" });
  const artifact = await store.writeArtifact("daily-briefing.md", "# 오늘 업무 브리핑");
  await store.writeSnapshot({ schemaVersion: "1.0", run: { id: "run-test-001" } });

  assert.equal(artifact, "artifacts/daily-briefing.md");
  assert.match(await fs.readFile(path.join(store.runDir, "manifest.json"), "utf8"), /QUEUED/);
  assert.equal((await fs.readFile(path.join(store.runDir, "events.jsonl"), "utf8")).trim().split("\n").length, 2);
  assert.match(await fs.readFile(path.join(store.runDir, "snapshot.json"), "utf8"), /schemaVersion/);
  await assert.rejects(store.writeArtifact("../outside.md", "bad"), /파일명만/);
});

test("run store rejects malformed run identifiers", async () => {
  await assert.rejects(createRunStore({ outputRoot: os.tmpdir(), runId: "../escape" }), /실행 ID/);
});
