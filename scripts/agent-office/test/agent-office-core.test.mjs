import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runOfficeCore } from "../../../src/lib/agentOfficeCore.mjs";

const roles = JSON.parse(await readFile(new URL("../../../src/data/agentRoles.json", import.meta.url), "utf8"));

test("공유 코어는 한국어 명령으로 역할별 초안과 아침 보고서를 만든다", () => {
  const result = runOfficeCore("홍보 콘텐츠와 사업기획을 검토해줘", { roles, createdAt: "2026-09-24T00:00:00.000Z" });

  assert.ok(result.tasks.some((task) => task.agentId === "chief"));
  assert.ok(result.tasks.some((task) => task.agentId === "review"));
  assert.ok(result.tasks.some((task) => task.agentId === "content"));
  assert.match(result.report.markdown, /오늘의 핵심 3가지/);
  assert.match(result.report.markdown, /다음 액션 체크리스트/);
  assert.equal(result.drafts.every((draft) => draft.mode === "simulation"), true);
});

test("공유 코어는 빈 명령을 기본 예시로 정규화한다", () => {
  const result = runOfficeCore("  ", { roles, createdAt: "2026-09-24T00:00:00.000Z" });
  assert.match(result.report.command, /의기양양 두레동아리/);
});
