# 사무국장 업무 관제탑 하네스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 기존 AI 사무국과 Google Workspace Daily Briefing을 로컬 하네스로 실행하고, 정제된 스냅샷을 관제탑에서 검토할 수 있게 한다.

**Architecture:** Node.js 하네스가 `daily-briefing`과 `agent-office-command` 작업을 실행하고 개인용 run 디렉터리에 manifest, append-only 이벤트 로그, Markdown 산출물, UI용 snapshot을 기록한다. React 관제탑은 스냅샷을 수동으로 가져와 로컬 저장소에 보관하고 승인·보류 상태를 기록한다. 브라우저와 Node가 같은 AI 사무국 코어와 역할 정의를 사용한다.

**Tech Stack:** 기존 Node.js ESM, Node built-in `node:test`, Vite, React, TypeScript, 기존 `googleapis`와 브라우저 localStorage. 신규 패키지는 추가하지 않는다.

## Global Constraints

- 지원하는 하네스 작업은 `daily-briefing`과 `agent-office-command` 두 개뿐이다.
- 원본 자료, manifest, event log, snapshot, Markdown 산출물은 `reports/private/` 아래에 둔다.
- 토큰, API 키, 메일 전문, 첨부파일, 주민 개인정보를 snapshot과 Git에 넣지 않는다.
- Google Workspace 접근은 기존 read-only scope와 adapter를 사용한다.
- 메일 발송, Calendar·Drive·Sheets 수정, 외부 게시·제출, 자동 승인을 구현하지 않는다.
- 자동 재시도는 명시적으로 재시도 가능하다고 표시된 안전 단계에 한해 최초 실행 이후 최대 2회다.
- Playwright는 MVP 런타임 의존성에 포함하지 않는다.
- 기존 `npm run office:test`, `npm run check`, `npm run build` 계약을 유지한다.
- 기존 사용자 변경과 저장소의 별도 `AGENTS.md`, `.superpowers/sdd/` 파일은 변경하거나 커밋하지 않는다.

---

## 구현 파일 지도

- `src/data/agentRoles.json`: 브라우저와 Node가 함께 읽는 단일 에이전트 역할 정의.
- `src/data/agentRoles.ts`: JSON 역할 데이터에 `AgentRole` 타입과 조회 함수를 제공.
- `src/lib/agentOfficeCore.mjs`: 브라우저와 CLI가 공유하는 순수 템플릿 기반 작업 분해·초안·보고서 생성 로직.
- `src/lib/agentOfficeCore.d.mts`: 공유 JavaScript 코어의 TypeScript 선언.
- `src/lib/agentOffice.ts`: 기존 UI에서 사용하는 API를 유지하는 타입 지정 facade.
- `scripts/agent-office/lib/harness-contracts.mjs`: 상태, 전이, 재시도 오류 계약.
- `scripts/agent-office/lib/harness-store.mjs`: 개인용 실행 폴더, 권한, 원자적 snapshot 기록.
- `scripts/agent-office/lib/control-tower-snapshot.mjs`: snapshot 생성, 정제, 버전 검증.
- `scripts/agent-office/jobs/daily-briefing.mjs`: 기존 Briefing 실행기를 하네스 job으로 연결.
- `scripts/agent-office/jobs/agent-office-command.mjs`: 공유 AI 사무국 코어를 하네스 job으로 연결.
- `scripts/agent-office/lib/run-harness.mjs`: 단계 실행, 상태 전이, 로그, 재시도 오케스트레이션.
- `scripts/agent-office/harness.mjs`: CLI 인자 처리 및 종료 코드.
- `src/types.ts`: 브라우저 snapshot 및 승인 상태 타입.
- `src/lib/controlTowerStorage.ts`: 관제탑 snapshot과 승인 overlay의 localStorage 저장.
- `src/components/ControlTowerView.tsx`: 파일 가져오기, 스냅샷 검증 결과와 업무 관제 화면.
- `src/App.tsx`, `src/styles.css`: 기존 AI 운영 메뉴와 앱 스타일에 관제탑 연결.
- `scripts/agent-office/test/`: 하네스 계약, 저장소, job, snapshot 통합 Node 테스트.
- `docs/agent-office-harness.md`: 사용자 실행·검토·개인정보 운영 안내.
- `scripts/agent-office/README.md`: 개발자 CLI와 mock/OAuth 실행 안내 보완.
- `package.json`: `office:harness` 스크립트 추가.
- `docs/google-workspace-briefing.md`: Windows/WSL 환경변수 설정 방법 및 OAuth 준비 단계 보완.

### 공통 인터페이스

```js
runOfficeCore(command, { roles, createdAt, mode }) -> OfficeResult
runHarness({ jobType, command, mode, outputRoot, now, adapters }) -> Promise<ControlTowerSnapshot>
createRunStore({ outputRoot, runId }) -> { runDir, writeManifest, appendEvent, writeArtifact, writeSnapshot }
buildControlTowerSnapshot({ run, steps, approvals, artifacts, sources, generatedAt }) -> ControlTowerSnapshot
validateControlTowerSnapshot(value) -> { ok: true, value } | { ok: false, error: string }
```

`HarnessStatus`는 `QUEUED | RUNNING | WAITING_APPROVAL | SUCCEEDED | NEEDS_ATTENTION | FAILED | CANCELLED`다. Import snapshot은 `schemaVersion: "1.0"` 및 `jobType: "daily-briefing" | "agent-office-command"`를 포함한다.

---

### Task 1: AI 사무국 코어를 브라우저와 Node에서 공유

**Files:**
- Create: `src/data/agentRoles.json`
- Modify: `src/data/agentRoles.ts`
- Create: `src/lib/agentOfficeCore.mjs`
- Create: `src/lib/agentOfficeCore.d.mts`
- Modify: `src/lib/agentOffice.ts`
- Create: `scripts/agent-office/test/agent-office-core.test.mjs`

**Interfaces:**
- `agentRoles.json`이 7개 역할의 canonical source다.
- `agentOfficeCore.mjs`는 `runOfficeCore(command, { roles, createdAt, mode })`, `createReportMarkdown(result)`, `slugifyCommand(command)`를 export한다.
- 기존 `agentOffice.ts`의 `runOffice`, `callLLM`, `createReportMarkdown`, `slugifyCommand` export 이름을 유지한다.

- [x] **Step 1: 공유 코어 테스트 작성**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runOfficeCore } from "../../../src/lib/agentOfficeCore.mjs";

const roles = JSON.parse(await readFile(new URL("../../../src/data/agentRoles.json", import.meta.url), "utf8"));

test("공유 코어는 한국어 명령으로 기존 7역할 결과와 아침 보고서를 만든다", () => {
  const result = runOfficeCore("홍보 콘텐츠와 사업기획을 검토해줘", { roles, createdAt: "2026-09-24T00:00:00.000Z" });
  assert.ok(result.tasks.some((task) => task.agentId === "chief"));
  assert.ok(result.tasks.some((task) => task.agentId === "review"));
  assert.match(result.report.markdown, /오늘의 핵심 3가지/);
  assert.match(result.report.markdown, /다음 액션 체크리스트/);
  assert.equal(result.drafts.every((draft) => draft.mode === "simulation"), true);
});
```

- [x] **Step 2: 기존 코어 결과와 호환되는지 실패를 확인**

Run: `node --test scripts/agent-office/test/agent-office-core.test.mjs`

Expected: FAIL because the shared module and canonical role JSON do not exist.

- [x] **Step 3: 역할 정의를 JSON으로 옮기고 기존 TypeScript API 연결**

`agentRoles.json`은 현재 `src/data/agentRoles.ts`의 7개 역할 객체를 필드와 문구 변경 없이 이동한다. `agentRoles.ts`는 JSON을 import하여 `AgentRole[]`로 내보내고 `getAgentRole(id)` 조회 함수를 유지한다.

```ts
import roles from "./agentRoles.json";
import type { AgentRole } from "../types";

export const agentRoles = roles as AgentRole[];
export function getAgentRole(id: AgentRole["id"]) {
  return agentRoles.find((role) => role.id === id);
}
```

기존 `agentOffice.ts`의 순수 생성 로직을 `agentOfficeCore.mjs`로 옮긴다. 코어는 역할 목록을 옵션으로 받고, 역할 prompt는 해당 목록에서 찾는다. stub의 시뮬레이션 표식과 기존 보고서 섹션·작업 배정 결과를 보존한다. `.d.mts`는 `runOfficeCore` 및 기존 반환 타입을 정확히 선언한다. `agentOffice.ts`는 `agentRoles`를 주입하는 facade로 유지한다.

- [x] **Step 4: 공유 코어 테스트 통과 확인**

Run: `node --test scripts/agent-office/test/agent-office-core.test.mjs`

Expected: PASS; no network access and no new packages.

- [x] **Step 5: TypeScript 및 기존 사무국 계약 확인**

Run: `npm run check`

Expected: PASS; existing `App.tsx` imports and output types remain valid.

---

### Task 2: 하네스 상태 모델, 안전한 저장소, snapshot 검증

**Files:**
- Create: `scripts/agent-office/lib/harness-contracts.mjs`
- Create: `scripts/agent-office/lib/harness-store.mjs`
- Create: `scripts/agent-office/lib/control-tower-snapshot.mjs`
- Create: `scripts/agent-office/test/harness-contracts.test.mjs`
- Create: `scripts/agent-office/test/harness-store.test.mjs`
- Create: `scripts/agent-office/test/control-tower-snapshot.test.mjs`

**Interfaces:**
- `transitionStatus(current, next)`는 허용된 전이만 반환하고 잘못된 전이는 명시적인 오류를 던진다.
- `RetryableStepError(message)`만 재시도 대상이고 `MAX_RETRIES`는 `2`다.
- `createRunStore({ outputRoot, runId })`는 run 폴더에 `manifest.json`, `events.jsonl`, `snapshot.json`, `artifacts/`를 생성한다.
- `validateControlTowerSnapshot`은 `{ ok, value/error }` 계약을 지킨다.

- [x] **Step 1: 상태 전이·재시도 테스트 작성**

```js
test("실행 상태는 허용 전이만 통과시킨다", () => {
  assert.equal(transitionStatus("QUEUED", "RUNNING"), "RUNNING");
  assert.equal(transitionStatus("RUNNING", "WAITING_APPROVAL"), "WAITING_APPROVAL");
  assert.throws(() => transitionStatus("SUCCEEDED", "RUNNING"), /허용되지 않는 상태 전이/);
});

test("재시도 계약은 최대 2회이며 명시적 재시도 오류만 허용한다", () => {
  assert.equal(MAX_RETRIES, 2);
  assert.equal(isRetryableStepError(new RetryableStepError("일시 오류")), true);
  assert.equal(isRetryableStepError(new Error("인증 실패")), false);
});
```

- [x] **Step 2: 저장소·snapshot 입력 검증 테스트 작성**

테스트는 `node:os` 임시 폴더를 사용한다. 매니페스트/이벤트/snapshot 파일 존재, 이벤트 append 순서, artifact 상대경로 제한, 올바른 `schemaVersion`, 잘못된 버전 거절을 검증한다. sanitizer 입력 fixture에는 `secret@example.org`, 전화번호, 주민등록번호 모양 값, 토큰 키, Gmail `body`를 넣고 결과에 원문 값·필드가 남지 않는지 확인한다.

- [x] **Step 3: 기대된 실패 확인**

Run: `node --test scripts/agent-office/test/harness-contracts.test.mjs scripts/agent-office/test/harness-store.test.mjs scripts/agent-office/test/control-tower-snapshot.test.mjs`

Expected: FAIL because harness modules do not exist.

- [x] **Step 4: 상태 계약과 로컬 전용 파일 저장 구현**

상태 상수와 합법 전이를 표로 구현한다. 파일은 UTF-8 JSON/JSONL로 쓴다. Unix에서 run 폴더는 `0700`, 파일은 `0600`으로 설정하고 Windows에서는 chmod 실패를 실행 실패로 취급하지 않는다. `writeSnapshot`은 동일 디렉터리 임시 파일에 쓴 뒤 rename해 부분 기록을 막는다. artifact 이름은 파일명만 허용하고 `..`, 절대경로, 경로 구분자를 거부한다.

- [x] **Step 5: 정제 snapshot builder와 검증기 구현**

snapshot은 `schemaVersion`, `generatedAt`, run 요약, 단계 요약, 알림, 승인 메타데이터, artifact 참조, 정제 출처만 포함한다. 키 이름이 `token`, `secret`, `apiKey`, `body`, `attachment`인 값은 재귀적으로 제거한다. Gmail 전문/snippet/from은 snapshot에 포함하지 않는다. 자유 텍스트에서는 이메일, 한국 휴대전화·전화번호, 주민등록번호 패턴을 마스킹하고 문자열 길이를 제한한다. 알 수 없는 schema 버전과 필수 타입 누락은 거부한다.

- [x] **Step 6: 계약·저장소·snapshot 테스트 통과 확인**

Run: `node --test scripts/agent-office/test/harness-contracts.test.mjs scripts/agent-office/test/harness-store.test.mjs scripts/agent-office/test/control-tower-snapshot.test.mjs`

Expected: PASS; temporary files are removed after each test.

---

### Task 3: 두 작업 adapter와 하네스 실행기·CLI

**Files:**
- Modify: `scripts/agent-office/daily-briefing.mjs`
- Create: `scripts/agent-office/jobs/daily-briefing.mjs`
- Create: `scripts/agent-office/jobs/agent-office-command.mjs`
- Create: `scripts/agent-office/lib/run-harness.mjs`
- Create: `scripts/agent-office/harness.mjs`
- Modify: `package.json`
- Create: `scripts/agent-office/test/run-harness.test.mjs`
- Create: `scripts/agent-office/test/harness-cli.test.mjs`

**Interfaces:**
- `runHarness({ jobType, command, mode = "oauth", outputRoot = "reports/private", now = new Date(), adapters })`는 최종 snapshot을 반환한다.
- job adapter는 `{ run(input) }`를 받고 `{ summary, artifact, sources, approval }`를 반환한다.
- 허용 CLI: `--job daily-briefing [--mock]`, `--job agent-office-command --command "..."`.

- [x] **Step 1: 실행기·job 실패 테스트 작성**

Mock outputRoot와 고정 `now`를 사용한다. `daily-briefing --mock`에서 `WAITING_APPROVAL`, manifest, 이벤트 로그, snapshot, Markdown 산출물 4종을 확인한다. `agent-office-command`는 AI 사무국 코어와 동일한 보고서 제목·작업 역할을 사용하는지 확인한다. 지원하지 않는 job, 빈 command는 실행 폴더를 만들기 전에 명확히 거부한다.

- [x] **Step 2: 재시도 및 오류 상태 테스트 작성**

주입 adapter가 `RetryableStepError`를 2회 던진 뒤 성공하도록 하여 총 3회 호출과 이벤트 기록을 확인한다. 인증/설정 오류는 1회 호출 후 `NEEDS_ATTENTION`인지, 재시도 가능 오류가 3회 실패하면 `FAILED`인지 검증한다. 그 어떤 테스트도 Google 네트워크를 호출하지 않는다.

- [x] **Step 3: 테스트 실패 확인**

Run: `node --test scripts/agent-office/test/run-harness.test.mjs scripts/agent-office/test/harness-cli.test.mjs`

Expected: FAIL because runner and CLI do not exist.

- [x] **Step 4: Daily Briefing 실행기에 표준 파일명 선택 옵션 추가**

`runBriefing`에 `outputFileName` 선택 인자를 추가하고 기존 기본 날짜 파일명 동작을 유지한다. 하네스 adapter는 `reports/private/runs/<runId>/artifacts/daily-briefing.md`에 쓴다. mock 실행에서 기존 sample adapter와 기존 `buildDailyBriefing`/`renderDailyBriefing` 결과를 재사용한다.

- [x] **Step 5: AI 사무국 job을 공유 코어에 연결**

job adapter는 `src/data/agentRoles.json`을 읽고 `runOfficeCore`를 호출한다. 최종 보고서를 `artifacts/agent-office-report.md`에 저장하고, snapshot용 summary에서 자유 텍스트를 정제한다. `--command` 문자열을 이벤트 로그에 원문으로 넣지 않는다.

- [x] **Step 6: 하네스 runner와 CLI 구현**

각 실행에서 `QUEUED -> RUNNING` 기록 후 단계별 event를 append한다. 정상 job은 artifact와 snapshot 생성 후 `WAITING_APPROVAL`로 끝난다. 재시도는 `RetryableStepError`만, 최초 실행 뒤 최대 2회, 짧은 지수 대기만 적용한다. 인증·설정·입력·schema 오류는 재시도하지 않고 `NEEDS_ATTENTION`으로 기록한다. CLI는 잘못된 인자를 한국어 사용법과 종료 코드 `2`로, 실행 실패를 종료 코드 `1`로 표시한다.

- [x] **Step 7: focused 테스트와 기존 Briefing 테스트 실행**

Run: `node --test scripts/agent-office/test/run-harness.test.mjs scripts/agent-office/test/harness-cli.test.mjs scripts/agent-office/test/daily-briefing.test.mjs`

Expected: PASS; `--mock` is network-free and existing `office:briefing` output naming remains unchanged.

- [x] **Step 8: package script 추가 및 실제 CLI mock 실행**

`package.json`에 `"office:harness": "node scripts/agent-office/harness.mjs"`를 추가한다.

Run: `npm run office:harness -- --job daily-briefing --mock`

Expected: terminal prints run ID and local snapshot path; all new output is under ignored `reports/private/`.

---

### Task 4: 관제탑 TypeScript 계약과 안전한 브라우저 저장

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/controlTowerStorage.ts`
- Create: `src/lib/controlTowerStorage.test.ts`

**Interfaces:**
- Add `HarnessStatus`, `HarnessJobType`, `ControlTowerSnapshot`, `HarnessStepSummary`, `HarnessAlert`, `ApprovalItemSnapshot`, `ArtifactRef`, `SanitizedSourceRef`.
- `loadControlTowerState()`, `saveControlTowerSnapshot(snapshot)`, `saveControlTowerApproval(runId, approvalId, status)`, `clearControlTowerState()` expose UI storage operations.

- [x] **Step 1: localStorage contract test 작성**

Inject a small `Storage` fake; assert missing/invalid JSON returns empty state, valid snapshot and approval overlay survive reload, approval keys include `runId`, and clear removes only the control tower key. Confirm existing project, office, and approval storage keys are untouched.

- [x] **Step 2: TypeScript 타입과 storage adapter 구현**

브라우저 타입은 Task 2의 JSON snapshot 필드와 일치시킨다. 저장 시 `validateControlTowerSnapshot`의 브라우저용 타입 검증을 실행하고 schema 버전이 다른 데이터는 덮어쓰지 않는다. 사용자 데이터는 오직 전용 localStorage key에 저장한다.

- [x] **Step 3: 타입 검사 통과 확인**

Run: `npm run check`

Expected: PASS; 기존 저장 기능의 key와 자료형은 바뀌지 않는다.

---

### Task 5: 수동 snapshot 가져오기와 관제탑 UI

**Files:**
- Create: `src/components/ControlTowerView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/types.ts`

**Interfaces:**
- `ControlTowerView` props: `{ snapshot, approvals, onImport, onApprovalChange, onClear, onNavigate }`.
- Add `SectionId` value `controlTower` and `AI 운영` navigation item `업무 관제탑`.

- [x] **Step 1: 수동 import/승인 동작을 위한 UI 단위 테스트 케이스 작성**

현재 설치된 UI 테스트 도구가 없으므로 신규 의존성을 추가하지 않는다. 대신 JSON validator와 import handler를 순수 함수로 분리해 Node built-in 테스트에서 정상 JSON, 잘못된 JSON, schema 버전 불일치, 이전 정상 snapshot 보존, 빈 파일 처리를 검증한다.

- [x] **Step 2: 가져오기·승인 overlay 순수 함수 테스트 실패 확인**

Run: `node --test scripts/agent-office/test/control-tower-import.test.mjs`

Expected: FAIL because the pure parser/validator adapter does not exist.

- [x] **Step 3: import adapter와 UI 컴포넌트 구현**

파일 선택과 드래그 앤 드롭으로 JSON 파일을 읽는다. validator 통과 후에만 현재 snapshot을 바꾼다. 실패 시 기존 데이터를 유지하고 한국어 오류를 표시한다. 관제 화면은 마지막 갱신, job 종류, 실행 상태, 단계 목록, 확인 필요, 승인 대기, artifact 이름을 보여준다. 승인·보류는 localStorage overlay에만 기록하고 Google 또는 원본 run 폴더에 쓰지 않는다. 승인 완료를 외부 발송/제출 권한으로 표현하지 않는다. `AI 사무국`, `승인함`으로 이동하는 버튼을 제공한다.

- [x] **Step 4: App navigation/state 연결 및 반응형 스타일 추가**

새 메뉴를 `AI 운영` 그룹에 추가한다. App 초기화 때 저장 snapshot을 읽고, import/승인/삭제 callback으로 저장소 adapter를 호출한다. snapshot이 없을 때는 CLI 사용 예를 안내하고, 오류가 있어도 다른 탭을 사용할 수 있게 한다. 스타일은 기존 공통 Panel, table, button 패턴을 이용한다.

- [x] **Step 5: validator·import 테스트와 프로젝트 check 실행**

Run: `node --test scripts/agent-office/test/control-tower-import.test.mjs && npm run check`

Expected: PASS; existing tabs still render and the added section type is exhaustive.

---

### Task 6: 운영 문서, 통합 점검과 로컬 결과 확인

**Files:**
- Create: `docs/agent-office-harness.md`
- Modify: `scripts/agent-office/README.md`
- Modify: `docs/google-workspace-briefing.md`
- Modify: `package.json` only if a script correction is required.

- [x] **Step 1: Korean operator guide 작성**

문서에 두 CLI 명령, mock과 OAuth 실행 차이, 산출물 경로, 수동 snapshot import, 승인·보류가 로컬 overlay라는 점, 재시도 기준, snapshot 포함·제외 데이터, 로컬 파일 정리 방법을 기록한다. Google Cloud Desktop OAuth JSON을 저장소 밖에 준비하고 Windows PowerShell/WSL에서 환경변수를 설정하는 순서를 구체적으로 설명한다. 자격 증명 값이나 실제 개인 자료는 예제로 쓰지 않는다.

- [x] **Step 2: 개발자 README 보완**

기존 README의 OAuth setup과 read-only scope를 유지하면서 하네스 파일 구조, 두 job adapter, tests 명령, Phase 2 sidecar 경계를 링크한다. 신규 실행 job을 추가하는 절차를 현재 두 job에 한정해 설명한다. Google Workspace 안내에는 Windows PowerShell과 WSL의 환경변수 설정, 첫 OAuth 인증 시 토큰 파일 생성 시점을 포함한다.

- [x] **Step 3: 전체 Node 테스트 실행**

Run: `npm run office:test`

Expected: PASS; all pre-existing Google adapter tests and harness tests pass without live API calls.

- [x] **Step 4: 전체 project check와 build 실행**

Run: `npm run check`

Expected: PASS; TypeScript, Vite production build, and existing script syntax checks complete with zero errors.

- [x] **Step 5: 두 하네스 작업의 mock end-to-end 실행**

Run: `npm run office:harness -- --job daily-briefing --mock`

Run: `npm run office:harness -- --job agent-office-command --command "다음 주 의기양양 두레동아리 홍보 콘텐츠 기획해줘"`

Expected: each prints a distinct run ID and snapshot path; every run contains manifest, events, snapshot, and corresponding Markdown artifact; snapshot status is `WAITING_APPROVAL`.

- [x] **Step 6: 저장소 diff와 비밀 데이터 확인**

Run: `git status --short` and `git diff --check`.

Expected: no generated `reports/private/` data is tracked, no credential/sample personal data is added, no `.github/workflows` file or dependency lockfile churn is introduced, and pre-existing untracked user files remain untouched.

---

## Self-review

- **Spec coverage:** 두 job, 공유 AI 사무국 코어, 상태와 event log, 최대 2회 재시도, 사용자 승인 overlay, snapshot 정제·수동 import, 기존 메뉴 연동, Playwright 제외, 개인정보 경계, 운영 문서, Phase 2 확장 지점을 Task 1–6에 배치했다.
- **Placeholder scan:** 작업을 위임하거나 후속 구현으로 미루는 TBD/TODO 단계가 없다. 사용자에게 보이는 작업 이름과 npm 명령은 구체적으로 적었다.
- **Type consistency:** Node job의 snapshot `jobType`, 상태 값, TypeScript `HarnessJobType`/`HarnessStatus`를 동일하게 정의했다. AI 사무국의 기존 UI API는 facade에서 유지한다.
- **Scope note:** 테스트 도구 추가가 금지된 프로젝트 원칙에 맞춰 새 UI 테스트 라이브러리를 설치하지 않는다. import 로직을 순수 함수로 두고 Node built-in `node:test`로 검증한다.
