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
