import { sourceRef } from "./contracts.mjs";
import { getTimeWindows } from "./time-windows.mjs";

const DEFAULT_MAJOR_EVENT_KEYWORDS = [
  "행사", "설명회", "축제", "교육", "성과공유회", "포럼", "워크숍", "간담회", "발표"
];

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

  return (response?.data?.items || []).map((event) => normalizeCalendarEvent(event || {}, detectedAt));
}

export function selectMajorEvents(events, keywords = DEFAULT_MAJOR_EVENT_KEYWORDS) {
  const seenIds = new Set();
  const normalizedKeywords = (Array.isArray(keywords) ? keywords : DEFAULT_MAJOR_EVENT_KEYWORDS)
    .filter((keyword) => typeof keyword === "string" && keyword)
    .map((keyword) => keyword.toLowerCase());

  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!event || typeof event !== "object") return false;

    const title = typeof event.title === "string" ? event.title.toLowerCase() : "";
    const hasKeyword = normalizedKeywords.some((keyword) => title.includes(keyword));
    const isMajor = event.allDay || Number(event.durationMinutes) >= 120 || hasKeyword;
    if (!isMajor || !event.id || seenIds.has(event.id)) return false;

    seenIds.add(event.id);
    return true;
  });
}

function normalizeCalendarEvent(event, detectedAt) {
  const startValue = event.start?.dateTime || event.start?.date || "";
  const endValue = event.end?.dateTime || event.end?.date || startValue;
  const projectId = event.extendedProperties?.private?.projectId;
  const id = event.id || "";
  const allDay = Boolean(event.start?.date);
  const durationMinutes = Math.max(0, (Date.parse(endValue) - Date.parse(startValue)) / 60000 || 0);
  const htmlLink = event.htmlLink || `https://calendar.google.com/calendar/u/0/r/eventedit/${id}`;

  return {
    id,
    title: event.summary || "제목 없는 일정",
    start: startValue,
    end: endValue,
    allDay,
    durationMinutes,
    attendeeCount: Array.isArray(event.attendees) ? event.attendees.length : 0,
    htmlLink,
    ...(projectId ? { projectId } : {}),
    source: sourceRef("calendar", id, event.htmlLink || "", detectedAt, projectId)
  };
}
