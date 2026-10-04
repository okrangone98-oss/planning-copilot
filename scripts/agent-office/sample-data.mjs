const detectedAt = "2026-09-24T03:00:00.000Z";
const source = (sourceType, sourceId, sourceUrl) => ({ sourceType, sourceId, sourceUrl, detectedAt });

export const sampleCalendarEvents = [{
  id: "event-today", title: "웰컴센터", start: "2026-09-24T10:00:00+09:00", end: "2026-09-24T11:00:00+09:00", allDay: false, durationMinutes: 60, projectId: "P-WELCOME", source: source("calendar", "event-today", "https://calendar.example.test/events/event-today")
}];

export const sampleEmails = [
  { id: "mail-finance", threadId: "thread-finance", subject: "웰컴센터", from: "finance@example.test", receivedAt: "2026-09-24T01:00:00.000Z", snippet: "정산 서류를 확인해 주세요.", category: "FINANCE", isActionable: true, projectId: "P-WELCOME", source: source("gmail", "mail-finance", "https://mail.example.test/mail-finance") },
  { id: "mail-newsletter", threadId: "thread-newsletter", subject: "Weekly newsletter", from: "news@example.test", receivedAt: "2026-09-24T00:00:00.000Z", snippet: "unsubscribe", category: "IGNORE", isActionable: false, source: source("gmail", "mail-newsletter", "https://mail.example.test/mail-newsletter") }
];

export const sampleProjects = [
  { name: "웰컴센터", deadline: "2026-09-27", deadlineText: "2026-09-27", statusText: "진행", projectId: "P-WELCOME", source: source("sheets", "sheet-sample", "https://sheets.example.test/sheet-sample") },
  { name: "성과공유회", deadline: "2026-10-01", deadlineText: "2026-10-01", statusText: "준비 중", projectId: "P-SHARE", source: source("sheets", "sheet-sample", "https://sheets.example.test/sheet-sample") },
  { name: "완료 사업", deadline: "2026-09-25", deadlineText: "2026-09-25", statusText: "완료", projectId: "P-DONE", source: source("sheets", "sheet-sample", "https://sheets.example.test/sheet-sample") }
];
