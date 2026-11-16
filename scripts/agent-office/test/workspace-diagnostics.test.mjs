import test from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_QUOTA_BYTES,
  buildWorkspaceDiagnostics,
  collectStorageEntries,
  describeAiRoute,
  findSecretsInText,
  formatStorageSize,
  scanStorageSecrets,
  summarizeStorage
} from "../../../src/lib/workspaceDiagnostics.mjs";

/** localStorage 대역. 앱 저장소를 흉내 내는 데 필요한 세 가지만 둔다. */
class MemoryStorage {
  values = new Map();
  get length() {
    return this.values.size;
  }
  key(index) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

function work(over = {}) {
  return { projectId: "p1", tasks: [], sessions: [], expenses: [], ...over };
}

const project = { id: "p1", name: "사업 하나" };

test("사업·지출·회차를 저장된 작업 데이터에서 그대로 센다", () => {
  const diagnostics = buildWorkspaceDiagnostics({
    projects: [project, { id: "p2", name: "사업 둘" }],
    works: {
      p1: work({ expenses: [{ id: "e1" }, { id: "e2" }], sessions: [{ id: "s1" }], tasks: [{ id: "t1" }, { id: "t2" }, { id: "t3" }] }),
      p2: work({ expenses: [{ id: "e3" }], sessions: [{ id: "s2" }, { id: "s3" }] })
    },
    modelSettings: { provider: "simulation" },
    storage: new MemoryStorage()
  });

  assert.equal(diagnostics.usage.projectCount, 2);
  assert.equal(diagnostics.usage.expenseCount, 3);
  assert.equal(diagnostics.usage.sessionCount, 3);
  assert.equal(diagnostics.usage.taskCount, 3);
  assert.equal(diagnostics.usage.projectsWithWork, 2);
});

test("아무것도 없는 첫 실행에서도 0건·0KB로 계산하고 경고를 만들지 않는다", () => {
  const diagnostics = buildWorkspaceDiagnostics({
    projects: [],
    works: {},
    modelSettings: { provider: "simulation" },
    storage: new MemoryStorage()
  });

  assert.equal(diagnostics.usage.projectCount, 0);
  assert.equal(diagnostics.usage.expenseCount, 0);
  assert.equal(diagnostics.usage.sessionCount, 0);
  assert.equal(diagnostics.usage.storage.kb, 0);
  assert.equal(diagnostics.usage.storage.usedPercent, 0);
  assert.equal(diagnostics.usage.storage.level, "ok");
  assert.equal(diagnostics.security.secretScan.total, 0);
  assert.equal(diagnostics.security.piiMaskEnabled, true);
  assert.deepEqual(diagnostics.warnings, []);
  assert.equal(Number.isNaN(diagnostics.cost.hostingMonthlyKrw), false);
  assert.equal(diagnostics.cost.hostingMonthlyKrw, 0);
});

test("저장소 인자와 사업 인자가 없어도 계산이 죽지 않는다", () => {
  const diagnostics = buildWorkspaceDiagnostics();
  assert.equal(diagnostics.usage.projectCount, 0);
  assert.equal(diagnostics.usage.storage.entryCount, 0);
  assert.equal(diagnostics.security.route.id, "simulation");
});

test("localStorage 사용량은 글자당 2바이트로 어림하고 한도 대비 여유를 함께 낸다", () => {
  const storage = new MemoryStorage();
  storage.setItem("planningCopilotWorkspace", "가".repeat(100));
  const entries = collectStorageEntries(storage);
  const keyBytes = "planningCopilotWorkspace".length * 2;

  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "planningCopilotWorkspace");
  assert.equal(entries[0].bytes, keyBytes + 200);

  const usage = summarizeStorage(entries);
  assert.equal(usage.bytes, keyBytes + 200);
  assert.equal(usage.quotaBytes, STORAGE_QUOTA_BYTES);
  assert.equal(usage.usedPercent, 0);
  assert.equal(usage.freeKb, Math.round(((STORAGE_QUOTA_BYTES - keyBytes - 200) / 1024) * 10) / 10);
});

test("한도에 가까워지면 단계가 warn·critical로 올라간다", () => {
  const quotaBytes = 1000;
  assert.equal(summarizeStorage([{ key: "a", bytes: 500 }], quotaBytes).level, "ok");
  assert.equal(summarizeStorage([{ key: "a", bytes: 850 }], quotaBytes).level, "warn");
  assert.equal(summarizeStorage([{ key: "a", bytes: 990 }], quotaBytes).level, "critical");
  const full = summarizeStorage([{ key: "a", bytes: 2000 }], quotaBytes);
  assert.equal(full.usedPercent, 100);
  assert.equal(full.freeKb, 0);
});

test("저장된 API 키는 탐지하되 값은 결과에 남기지 않는다", () => {
  const secret = "sk-or-v1-abcdefghijklmnop";
  const storage = new MemoryStorage();
  storage.setItem("planningCopilotModelSettings", JSON.stringify({ provider: "openrouter-free", stale: secret }));
  storage.setItem("planningCopilotWorkspace", JSON.stringify({ projects: [] }));

  const scan = scanStorageSecrets(storage);
  assert.equal(scan.total, 1);
  assert.deepEqual(scan.keys, ["planningCopilotModelSettings"]);
  assert.deepEqual(scan.types.map((type) => type.id), ["openrouter"]);

  const diagnostics = buildWorkspaceDiagnostics({ projects: [], works: {}, storage, modelSettings: { provider: "simulation" } });
  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes(secret), false);
  assert.equal(diagnostics.security.backup.safe, false);
  assert.equal(diagnostics.security.secretScan.total, 1);
  assert.match(diagnostics.warnings.join("\n"), /API 키 모양/);
});

test("키가 없는 저장소는 백업 안전으로 표시한다", () => {
  const storage = new MemoryStorage();
  storage.setItem("planningCopilotProject", JSON.stringify({ projectName: "양양 청년 사업", budgetPlan: "소규모" }));
  const diagnostics = buildWorkspaceDiagnostics({ projects: [project], works: { p1: work() }, storage });

  assert.equal(diagnostics.security.secretScan.total, 0);
  assert.equal(diagnostics.security.backup.safe, true);
  assert.equal(diagnostics.security.backup.includesModelSettings, false);
  assert.equal(diagnostics.usage.backupEntryCount, 1);
});

test("키 모양 탐지는 종류별로 세고, 짧은 흔적은 키로 보지 않는다", () => {
  assert.equal(findSecretsInText("gsk_" + "a".repeat(20)).total, 1);
  assert.equal(findSecretsInText("AIza" + "B".repeat(30)).total, 1);
  // 2026년 Google AI Studio의 신형식 AQ. 키도 키 모양으로 잡는다.
  assert.equal(findSecretsInText("AQ." + "B".repeat(30)).total, 1);
  assert.equal(findSecretsInText("AQ.short").total, 0);
  assert.equal(findSecretsInText("(ghp_" + "c".repeat(24) + ")").total, 1);
  assert.equal(findSecretsInText("tl-" + "d".repeat(20)).total, 1);
  assert.equal(findSecretsInText("sk-or-short").total, 0);
  assert.equal(findSecretsInText("일반 문서에는 키가 없습니다.").total, 0);
  assert.equal(findSecretsInText("").total, 0);
  assert.equal(findSecretsInText(null).total, 0);
});

test("AI 경로: 템플릿·로컬은 외부 전송 없음 0원, 무료 티어는 0원, 직접 키는 단정하지 않는다", () => {
  const template = describeAiRoute({ provider: "simulation" });
  assert.equal(template.sendsExternal, false);
  assert.equal(template.monthlyKrw, 0);
  assert.equal(template.costLabel, "0원");

  const local = describeAiRoute({ provider: "ollama" });
  assert.equal(local.sendsExternal, false);
  assert.equal(local.scope, "local");

  const proxy = describeAiRoute({ provider: "custom-openai" });
  assert.equal(proxy.sendsExternal, false);
  assert.equal(proxy.scope, "local");

  const free = describeAiRoute({ provider: "groq-free" });
  assert.equal(free.sendsExternal, true);
  assert.equal(free.monthlyKrw, 0);
  assert.match(free.costLabel, /0원/);

  const ownKey = describeAiRoute({ provider: "exaone" });
  assert.equal(ownKey.monthlyKrw, null);
  assert.equal(ownKey.costKind, "own-key");
  assert.equal(ownKey.blocked, true);

  const unknown = describeAiRoute({ provider: "없는-경로" });
  assert.equal(unknown.monthlyKrw, null);
  assert.equal(unknown.sendsExternal, null);
});

test("운영비 요약은 호스팅 0원을 항상 포함하고, 직접 키면 총액을 단정하지 않는다", () => {
  const free = buildWorkspaceDiagnostics({ modelSettings: { provider: "gemini-openai" }, storage: new MemoryStorage() });
  assert.equal(free.cost.hostingMonthlyKrw, 0);
  assert.equal(free.cost.totalMonthlyKrw, 0);
  assert.match(free.cost.note, /0원/);

  const ownKey = buildWorkspaceDiagnostics({ modelSettings: { provider: "github-models" }, storage: new MemoryStorage() });
  assert.equal(ownKey.cost.hostingMonthlyKrw, 0);
  assert.equal(ownKey.cost.totalMonthlyKrw, null);
  assert.match(ownKey.cost.note, /제공자 정책/);
});

test("개인정보 마스킹을 끄면 경고를 남기고, 외부 전송 경로면 그 사실도 함께 알린다", () => {
  const diagnostics = buildWorkspaceDiagnostics({
    modelSettings: { provider: "openrouter-free" },
    piiMaskEnabled: false,
    storage: new MemoryStorage()
  });

  assert.equal(diagnostics.security.piiMaskEnabled, false);
  const joined = diagnostics.warnings.join("\n");
  assert.match(joined, /개인정보 마스킹/);
  assert.match(joined, /외부 AI/);
});

test("저장량 표기는 KB·MB로 읽히고 0이면 0KB다", () => {
  assert.equal(formatStorageSize(0), "0KB");
  assert.equal(formatStorageSize(0.4), "0.4KB");
  assert.equal(formatStorageSize(512.4), "512KB");
  assert.equal(formatStorageSize(2048), "2.0MB");
  assert.equal(formatStorageSize(Number.NaN), "0KB");
});
