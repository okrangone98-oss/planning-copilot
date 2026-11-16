import { sourceRef } from "./contracts.mjs";

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
const ACTIONABLE_CATEGORIES = new Set([
  "ACTION_REQUIRED", "WAITING", "FINANCE", "APPLICATION", "CANCELLATION", "DOCUMENT", "SCHEDULE"
]);
const METADATA_HEADERS = ["Subject", "From", "Date", "List-Unsubscribe"];
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export function classifyEmail(email = {}) {
  const haystack = `${email?.subject || ""} ${email?.from || ""} ${email?.snippet || ""}`;
  if (IGNORE_RE.test(haystack)) return "IGNORE";
  for (const [category, pattern] of RULES) {
    if (pattern.test(haystack)) return category;
  }
  return "REFERENCE";
}

export function isActionableEmail(email = {}) {
  return ACTIONABLE_CATEGORIES.has(email?.category);
}

export async function readRecentEmails({ gmailApi, now = new Date(), detectedAt } = {}) {
  const messagesApi = gmailApi?.users?.messages;
  if (typeof messagesApi?.list !== "function" || typeof messagesApi?.get !== "function") return [];

  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return [];
  const response = await messagesApi.list({
    userId: "me",
    q: `after:${Math.floor((nowMs - FORTY_EIGHT_HOURS_MS) / 1000)}`
  });
  const messages = response?.data?.messages;
  if (!Array.isArray(messages)) return [];

  const emails = await Promise.all(messages
    .filter((message) => typeof message?.id === "string" && message.id)
    .map(async ({ id }) => {
      const messageResponse = await messagesApi.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: METADATA_HEADERS
      });
      return normalizeEmail(messageResponse?.data, detectedAt);
    }));

  return keepNewestByThread(emails.filter(Boolean));
}

function normalizeEmail(message, detectedAt) {
  if (!message || typeof message !== "object") return null;
  const headers = headersByName(message.payload?.headers);
  const id = typeof message.id === "string" ? message.id : "";
  if (!id) return null;
  const receivedAt = normalizedDate(headers.date);
  const email = {
    id,
    threadId: typeof message.threadId === "string" ? message.threadId : "",
    subject: headers.subject || "",
    from: headers.from || "",
    receivedAt,
    snippet: typeof message.snippet === "string" ? message.snippet : "",
    labelIds: Array.isArray(message.labelIds) ? message.labelIds : [],
    category: "REFERENCE",
    isActionable: false,
    source: sourceRef("gmail", id, `https://mail.google.com/mail/u/0/#all/${id}`, detectedAt)
  };
  email.category = classifyEmail(email);
  email.isActionable = isActionableEmail(email);
  return email;
}

function headersByName(headers) {
  if (!Array.isArray(headers)) return {};
  return headers.reduce((result, header) => {
    if (typeof header?.name === "string" && typeof header.value === "string") {
      result[header.name.toLowerCase()] = header.value;
    }
    return result;
  }, {});
}

function normalizedDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function keepNewestByThread(emails) {
  const newestByThread = new Map();
  for (const email of emails) {
    const key = email.threadId || email.id;
    const current = newestByThread.get(key);
    if (!current || email.receivedAt > current.receivedAt) newestByThread.set(key, email);
  }
  return [...newestByThread.values()].sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
}
