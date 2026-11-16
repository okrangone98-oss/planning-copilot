import test from "node:test";
import assert from "node:assert/strict";
import { attachProjectId, resolveProjectId } from "../lib/project-aliases.mjs";

const aliases = {
  "P-WELCOME-2026": ["웰컴센터", "양양읍 웰컴센터", "KAN-49"],
  "P-SHARE-2026": ["성과공유회", "모두의 동아리존", "KAN-51"]
};

test("resolveProjectId matches normalized aliases and prefers the longest alias", () => {
  assert.equal(resolveProjectId("양양읍 웰컴센터 제작물 확인", aliases), "P-WELCOME-2026");
  assert.equal(resolveProjectId("ＫＡＮ／５１ 성과공유회", aliases), "P-SHARE-2026");
  assert.equal(resolveProjectId("관련 없는 제목", aliases), undefined);
});

test("resolveProjectId deterministically breaks equal-length alias ties by project id", () => {
  assert.equal(resolveProjectId("공통 프로젝트", {
    "P-Z": ["공통"],
    "P-A": ["공통"]
  }), "P-A");
});

test("attachProjectId preserves values and adds a resolved project id to objects", () => {
  const value = { name: "KAN-49 현황", statusText: "준비 중" };
  assert.deepEqual(attachProjectId(value, aliases), { ...value, projectId: "P-WELCOME-2026" });
  assert.equal(attachProjectId("관련 없는 값", aliases), "관련 없는 값");
});
