import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PROJECTS,
  WORKSPACE_SCHEMA_VERSION,
  activeProject,
  addProject,
  buildWorkspaceArchive,
  createEmptyWorkspace,
  createProjectMeta,
  dDayInfo,
  duplicateProject,
  findProject,
  grantStorageKey,
  hasProjectWork,
  hasWorkspaceWork,
  migrateLegacyWorkspace,
  normalizeDeadline,
  normalizeWorkspace,
  parseWorkspaceArchive,
  projectProgress,
  projectStorageKey,
  projectStatusLabel,
  projectTypeLabel,
  removeProject,
  selectProject,
  sortProjects,
  stripSecrets,
  updateProjectMeta,
  workspaceSummary
} from "../../../src/lib/projectWorkspace.mjs";
import { createEmptyGrantPlan, emptyBudgetLine } from "../../../src/lib/grantWorkflow.mjs";

const NOW = "2026-11-15T09:00:00.000Z";

function workspaceWithTwo() {
  const base = createEmptyWorkspace({ now: NOW });
  const first = base.projects[0];
  const firstUpdated = updateProjectMeta(base, first.id, { name: "청년 관광두레", type: "national", status: "running" }, NOW);
  const { workspace } = addProject(firstUpdated, { name: "로컬브랜드 공모", type: "contest", status: "submitted", deadline: "2026-12-01" }, NOW);
  return workspace;
}

test("빈 보드는 사업 하나에서 시작한다", () => {
  const workspace = createEmptyWorkspace({ now: NOW });
  assert.equal(workspace.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(workspace.projects.length, 1);
  assert.equal(workspace.activeProjectId, workspace.projects[0].id);
  assert.equal(workspace.legacyMigrated, false);
  assert.equal(activeProject(workspace).name, "내 사업 1");
  assert.equal(activeProject(workspace).status, "planning");
});

test("새 사업을 만들면 그 사업으로 전환된다", () => {
  const workspace = workspaceWithTwo();
  assert.equal(workspace.projects.length, 2);
  const active = activeProject(workspace);
  assert.equal(active.name, "로컬브랜드 공모");
  assert.equal(active.type, "contest");
  assert.equal(active.deadline, "2026-12-01");
  assert.equal(projectTypeLabel(active.type), "공모");
  assert.equal(projectStatusLabel(active.status), "신청 완료");
});

test("사업을 전환하고 정보를 고치면 수정일이 바뀐다", () => {
  const workspace = workspaceWithTwo();
  const firstId = workspace.projects[0].id;
  const switched = selectProject(workspace, firstId, NOW);
  assert.equal(switched.activeProjectId, firstId);
  assert.equal(findProject(switched, firstId).name, "청년 관광두레");

  const later = "2026-11-16T01:00:00.000Z";
  const updated = updateProjectMeta(switched, firstId, { status: "done", progress: 100 }, later);
  const target = findProject(updated, firstId);
  assert.equal(target.status, "done");
  assert.equal(target.progress, 100);
  assert.equal(target.updatedAt, later);
  assert.equal(target.createdAt, findProject(switched, firstId).createdAt);

  // 없는 사업 id는 아무것도 바꾸지 않는다.
  assert.equal(updateProjectMeta(switched, "prj_none", { name: "x" }, later), switched);
  assert.equal(selectProject(switched, "prj_none", later), switched);
});

test("복제는 새 id와 새 이름을 만들고 중복 id가 생기지 않는다", () => {
  const workspace = workspaceWithTwo();
  const source = workspace.projects[0];
  const { workspace: next, project } = duplicateProject(workspace, source.id, { now: NOW });
  assert.equal(next.projects.length, 3);
  assert.notEqual(project.id, source.id);
  assert.equal(project.name, "청년 관광두레 복제");
  assert.equal(project.type, source.type);
  assert.equal(next.activeProjectId, project.id);
  assert.equal(new Set(next.projects.map((item) => item.id)).size, 3);
});

test("마지막 사업은 지울 수 없고, 지우면 다른 사업으로 넘어간다", () => {
  const single = createEmptyWorkspace({ now: NOW });
  const refused = removeProject(single, single.projects[0].id, NOW);
  assert.equal(refused.removed, null);
  assert.match(refused.error, /마지막 사업/);
  assert.equal(refused.workspace.projects.length, 1);

  const workspace = workspaceWithTwo();
  const activeId = workspace.activeProjectId;
  const result = removeProject(workspace, activeId, NOW);
  assert.equal(result.removed.id, activeId);
  assert.equal(result.workspace.projects.length, 1);
  assert.equal(result.workspace.activeProjectId, workspace.projects[0].id);
  assert.equal(result.error, "");
});

test("사업 수 상한을 넘으면 더 만들지 않는다", () => {
  let workspace = createEmptyWorkspace({ now: NOW });
  for (let index = 1; index < MAX_PROJECTS; index += 1) {
    workspace = addProject(workspace, { name: `사업 ${index + 1}` }, NOW).workspace;
  }
  assert.equal(workspace.projects.length, MAX_PROJECTS);
  const blocked = addProject(workspace, { name: "하나 더" }, NOW);
  assert.equal(blocked.project, null);
  assert.match(blocked.error, /최대/);
  assert.equal(blocked.workspace.projects.length, MAX_PROJECTS);
});

test("저장된 값이 이상해도 보드를 다시 세운다", () => {
  const normalized = normalizeWorkspace({
    activeProjectId: "missing",
    projects: [
      { id: "a", name: "  첫 사업  ", type: "이상한 유형", status: "이상한 상태", deadline: "2026-13-40", progress: "250" },
      { id: "a", name: "", type: "contest", status: "done", deadline: "2026-12-01", progress: -5 },
      null
    ]
  }, { now: NOW });
  assert.equal(normalized.projects.length, 3);
  assert.equal(normalized.projects[0].name, "첫 사업");
  assert.equal(normalized.projects[0].type, "own");
  assert.equal(normalized.projects[0].status, "planning");
  assert.equal(normalized.projects[0].deadline, "");
  assert.equal(normalized.projects[0].progress, 100);
  assert.equal(normalized.projects[2].name, "사업 3");
  assert.equal(new Set(normalized.projects.map((project) => project.id)).size, 3);
  assert.equal(normalized.activeProjectId, normalized.projects[0].id);

  assert.equal(normalizeWorkspace(null).projects.length, 1);
  assert.equal(normalizeWorkspace({ projects: [] }).projects.length, 1);
  assert.equal(normalizeDeadline("2026-11-15"), "2026-11-15");
  assert.equal(normalizeDeadline("2026-11-31"), "");
});

test("마감일 D-day 표기", () => {
  assert.equal(dDayInfo("2026-11-18", NOW).label, "D-3");
  assert.equal(dDayInfo("2026-11-18", NOW).tone, "soon");
  assert.equal(dDayInfo("2026-11-15", NOW).label, "D-DAY");
  assert.equal(dDayInfo("2026-11-13", NOW).label, "D+2");
  assert.equal(dDayInfo("2026-11-13", NOW).tone, "overdue");
  assert.equal(dDayInfo("", NOW).label, "마감일 없음");
});

test("보드 순서는 진행 중·마감 임박 사업을 위로 올린다", () => {
  const projects = [
    createProjectMeta({ id: "done", name: "끝난 사업", status: "done", deadline: "2026-01-01" }),
    createProjectMeta({ id: "later", name: "나중 사업", status: "planning", deadline: "2027-03-01" }),
    createProjectMeta({ id: "soon", name: "임박 사업", status: "running", deadline: "2026-11-20" }),
    createProjectMeta({ id: "none", name: "마감 없음", status: "submitted" })
  ];
  assert.deepEqual(sortProjects(projects).map((project) => project.id), ["soon", "later", "none", "done"]);
});

test("사업 진행률은 계획서·예산·정산·결과보고를 합쳐 계산한다", () => {
  const empty = projectProgress({ project: {}, plan: createEmptyGrantPlan() });
  assert.equal(empty.percent, 0);
  assert.equal(empty.parts.length, 4);

  const plan = createEmptyGrantPlan();
  plan.budgetLines = [{ ...emptyBudgetLine("b1"), category: "사업비", item: "강사비", unitCost: "100000", quantity: "2", basis: "", note: "" }];
  const project = { noticeText: "공고문", coreIdea: "아이디어", problemSituation: "", activities: "", budgetPlan: "", riskPlan: "" };
  const partial = projectProgress({ project, plan });
  // 계획서 2/6 = 33% -> 13점, 예산 100% -> 25점
  assert.equal(partial.percent, 38);
  assert.equal(partial.parts.find((part) => part.key === "budget").percent, 100);
});

test("사업 정보 요약", () => {
  const summary = workspaceSummary(workspaceWithTwo());
  assert.equal(summary.total, 2);
  assert.equal(summary.activeName, "로컬브랜드 공모");
  assert.equal(summary.byStatus.find((status) => status.id === "running").count, 1);
});

test("예전 단일 저장 데이터는 첫 사업 슬롯으로 옮긴다", () => {
  const empty = createEmptyWorkspace({ now: NOW });
  const legacyProject = { projectName: "양양 관광두레", noticeText: "공고문 내용" };
  const legacyPlan = { ...createEmptyGrantPlan(), programName: "관광두레" };

  const result = migrateLegacyWorkspace({ workspace: empty, legacyProject, legacyPlan, now: NOW });
  assert.equal(result.migrated, true);
  assert.equal(result.projectId, empty.projects[0].id);
  assert.equal(result.workspace.projects.length, 1);
  assert.equal(activeProject(result.workspace).name, "양양 관광두레");
  assert.equal(result.workspace.legacyMigrated, true);

  // 두 번째 실행에서는 다시 옮기지 않는다.
  const again = migrateLegacyWorkspace({ workspace: result.workspace, legacyProject, legacyPlan, now: NOW });
  assert.equal(again.migrated, false);
  assert.equal(again.workspace.projects.length, 1);
});

test("옮길 작업이 없으면 사업만 하나 두고 넘어간다", () => {
  const result = migrateLegacyWorkspace({ workspace: createEmptyWorkspace({ now: NOW }), legacyProject: null, legacyPlan: null, now: NOW });
  assert.equal(result.migrated, false);
  assert.equal(result.workspace.legacyMigrated, true);
  assert.equal(result.workspace.projects[0].name, "내 사업 1");
});

test("이미 다른 사업이 있으면 옮길 데이터는 새 슬롯으로 들어간다", () => {
  const workspace = workspaceWithTwo();
  const result = migrateLegacyWorkspace({
    workspace: { ...workspace, legacyMigrated: false },
    legacyProject: { projectName: "예전 사업" },
    now: NOW
  });
  assert.equal(result.migrated, true);
  assert.equal(result.workspace.projects.length, 3);
  assert.equal(activeProject(result.workspace).name, "예전 사업");
});

test("작업 데이터가 있는지 구분한다", () => {
  assert.equal(hasProjectWork({}), false);
  assert.equal(hasProjectWork({ projectName: "  " }), false);
  assert.equal(hasProjectWork({ projectName: "사업" }), true);
  assert.equal(hasWorkspaceWork({ project: {}, plan: createEmptyGrantPlan() }), false);
  assert.equal(hasWorkspaceWork({ project: { draftOutput: "초안" }, plan: null }), true);
});

test("백업은 여러 사업을 담고 API 키는 담지 않는다", () => {
  const workspace = workspaceWithTwo();
  const [first, second] = workspace.projects;
  const archive = buildWorkspaceArchive({
    workspace,
    entries: {
      [first.id]: { project: { projectName: "청년 관광두레", apiKey: "sk-secret", nested: { token: "abc" } }, grantPlan: createEmptyGrantPlan() },
      [second.id]: { project: { projectName: "로컬브랜드 공모" }, grantPlan: null }
    },
    exportedAt: NOW
  });

  assert.equal(archive.kind, "workspace");
  assert.equal(archive.projects.length, 2);
  const serialized = JSON.stringify(archive);
  assert.doesNotMatch(serialized, /sk-secret/);
  assert.doesNotMatch(serialized, /"token"/);
  assert.doesNotMatch(serialized, /apiKey/);
  assert.match(serialized, /청년 관광두레/);

  const parsed = parseWorkspaceArchive(JSON.parse(serialized), { now: NOW });
  assert.equal(parsed.legacy, false);
  assert.equal(parsed.workspace.projects.length, 2);
  assert.equal(parsed.workspace.activeProjectId, workspace.activeProjectId);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].project.projectName, "청년 관광두레");
  assert.equal(parsed.entries[1].grantPlan, null);
});

test("예전 단일 백업 파일도 한 사업으로 복원한다", () => {
  const parsed = parseWorkspaceArchive({
    version: 5,
    project: { projectName: "예전 백업 사업", noticeText: "공고" },
    knowledgeDocs: [],
    grantPlan: createEmptyGrantPlan()
  }, { now: NOW });
  assert.equal(parsed.legacy, true);
  assert.equal(parsed.workspace.projects.length, 1);
  assert.equal(activeProject(parsed.workspace).name, "예전 백업 사업");
  assert.equal(parsed.entries[0].project.projectName, "예전 백업 사업");
});

test("사업별 저장 키와 비밀값 제거", () => {
  assert.equal(projectStorageKey(), "planningCopilotProject");
  assert.equal(projectStorageKey("prj_1"), "planningCopilotProject:prj_1");
  assert.equal(grantStorageKey("prj_1"), "planningCopilotGrantPlan:prj_1");
  assert.deepEqual(stripSecrets({ a: 1, apiKey: "x", list: [{ secret: "y", b: 2 }] }), { a: 1, list: [{ b: 2 }] });
});
