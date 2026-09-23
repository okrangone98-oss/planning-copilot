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
