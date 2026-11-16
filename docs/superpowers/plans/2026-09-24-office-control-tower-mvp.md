# 사무국장 업무 관제탑 Agent MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 `planning-copilot`에 OAuth 사용자 인증 기반의 읽기 전용 Google Workspace 수집기와 Daily Briefing CLI를 추가한다.

**Architecture:** Vite/React 웹앱은 유지하고, 로컬 Node 실행기 `scripts/agent-office/daily-briefing.mjs`가 OAuth 인증·Gmail/Calendar/Drive/Sheets Reader·판단·Markdown 출력을 담당한다. Google API 호출부는 AuthProvider와 Adapter로 분리하고, 날짜 계산·메일 분류·alias·Risk 판단·보고서 렌더링은 주입 가능한 순수 함수로 만들어 MockProvider와 fixture로 테스트한다.

**Tech Stack:** Node.js ESM, existing `googleapis`, existing `dotenv`, Node built-in `node:test`, existing Vite/React/TypeScript project, Markdown reports.

## Global Constraints

- Google Workspace 원본 데이터는 실행 시 조회하며 Agent 자체 DB를 원본으로 사용하지 않는다.
- 기본 인증 구현은 OAuth 사용자 인증이며, Gmail·Calendar·Drive·Sheets 모두 read-only Scope만 요청한다.
- OAuth refresh token과 Client Secret은 저장소 밖 경로에만 저장하고 코드·로그·fixture에 포함하지 않는다.
- 메일 발송, Calendar 수정, Google Drive/Sheets 수정, Jira 변경은 구현하지 않는다.
- 실제 Google Workspace 데이터 검증은 Mock 데이터 검증과 별도로 수행한다.
- 모든 업무 후보는 `sourceType`, `sourceId`, `sourceUrl`, 가능한 `projectId`, `detectedAt`를 보존한다.
- 날짜와 기간 계산은 `Asia/Seoul` 기준으로 수행한다.
- 광고·프로모션·뉴스레터는 항상 `IGNORE`로 분류한다.
- 완료·종료·`done`·`completed`·`closed` 상태는 신규 업무나 위험으로 다시 생성하지 않는다.
- 기존 `googleapis`, `dotenv`, `scripts/agent-office/`, `reports/private/` 구조를 재사용하며 새 프레임워크나 DB를 추가하지 않는다.
- 기존 사용자 변경과 별도 `AGENTS.md` 파일은 커밋 대상에서 제외한다.

---

### Task 1: 실행 설정과 AuthProvider 계약

**Files:**
- Modify: `package.json`
- Create: `scripts/agent-office/lib/config.mjs`
- Create: `scripts/agent-office/lib/auth-provider.mjs`
- Create: `scripts/agent-office/test/config.test.mjs`
- Create: `scripts/agent-office/test/auth-provider.test.mjs`

**Interfaces:**
- Produces `loadBriefingConfig(env)`, `OAuthUserProvider`, `MockProvider`, `createAuthProvider(config)`.
- `OAuthUserProvider#getAuthorizedClient()` returns an authorized Google auth client.
- `MockProvider#getAuthorizedClient()` returns the injected test client without network access.
- Config fields are `{ clientSecretPath, tokenPath, calendarId, spreadsheetId, sheetName, aliasConfigPath, timezone, outputDir }`.

- [ ] **Step 1: Write the failing configuration tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadBriefingConfig } from "../lib/config.mjs";

test("loadBriefingConfig requires OAuth secret and token paths", () => {
  assert.throws(
    () => loadBriefingConfig({}),
    /GOOGLE_OAUTH_CLIENT_SECRET_PATH.*GOOGLE_OAUTH_TOKEN_PATH/
  );
});

test("loadBriefingConfig applies safe read-only defaults", () => {
  const config = loadBriefingConfig({
    GOOGLE_OAUTH_CLIENT_SECRET_PATH: "/outside/client-secret.json",
    GOOGLE_OAUTH_TOKEN_PATH: "/outside/google-token.json"
  });

  assert.equal(config.calendarId, "primary");
  assert.equal(config.timezone, "Asia/Seoul");
  assert.equal(config.outputDir, "reports/private");
  assert.equal(config.sheetName, "");
});
```

- [ ] **Step 2: Run the configuration tests and verify the expected failure**

Run: `npm run office:test -- --test-name-pattern="loadBriefingConfig"`

Expected: FAIL because `scripts/agent-office/lib/config.mjs` does not exist.

- [ ] **Step 3: Write the failing provider contract test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../lib/auth-provider.mjs";

test("MockProvider returns its injected client without changing it", async () => {
  const client = { kind: "mock-google-client" };
  const provider = new MockProvider(client);

  assert.equal(await provider.getAuthorizedClient(), client);
});
```

- [ ] **Step 4: Run the provider test and verify the expected failure**

Run: `npm run office:test -- --test-name-pattern="MockProvider"`

Expected: FAIL because `MockProvider` is not defined.

- [ ] **Step 5: Implement configuration and provider contracts**

```js
// scripts/agent-office/lib/config.mjs
const required = (env, name) => {
  const value = env[name];
  if (!value) throw new Error(`${name} 환경 변수가 필요합니다.`);
  return value;
};

export function loadBriefingConfig(env = process.env) {
  return {
    clientSecretPath: required(env, "GOOGLE_OAUTH_CLIENT_SECRET_PATH"),
    tokenPath: required(env, "GOOGLE_OAUTH_TOKEN_PATH"),
    calendarId: env.GOOGLE_CALENDAR_ID || "primary",
    spreadsheetId: env.PROJECT_STATE_SPREADSHEET_ID || "",
    sheetName: env.PROJECT_STATE_SHEET_NAME || "",
    aliasConfigPath: env.PROJECT_ALIAS_CONFIG_PATH || "automation/project-aliases.example.json",
    timezone: "Asia/Seoul",
    outputDir: env.OFFICE_BRIEFING_OUTPUT_DIR || "reports/private"
  };
}
```

```js
// scripts/agent-office/lib/auth-provider.mjs
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";

export const READ_ONLY_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly"
];

export class MockProvider {
  constructor(client) { this.client = client; }
  async getAuthorizedClient() { return this.client; }
}

export class OAuthUserProvider {
  constructor({ clientSecretPath, tokenPath, scopes = READ_ONLY_SCOPES, port = 0 }) {
    this.clientSecretPath = clientSecretPath;
    this.tokenPath = tokenPath;
    this.scopes = scopes;
    this.port = port;
  }

  async getAuthorizedClient() {
    const credentials = JSON.parse(await fs.readFile(this.clientSecretPath, "utf8"));
    const installed = credentials.installed || credentials.web;
    if (!installed) throw new Error("OAuth Client Secret JSON에 installed 또는 web 설정이 없습니다.");
    const redirect = `http://127.0.0.1:${this.port || 0}/oauth2callback`;
    const oauth2 = new google.auth.OAuth2(installed.client_id, installed.client_secret, redirect);
    try {
      oauth2.setCredentials(JSON.parse(await fs.readFile(this.tokenPath, "utf8")));
      return oauth2;
    } catch {
      return authorizeWithLoopback({
        installed,
        scopes: this.scopes,
        tokenPath: this.tokenPath
      });
    }
  }
}

export function createAuthProvider(config, mode = "oauth") {
  if (mode === "mock") return new MockProvider({ kind: "mock-client" });
  if (mode !== "oauth") throw new Error(`지원하지 않는 auth mode: ${mode}`);
  return new OAuthUserProvider({
    clientSecretPath: config.clientSecretPath,
    tokenPath: config.tokenPath,
    scopes: READ_ONLY_SCOPES
  });
}
```

Complete the loopback consent flow in the same module. The implementation must read an existing token first, otherwise bind an HTTP server to `127.0.0.1` on an ephemeral port, create the OAuth client with the bound port, print the authorization URL, exchange the callback code, write the returned tokens with mode `0600`, close the server, and return the authorized client.

```js
async function authorizeWithLoopback({ installed, scopes, tokenPath }) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const redirect = `http://127.0.0.1:${port}/oauth2callback`;
  const oauth2 = new google.auth.OAuth2(installed.client_id, installed.client_secret, redirect);
  const authorizationUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes
  });
  console.error(`Google OAuth 승인 URL: ${authorizationUrl}`);
  const code = await new Promise((resolve, reject) => {
    server.on("request", (request, response) => {
      const callbackUrl = new URL(request.url, redirect);
      if (callbackUrl.pathname !== "/oauth2callback") return;
      const error = callbackUrl.searchParams.get("error");
      const callbackCode = callbackUrl.searchParams.get("code");
      response.end(error ? "OAuth 승인이 취소되었습니다." : "OAuth 승인이 완료되었습니다. 터미널로 돌아가세요.");
      server.close();
      if (error) reject(new Error(`OAuth 승인 실패: ${error}`));
      else if (!callbackCode) reject(new Error("OAuth callback에 code가 없습니다."));
      else resolve(callbackCode);
    });
  });
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  await fs.mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  return oauth2;
}
```

`getAuthorizedClient()` must call this helper when the token file is missing, and must never print token values.

- [ ] **Step 6: Run focused tests and verify they pass**

Run: `npm run office:test -- --test-name-pattern="loadBriefingConfig|MockProvider"`

Expected: PASS with 3 tests and no network calls.

- [ ] **Step 7: Add the test script without changing the existing build contract**

Modify `package.json` scripts:

```json
{
  "office:test": "node --test scripts/agent-office/test/*.test.mjs",
  "office:briefing": "node scripts/agent-office/daily-briefing.mjs"
}
```

- [ ] **Step 8: Commit the authentication foundation**

```bash
git add package.json scripts/agent-office/lib/config.mjs scripts/agent-office/lib/auth-provider.mjs scripts/agent-office/test/config.test.mjs scripts/agent-office/test/auth-provider.test.mjs
git commit -m "feat: add read-only workspace auth foundation"
```

### Task 2: Shared source contracts and deterministic time windows

**Files:**
- Create: `scripts/agent-office/lib/contracts.mjs`
- Create: `scripts/agent-office/lib/time-windows.mjs`
- Create: `scripts/agent-office/test/time-windows.test.mjs`

**Interfaces:**
- Produces `SOURCE_TYPES`, `EMAIL_CATEGORIES`, `PROJECT_STATUSES`, `getTimeWindows(now, timezone)`, `sourceRef(...)`.
- `getTimeWindows` returns `{ now, todayStart, tomorrowStart, sevenDayEnd, thirtyDayEnd, weekEnd }` as `Date` values plus local date labels.
- All date-window APIs accept an injected `now` so boundary tests do not use the machine clock.

- [ ] **Step 1: Write failing date boundary tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { getTimeWindows } from "../lib/time-windows.mjs";

test("getTimeWindows uses Asia/Seoul midnight for today and future windows", () => {
  const windows = getTimeWindows(new Date("2026-09-24T00:30:00+09:00"), "Asia/Seoul");

  assert.equal(windows.todayStart.toISOString(), "2026-09-23T15:00:00.000Z");
  assert.equal(windows.tomorrowStart.toISOString(), "2026-09-24T15:00:00.000Z");
  assert.equal(windows.sevenDayEnd.toISOString(), "2026-09-30T15:00:00.000Z");
  assert.equal(windows.thirtyDayEnd.toISOString(), "2026-10-23T15:00:00.000Z");
});

test("getTimeWindows returns a week boundary that excludes next week", () => {
  const windows = getTimeWindows(new Date("2026-09-24T12:00:00+09:00"), "Asia/Seoul");
  assert.equal(windows.weekEnd.toISOString(), "2026-09-28T15:00:00.000Z");
});
```

- [ ] **Step 2: Run the date tests and verify the expected failure**

Run: `npm run office:test -- --test-name-pattern="getTimeWindows"`

Expected: FAIL because the time-window module is missing.

- [ ] **Step 3: Implement contracts and KST date arithmetic**

```js
// scripts/agent-office/lib/contracts.mjs
export const SOURCE_TYPES = Object.freeze(["gmail", "calendar", "drive", "sheets"]);
export const EMAIL_CATEGORIES = Object.freeze([
  "ACTION_REQUIRED", "WAITING", "FINANCE", "APPLICATION", "CANCELLATION",
  "DOCUMENT", "SCHEDULE", "REFERENCE", "IGNORE"
]);
export const PROJECT_STATUSES = Object.freeze(["NORMAL", "WARNING", "RISK"]);

export function sourceRef(sourceType, sourceId, sourceUrl, detectedAt, projectId) {
  return { sourceType, sourceId, sourceUrl, ...(projectId ? { projectId } : {}), detectedAt };
}
```

```js
// scripts/agent-office/lib/time-windows.mjs
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function kstDateKey(date) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function kstMidnight(dateKey) {
  return new Date(`${dateKey}T00:00:00+09:00`);
}

function addDays(dateKey, days) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS)
    .toISOString().slice(0, 10);
}

export function getTimeWindows(now = new Date(), timezone = "Asia/Seoul") {
  if (timezone !== "Asia/Seoul") throw new Error(`지원하지 않는 timezone: ${timezone}`);
  const todayKey = kstDateKey(now);
  const tomorrowKey = addDays(todayKey, 1);
  const weekday = new Date(`${todayKey}T00:00:00Z`).getUTCDay();
  const daysUntilNextMonday = weekday === 0 ? 1 : 8 - weekday;
  return {
    now,
    timezone,
    todayKey,
    todayStart: kstMidnight(todayKey),
    tomorrowStart: kstMidnight(tomorrowKey),
    sevenDayEnd: kstMidnight(addDays(todayKey, 7)),
    thirtyDayEnd: kstMidnight(addDays(todayKey, 30)),
    weekEnd: kstMidnight(addDays(todayKey, daysUntilNextMonday))
  };
}
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm run office:test -- --test-name-pattern="getTimeWindows"`

Expected: PASS with both boundary tests.

- [ ] **Step 5: Commit the shared contracts**

```bash
git add scripts/agent-office/lib/contracts.mjs scripts/agent-office/lib/time-windows.mjs scripts/agent-office/test/time-windows.test.mjs
git commit -m "feat: add briefing source contracts and time windows"
```

### Task 3: Calendar Reader and major-event selection

**Files:**
- Create: `scripts/agent-office/lib/calendar-adapter.mjs`
- Create: `scripts/agent-office/test/calendar-adapter.test.mjs`

**Interfaces:**
- Produces `readCalendarEvents({ calendarApi, calendarId, now, timezone, detectedAt })`.
- Produces `selectMajorEvents(events, keywords)`.
- The adapter accepts an injected `calendarApi`; tests never call Google.
- Normalized event fields are `{ id, title, start, end, allDay, attendeeCount, htmlLink, projectId?, source }`.

- [ ] **Step 1: Write failing Calendar tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readCalendarEvents, selectMajorEvents } from "../lib/calendar-adapter.mjs";

test("readCalendarEvents requests the 30-day source window and preserves source metadata", async () => {
  const calls = [];
  const calendarApi = {
    events: { list: async (params) => {
      calls.push(params);
      return { data: { items: [
        { id: "evt-1", summary: "성과공유회", start: { date: "2026-09-25" }, end: { date: "2026-09-26" }, htmlLink: "https://calendar.google.com/event/evt-1" }
      ] } };
    } }
  };

  const events = await readCalendarEvents({
    calendarApi,
    calendarId: "primary",
    now: new Date("2026-09-24T12:00:00+09:00"),
    timezone: "Asia/Seoul",
    detectedAt: "2026-09-24T03:00:00.000Z"
  });

  assert.equal(calls[0].calendarId, "primary");
  assert.equal(calls[0].singleEvents, true);
  assert.equal(events[0].source.sourceType, "calendar");
  assert.equal(events[0].source.sourceId, "evt-1");
});

test("selectMajorEvents includes all-day and keyword events but removes duplicate ids", () => {
  const events = [
    { id: "all-day", title: "내부 점검", allDay: true, durationMinutes: 60 },
    { id: "keyword", title: "성과공유회", allDay: false, durationMinutes: 60 },
    { id: "keyword", title: "성과공유회", allDay: false, durationMinutes: 60 },
    { id: "short", title: "일반 일정", allDay: false, durationMinutes: 30 }
  ];
  assert.deepEqual(selectMajorEvents(events, ["성과공유회"]).map((event) => event.id), ["all-day", "keyword"]);
});
```

- [ ] **Step 2: Run the Calendar tests and verify the expected failure**

Run: `npm run office:test -- --test-name-pattern="readCalendarEvents|selectMajorEvents"`

Expected: FAIL because the Calendar adapter is missing.

- [ ] **Step 3: Implement the adapter with a bounded read-only source-window call**

```js
export async function readCalendarEvents({ calendarApi, calendarId, now, timezone, detectedAt }) {
  const windows = getTimeWindows(now, timezone);
  const response = await calendarApi.events.list({
    calendarId,
    timeMin: windows.todayStart.toISOString(),
    timeMax: windows.thirtyDayEnd.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500
  });
  return (response.data.items || []).map((event) => normalizeCalendarEvent(event, detectedAt));
}

function normalizeCalendarEvent(event, detectedAt) {
  const startValue = event.start?.dateTime || event.start?.date || "";
  const endValue = event.end?.dateTime || event.end?.date || startValue;
  const allDay = Boolean(event.start?.date);
  const durationMinutes = Math.max(0, (Date.parse(endValue) - Date.parse(startValue)) / 60000 || 0);
  return {
    id: event.id,
    title: event.summary || "제목 없는 일정",
    start: startValue,
    end: endValue,
    allDay,
    durationMinutes,
    attendeeCount: (event.attendees || []).length,
    htmlLink: event.htmlLink || `https://calendar.google.com/calendar/u/0/r/eventedit/${event.id}`,
    source: sourceRef("calendar", event.id, event.htmlLink || "", detectedAt)
  };
}
```

The implementation must deduplicate by event ID and use `all-day || durationMinutes >= 120 || titleIncludesKeyword` for major-event selection. The default keyword list is `행사, 설명회, 축제, 교육, 성과공유회, 포럼, 워크숍, 간담회, 발표`.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm run office:test -- --test-name-pattern="readCalendarEvents|selectMajorEvents"`

Expected: PASS with no network access.

- [ ] **Step 5: Commit the Calendar reader**

```bash
git add scripts/agent-office/lib/calendar-adapter.mjs scripts/agent-office/test/calendar-adapter.test.mjs
git commit -m "feat: add read-only calendar adapter"
```

### Task 4: Gmail Reader, classification, and actionable candidates

**Files:**
- Create: `scripts/agent-office/lib/gmail-adapter.mjs`
- Create: `scripts/agent-office/test/gmail-adapter.test.mjs`

**Interfaces:**
- Produces `readRecentEmails({ gmailApi, now, detectedAt })`.
- Produces `classifyEmail(email)` and `isActionableEmail(email)`.
- Normalized email fields are `{ id, threadId, subject, from, receivedAt, snippet, labelIds, category, isActionable, source }`.

- [ ] **Step 1: Write failing classification tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { classifyEmail, isActionableEmail, readRecentEmails } from "../lib/gmail-adapter.mjs";

test("newsletter and promotion emails are always IGNORE", () => {
  assert.equal(classifyEmail({ subject: "이번 주 할인 프로모션", from: "newsletter@example.com", snippet: "unsubscribe" }), "IGNORE");
  assert.equal(classifyEmail({ subject: "새로운 소식입니다", from: "no-reply@example.com", snippet: "뉴스레터" }), "IGNORE");
});

test("reply and finance signals produce actionable categories", () => {
  assert.equal(classifyEmail({ subject: "견적서 확인 및 회신 요청", from: "partner@example.com", snippet: "내일까지 확인 부탁드립니다" }), "FINANCE");
  assert.equal(isActionableEmail({ category: "FINANCE" }), true);
  assert.equal(isActionableEmail({ category: "REFERENCE" }), false);
});

test("readRecentEmails uses the 48-hour Gmail query and normalizes headers", async () => {
  const calls = [];
  const gmailApi = {
    users: { messages: {
      list: async (params) => { calls.push(params); return { data: { messages: [{ id: "msg-1" }] } }; },
      get: async () => ({ data: { id: "msg-1", threadId: "thread-1", snippet: "확인 부탁드립니다", labelIds: ["INBOX"], payload: { headers: [
        { name: "Subject", value: "자료 확인 요청" },
        { name: "From", value: "partner@example.com" },
        { name: "Date", value: "Thu, 24 Sep 2026 10:00:00 +0900" }
      ] } } })
    } }
  };
  const emails = await readRecentEmails({ gmailApi, now: new Date("2026-09-24T12:00:00+09:00"), detectedAt: "2026-09-24T03:00:00.000Z" });
  assert.match(calls[0].q, /after:/);
  assert.equal(emails[0].subject, "자료 확인 요청");
  assert.equal(emails[0].source.sourceId, "msg-1");
});
```

- [ ] **Step 2: Run the Gmail tests and verify the expected failure**

Run: `npm run office:test -- --test-name-pattern="newsletter|reply and finance|readRecentEmails"`

Expected: FAIL because the Gmail adapter is missing.

- [ ] **Step 3: Implement header parsing, classification, and read-only message retrieval**

```js
const IGNORE_RE = /광고|프로모션|뉴스레터|newsletter|unsubscribe|수신거부|no[- ]?reply/i;
const RULES = [
  ["FINANCE", /비용|견적|세금계산서|입금|예산|정산/i],
  ["APPLICATION", /지원|신청|접수|공모/i],
  ["CANCELLATION", /취소|불참|변경/i],
  ["DOCUMENT", /파일|첨부|자료|제출|문서/i],
  ["SCHEDULE", /일정|회의|행사|시간|캘린더/i],
  ["WAITING", /대기|회신 대기|답변 대기|확인 대기/i],
  ["ACTION_REQUIRED", /회신|확인|검토|요청|답변|부탁/i]

];

export function classifyEmail(email) {
  const haystack = `${email.subject || ""} ${email.from || ""} ${email.snippet || ""}`;
  if (IGNORE_RE.test(haystack)) return "IGNORE";
  for (const [category, pattern] of RULES) if (pattern.test(haystack)) return category;
  return "REFERENCE";
}

export function isActionableEmail(email) {
  return new Set(["ACTION_REQUIRED", "WAITING", "FINANCE", "APPLICATION", "CANCELLATION", "DOCUMENT", "SCHEDULE"]).has(email.category);
}
```

`readRecentEmails` must call `users.messages.list` with `q: after:<unix-seconds>` for the injected `now - 48 hours`, fetch each message with `format: "metadata"`, request only `Subject`, `From`, `Date`, and `List-Unsubscribe` headers, and never call `modify`, `send`, or `trash`.

- [ ] **Step 4: Add thread-level deduplication and verify it**

Add this failing test before the implementation change:

```js
test("readRecentEmails keeps the newest message for a duplicate thread", async () => {
  const gmailApi = {
    users: { messages: {
      list: async () => ({ data: { messages: [{ id: "old" }, { id: "new" }] } }),
      get: async ({ id }) => ({ data: {
        id,
        threadId: "thread-1",
        snippet: id === "old" ? "오래된 요청" : "최신 요청",
        payload: { headers: [
          { name: "Subject", value: "자료 확인 요청" },
          { name: "From", value: "partner@example.com" },
          { name: "Date", value: id === "old" ? "Thu, 24 Sep 2026 09:00:00 +0900" : "Thu, 24 Sep 2026 10:00:00 +0900" }
        ] }
      } })
    } }
  };
  const emails = await readRecentEmails({
    gmailApi,
    now: new Date("2026-09-24T12:00:00+09:00"),
    detectedAt: "2026-09-24T03:00:00.000Z"
  });
  assert.equal(emails.length, 1);
  assert.equal(emails[0].id, "new");
});
```

Run: `npm run office:test -- --test-name-pattern="duplicate thread"`

Expected: FAIL until the adapter groups by `threadId` and sorts by `receivedAt` descending.

Implement the grouping, run the focused test again, and expect PASS.

- [ ] **Step 5: Commit the Gmail reader**

```bash
git add scripts/agent-office/lib/gmail-adapter.mjs scripts/agent-office/test/gmail-adapter.test.mjs
git commit -m "feat: add read-only gmail classification"
```

### Task 5: Drive/Sheets project state and alias resolution

**Files:**
- Create: `automation/project-aliases.example.json`
- Create: `scripts/agent-office/lib/project-aliases.mjs`
- Create: `scripts/agent-office/lib/drive-sheets-adapter.mjs`
- Create: `scripts/agent-office/test/project-aliases.test.mjs`
- Create: `scripts/agent-office/test/drive-sheets-adapter.test.mjs`

**Interfaces:**
- Produces `loadAliases(path)`, `resolveProjectId(text, aliases)`, `attachProjectId(value, aliases)`.
- Produces `readProjectState({ driveApi, sheetsApi, spreadsheetId, spreadsheetTitle, sheetName, detectedAt })`.
- Normalized project row fields are `{ name, deadlineText, deadline, statusText, projectId?, source }`.

- [ ] **Step 1: Add the committed alias example**

```json
{
  "P-WELCOME-2026": ["웰컴센터", "양양읍 웰컴센터", "웰컴문화", "KAN-49"],
  "P-SHARE-2026": ["성과공유회", "모두의 동아리존", "KAN-51"]
}
```

- [ ] **Step 2: Write failing alias tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { resolveProjectId } from "../lib/project-aliases.mjs";

const aliases = {
  "P-WELCOME-2026": ["웰컴센터", "양양읍 웰컴센터", "KAN-49"],
  "P-SHARE-2026": ["성과공유회", "모두의 동아리존", "KAN-51"]
};

test("resolveProjectId matches normalized aliases and prefers the longest alias", () => {
  assert.equal(resolveProjectId("양양읍 웰컴센터 제작물 확인", aliases), "P-WELCOME-2026");
  assert.equal(resolveProjectId("KAN-51 성과공유회", aliases), "P-SHARE-2026");
  assert.equal(resolveProjectId("관련 없는 제목", aliases), undefined);
});
```

- [ ] **Step 3: Run the alias tests and verify the expected failure**

Run: `npm run office:test -- --test-name-pattern="resolveProjectId"`

Expected: FAIL because the alias resolver is missing.

- [ ] **Step 4: Implement normalization and alias matching**

```js
export function normalizeIdentityText(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-_/.]+/g, "")
    .trim();
}

export function resolveProjectId(value, aliases) {
  const normalized = normalizeIdentityText(value);
  const matches = [];
  for (const [projectId, projectAliases] of Object.entries(aliases)) {
    for (const alias of projectAliases) {
      const normalizedAlias = normalizeIdentityText(alias);
      if (normalizedAlias && normalized.includes(normalizedAlias)) matches.push({ projectId, length: normalizedAlias.length });
    }
  }
  return matches.sort((left, right) => right.length - left.length || left.projectId.localeCompare(right.projectId))[0]?.projectId;
}
```

- [ ] **Step 5: Write failing Drive/Sheets read tests**

```js
import test from "node:test";
import assert from "node:assert/strict";

test("readProjectState finds the configured spreadsheet and maps Korean headers", async () => {
  const driveApi = { files: { list: async () => ({ data: { files: [{ id: "sheet-1", name: "26 양터 전체사업 총괄표", webViewLink: "https://docs.google.com/spreadsheets/d/sheet-1/edit" }] } }) } };
  const sheetsApi = {
    spreadsheets: {
      get: async () => ({ data: { sheets: [{ properties: { title: "전체사업" } }] } }),
      values: { get: async () => ({ data: { values: [
        ["사업명", "일정", "상태"],
        ["웰컴센터", "2026-10-09", "준비 중"]
      ] } }) }
    }
  };
  const projects = await readProjectState({ driveApi, sheetsApi, spreadsheetTitle: "26 양터 전체사업 총괄표", detectedAt: "2026-09-24T03:00:00.000Z" });
  assert.equal(projects[0].name, "웰컴센터");
  assert.equal(projects[0].deadline, "2026-10-09");
  assert.equal(projects[0].source.sourceType, "sheets");
});
```

- [ ] **Step 6: Run the Sheets test and verify the expected failure**

Run: `npm run office:test -- --test-name-pattern="readProjectState"`

Expected: FAIL because the Drive/Sheets adapter is missing.

- [ ] **Step 7: Implement read-only spreadsheet selection and row mapping**

The implementation must:

1. Use `spreadsheetId` when configured.
2. Otherwise call Drive `files.list` with `name = '26 양터 전체사업 총괄표'`, spreadsheet MIME type, and `trashed = false`.
3. Call Sheets `spreadsheets.get` to select `sheetName` or the first sheet.
4. Call `spreadsheets.values.get` only, with a bounded range such as `'<sheet title>'!A:ZZ`.
5. Map header variants for 사업명·일정·상태 and preserve the spreadsheet URL.
6. Never call `batchUpdate`, `values.update`, `permissions.create`, or any Drive write method.

- [ ] **Step 8: Run focused tests and verify they pass**

Run: `npm run office:test -- --test-name-pattern="resolveProjectId|readProjectState"`

Expected: PASS with no network access.

- [ ] **Step 9: Commit project identity and state reading**

```bash
git add automation/project-aliases.example.json scripts/agent-office/lib/project-aliases.mjs scripts/agent-office/lib/drive-sheets-adapter.mjs scripts/agent-office/test/project-aliases.test.mjs scripts/agent-office/test/drive-sheets-adapter.test.mjs
git commit -m "feat: add project state and alias readers"
```

### Task 6: Priority, Risk, deduplication, and Daily Briefing rendering

**Files:**
- Create: `scripts/agent-office/lib/briefing-logic.mjs`
- Create: `scripts/agent-office/lib/briefing-renderer.mjs`
- Create: `scripts/agent-office/test/briefing-logic.test.mjs`
- Create: `scripts/agent-office/test/briefing-renderer.test.mjs`

**Interfaces:**
- Produces `isCompletedStatus(status)`, `dedupeCandidates(candidates)`, `computeProjectStatus(project, context)`, `buildDailyBriefing(input)`.
- Produces `renderDailyBriefing(briefing)`.
- `buildDailyBriefing` returns `{ generatedAt, dataAsOf, coreTasks, todayEvents, weekDeadlines, actionableEmails, warningProjects, majorEvents, collectionSummary, limitations }`.

- [ ] **Step 1: Write failing Risk and completion tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { computeProjectStatus, isCompletedStatus, dedupeCandidates } from "../lib/briefing-logic.mjs";

test("completed projects never become new risk items", () => {
  assert.equal(isCompletedStatus("완료"), true);
  assert.equal(computeProjectStatus({ statusText: "완료", deadline: "2026-09-25" }, { today: "2026-09-24" }), "NORMAL");
});

test("D-3 incomplete work is RISK and D-7 incomplete work is WARNING", () => {
  assert.equal(computeProjectStatus({ statusText: "준비 중", deadline: "2026-09-27" }, { today: "2026-09-24" }), "RISK");
  assert.equal(computeProjectStatus({ statusText: "준비 중", deadline: "2026-10-01" }, { today: "2026-09-24" }), "WARNING");
});

test("dedupeCandidates merges repeated source candidates without losing sources", () => {
  const candidates = [
    { key: "P-WELCOME-2026|자료 확인", sources: [{ sourceId: "mail-1" }] },
    { key: "P-WELCOME-2026|자료 확인", sources: [{ sourceId: "sheet-1" }] }
  ];
  const result = dedupeCandidates(candidates);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sources.map((source) => source.sourceId), ["mail-1", "sheet-1"]);
});
```

- [ ] **Step 2: Run the logic tests and verify the expected failure**

Run: `npm run office:test -- --test-name-pattern="completed projects|D-3|dedupeCandidates"`

Expected: FAIL because the briefing logic module is missing.

- [ ] **Step 3: Implement the deterministic judgment functions**

```js
const COMPLETED = /^(완료|완료함|종료|done|completed|closed)$/i;

export function isCompletedStatus(status = "") {
  return COMPLETED.test(String(status).trim());
}

export function computeProjectStatus(project, { today, linkedEmails = [], linkedEvents = [] }) {
  if (isCompletedStatus(project.statusText)) return "NORMAL";
  const days = project.deadline ? Math.ceil((Date.parse(`${project.deadline}T00:00:00+09:00`) - Date.parse(`${today}T00:00:00+09:00`)) / 86400000) : Infinity;
  const text = `${project.statusText || ""} ${project.name || ""}`;
  const risk = days <= 3 || /승인.*(미확보|필요)|필수.*(누락|없음)|일정.*충돌/i.test(text) || linkedEvents.length > 1 && hasOverlap(linkedEvents);
  const warning = days <= 7 || linkedEmails.some((email) => ["ACTION_REQUIRED", "WAITING"].includes(email.category)) || /미확인|미완료|준비.*필요|대기/i.test(text);
  return risk ? "RISK" : warning ? "WARNING" : "NORMAL";
}

function hasOverlap(events) {
  const sorted = [...events].sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
  return sorted.some((event, index) => index > 0 && Date.parse(event.start) < Date.parse(sorted[index - 1].end));
}
```

Implement `dedupeCandidates` with a `Map` keyed by the normalized candidate key, preserving all unique `SourceRef` values. Sort core tasks by Risk, deadline proximity, actionable email category, event relation, and stable project/source tie breakers.

- [ ] **Step 4: Run focused logic tests and verify they pass**

Run: `npm run office:test -- --test-name-pattern="completed projects|D-3|dedupeCandidates"`

Expected: PASS with all three behavior tests.

- [ ] **Step 5: Write failing Markdown renderer tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { renderDailyBriefing } from "../lib/briefing-renderer.mjs";

test("renderDailyBriefing contains every required Korean section and source URL", () => {
  const markdown = renderDailyBriefing({
    generatedAt: "2026-09-24T03:00:00.000Z",
    dataAsOf: "2026-09-24T03:00:00.000Z",
    coreTasks: [{ title: "자료 확인", projectId: "P-WELCOME-2026", sources: [{ sourceUrl: "https://example.test/source" }] }],
    todayEvents: [], weekDeadlines: [], actionableEmails: [], warningProjects: [], majorEvents: [],
    collectionSummary: { calendar: 1, gmail: 2, sheets: 1 }, limitations: []
  });

  for (const heading of ["오늘의 핵심 업무 3건", "오늘 일정", "이번 주 마감업무", "회신/확인 필요한 이메일", "주의 사업", "향후 30일 주요 행사"]) {
    assert.match(markdown, new RegExp(`## ${heading}`));
  }
  assert.match(markdown, /https:\/\/example\.test\/source/);
});
```

- [ ] **Step 6: Run the renderer test and verify the expected failure**

Run: `npm run office:test -- --test-name-pattern="renderDailyBriefing"`

Expected: FAIL because the renderer is missing.

- [ ] **Step 7: Implement briefing assembly and Markdown output**

The renderer must emit these sections in order:

```markdown
# 오늘 업무 브리핑
## 오늘의 핵심 업무 3건
## 오늘 일정
## 이번 주 마감업무
## 회신/확인 필요한 이메일
## 주의 사업
## 향후 30일 주요 행사
## 데이터 수집 요약
## 확인 필요 및 한계
```

Every listed item must include its project ID when known and a Markdown source link when available. Do not emit full email bodies; use subject, sender, received time, category, and a bounded snippet.

- [ ] **Step 8: Run all judgment and rendering tests**

Run: `npm run office:test`

Expected: PASS for all tests created through Task 6.

- [ ] **Step 9: Commit the judgment and report layer**

```bash
git add scripts/agent-office/lib/briefing-logic.mjs scripts/agent-office/lib/briefing-renderer.mjs scripts/agent-office/test/briefing-logic.test.mjs scripts/agent-office/test/briefing-renderer.test.mjs
git commit -m "feat: add daily briefing judgment and rendering"
```

### Task 7: Live orchestration CLI, sample mode, and setup documentation

**Files:**
- Create: `scripts/agent-office/daily-briefing.mjs`
- Create: `scripts/agent-office/sample-data.mjs`
- Create: `scripts/agent-office/test/daily-briefing.test.mjs`
- Modify: `scripts/agent-office/README.md`
- Create: `docs/google-workspace-briefing.md`
- Modify: `automation/office.config.example.json`

**Interfaces:**
- `npm run office:briefing` performs live OAuth reads by default and writes one Markdown report.
- `npm run office:briefing -- --mock` uses only fixture data for development tests.
- `runBriefing({ provider, config, now, googleClientFactory })` returns the normalized briefing and output path.
- The CLI logs counts and output path only; it does not print message bodies or token contents.

- [ ] **Step 1: Write a failing orchestration test using injected adapters**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { runBriefing } from "../daily-briefing.mjs";

test("runBriefing composes readers and writes one report without external writes", async () => {
  const result = await runBriefing({
    mode: "mock",
    config: { outputDir: "/tmp/office-control-tower-test", aliasConfigPath: "automation/project-aliases.example.json", timezone: "Asia/Seoul" },
    now: new Date("2026-09-24T12:00:00+09:00"),
    adapters: {
      calendar: async () => [],
      gmail: async () => [],
      projects: async () => []
    }
  });

  assert.match(result.outputPath, /daily-briefing\.md$/);
  assert.equal(result.briefing.collectionSummary.gmail, 0);
});
```

- [ ] **Step 2: Run the orchestration test and verify the expected failure**

Run: `npm run office:test -- --test-name-pattern="runBriefing"`

Expected: FAIL because the CLI module is missing.

- [ ] **Step 3: Implement the orchestration boundary**

The implementation must follow this sequence:

1. Parse `--mock` from `process.argv`.
2. Load `loadBriefingConfig()` for live mode; allow injected config in tests.
3. Create `OAuthUserProvider` for live mode or `MockProvider` for mock mode.
4. Build `google.calendar`, `google.gmail`, `google.drive`, and `google.sheets` clients from the authorized client.
5. Call the Calendar, Gmail, and Drive/Sheets adapters in read-only mode.
6. Load aliases and call `buildDailyBriefing`.
7. Create `reports/private` or configured output directory and write exactly one Markdown file named with the local KST date.
8. Return `{ briefing, outputPath }` and log only collection counts, output path, and errors.

```js
export async function runBriefing({ mode = "oauth", config, now = new Date(), adapters, provider } = {}) {
  const resolvedConfig = config || loadBriefingConfig();
  const liveProvider = provider || createAuthProvider(resolvedConfig, mode);
  const client = await liveProvider.getAuthorizedClient();
  const resolvedAdapters = adapters || createGoogleAdapters(client, resolvedConfig);
  const detectedAt = now.toISOString();
  const [calendarEvents, emails, projects] = await Promise.all([
    resolvedAdapters.calendar({ now, detectedAt }),
    resolvedAdapters.gmail({ now, detectedAt }),
    resolvedAdapters.projects({ detectedAt })
  ]);
  const briefing = buildDailyBriefing({ now, calendarEvents, emails, projects, detectedAt, timezone: resolvedConfig.timezone });
  const outputPath = await writeBriefing(resolvedConfig.outputDir, briefing, now, resolvedConfig.timezone);
  return { briefing, outputPath };
}
```

- [ ] **Step 4: Add deterministic fixture mode**

Create `sample-data.mjs` exporting `sampleCalendarEvents`, `sampleEmails`, and `sampleProjects` with:

- one today event;
- one D-3 incomplete project;
- one D-7 warning project;
- one completed project;
- one actionable finance email;
- one newsletter that must be `IGNORE`;
- one duplicate cross-source task.

The fixture must contain fake IDs and `example.test` links only.

- [ ] **Step 5: Add setup documentation and config examples**

`docs/google-workspace-briefing.md` must document:

1. Enabling Gmail API, Calendar API, Drive API, and Sheets API.
2. Creating a Desktop OAuth client in Google Cloud.
3. Setting `GOOGLE_OAUTH_CLIENT_SECRET_PATH` and `GOOGLE_OAUTH_TOKEN_PATH` outside the repo.
4. Running `npm run office:briefing` and completing the browser approval.
5. Setting `PROJECT_STATE_SPREADSHEET_ID` or using the exact title fallback.
6. Setting `PROJECT_ALIAS_CONFIG_PATH` when aliases differ from the example.
7. Confirming that no Write Scope is requested.
8. Inspecting `reports/private/YYYY-MM-DD-daily-briefing.md`.

Update `scripts/agent-office/README.md` with the same safety boundary and add the example source configuration to `automation/office.config.example.json` without real IDs or secrets.

- [ ] **Step 6: Run mock end-to-end tests**

Run: `npm run office:test`

Expected: PASS, including orchestration and report-file tests. Confirm the generated fixture report contains all required sections and no real personal data.

- [ ] **Step 7: Commit the CLI and documentation**

```bash
git add scripts/agent-office/daily-briefing.mjs scripts/agent-office/sample-data.mjs scripts/agent-office/test/daily-briefing.test.mjs scripts/agent-office/README.md docs/google-workspace-briefing.md automation/office.config.example.json
git commit -m "feat: add daily briefing runner"
```

### Task 8: Verification, live OAuth validation, and safety audit

**Files:**
- Modify only if verification finds a defect: files from Tasks 1-7
- Do not add credentials, tokens, personal email content, or live spreadsheet exports to the repository

**Interfaces:**
- Verification command: `npm run office:test`
- Existing project command: `npm run check`
- Live command: `npm run office:briefing`

- [ ] **Step 1: Run the full offline test suite**

Run: `npm run office:test`

Expected: exit code 0 and all tests passing.

- [ ] **Step 2: Run the existing project verification**

Run: `npm run check`

Expected: TypeScript check, Vite build, existing Google Sheets script syntax check, and all configured checks pass without changing unrelated files.

- [ ] **Step 3: Run the live OAuth validation**

With credentials outside the repo:

```bash
GOOGLE_OAUTH_CLIENT_SECRET_PATH="/outside/google-client-secret.json" \
GOOGLE_OAUTH_TOKEN_PATH="/outside/google-token.json" \
PROJECT_ALIAS_CONFIG_PATH="automation/project-aliases.example.json" \
npm run office:briefing
```

Expected:

- browser consent requests only the four read-only scopes;
- Gmail data from the last 48 hours is read;
- Calendar today, 7-day, and 30-day windows are read;
- `26 양터 전체사업 총괄표` is found and read;
- one `reports/private/YYYY-MM-DD-daily-briefing.md` file is produced;
- no Gmail send, Calendar update, Sheets update, Drive write, or Jira call occurs.

- [ ] **Step 4: Inspect the generated report without exposing sensitive content**

Run:

```bash
sed -n '1,240p' reports/private/YYYY-MM-DD-daily-briefing.md
```

Verify the required sections, project IDs, source URLs, classification labels, and generated date. Do not copy personal message bodies or credentials into logs, commits, or the final response.

- [ ] **Step 5: Perform the final requirement checklist**

Confirm each item:

- actual Calendar data was read;
- actual Gmail work mail and newsletter were distinguished;
- duplicate tasks were merged;
- aliases resolved to the correct project IDs;
- KST date windows were correct;
- completed work was not surfaced as new work;
- original Google Workspace data remained unchanged;
- Jira and all write operations remain outside MVP scope;
- remaining limitations are documented.

- [ ] **Step 6: Commit only verified fixes**

```bash
git status --short
git diff --check
git add package.json automation/office.config.example.json automation/project-aliases.example.json docs/google-workspace-briefing.md docs/superpowers/specs/2026-09-23-office-control-tower-mvp-design.md docs/superpowers/plans/2026-09-24-office-control-tower-mvp.md scripts/agent-office
git commit -m "fix: address office control tower validation findings"
```

Do not commit credentials, reports containing personal data, generated token files, or unrelated user changes.
