import { selectMajorEvents } from "./calendar-adapter.mjs";
import { attachProjectId } from "./project-aliases.mjs";
import { getTimeWindows } from "./time-windows.mjs";

const COMPLETED = /^(완료|완료함|종료|done|completed|closed)$/i;
const ACTIONABLE = new Set(["ACTION_REQUIRED", "WAITING", "FINANCE", "APPLICATION", "CANCELLATION", "DOCUMENT", "SCHEDULE"]);
const DAY = 86400000;

export const isCompletedStatus = (status = "") => COMPLETED.test(String(status).trim());
export function computeProjectStatus(project = {}, { today, linkedEmails = [], linkedEvents = [] } = {}) {
  if (isCompletedStatus(project.statusText || project.status)) return "NORMAL";
  const days = daysUntil(project.deadline, today);
  const text = `${project.statusText || project.status || ""} ${project.name || ""}`;
  const risk = days <= 3 || /승인.*(미확보|필요)|필수.*(누락|없음)|일정.*충돌/i.test(text) || (linkedEvents.length > 1 && hasOverlap(linkedEvents));
  const warning = days <= 7 || linkedEmails.some((email) => ["ACTION_REQUIRED", "WAITING"].includes(email.category)) || /미확인|미완료|준비.*필요|대기/i.test(text);
  return risk ? "RISK" : warning ? "WARNING" : "NORMAL";
}
export function dedupeCandidates(candidates = []) {
  const grouped = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const key = String(candidate.key || `${candidate.projectId || ""}|${candidate.title || ""}`).normalize("NFKC").trim();
    if (!key) continue;
    const current = grouped.get(key);
    if (!current) grouped.set(key, { ...candidate, key, sources: uniqueSources(candidate.sources || sourcesOf(candidate)) });
    else current.sources = uniqueSources([...current.sources, ...(candidate.sources || sourcesOf(candidate))]);
  }
  return [...grouped.values()];
}
export function buildDailyBriefing(input = {}) {
  const now = date(input.now || input.generatedAt || input.dataAsOf) || new Date();
  const windows = input.windows || getTimeWindows(now);
  const today = windows.todayKey || kstKey(now);
  const aliases = input.aliases || {};
  const projects = attach(input.projects, aliases);
  const emails = attach(input.emails || input.gmail, aliases);
  const events = attach(input.calendarEvents || input.events, aliases);
  const emailByProject = group(emails), eventByProject = group(events);
  const decorated = projects.map((project) => ({ ...project, sources: sourcesOf(project), status: computeProjectStatus(project, { today, linkedEmails: emailByProject.get(project.projectId) || [], linkedEvents: eventByProject.get(project.projectId) || [] }) }));
  const completed = new Set(decorated.filter((project) => isCompletedStatus(project.statusText || project.status)).map((project) => project.projectId).filter(Boolean));
  const active = (item) => !item.projectId || !completed.has(item.projectId);
  const projectById = new Map(decorated.filter((project) => project.projectId).map((project) => [project.projectId, project]));
  const todayEvents = events.filter((event) => isToday(event, windows, today));
  const weekDeadlines = decorated.filter((project) => active(project) && project.deadline >= today && before(project.deadline, windows.weekEnd));
  const actionableEmails = emails.filter((email) => active(email) && (email.isActionable || ACTIONABLE.has(email.category)));
  const warningProjects = decorated.filter((project) => active(project) && project.status !== "NORMAL");
  const majorEvents = selectMajorEvents(events).filter((event) => within(event.start, windows.todayStart, windows.thirtyDayEnd));
  const coreTasks = dedupeCandidates([
    ...warningProjects.map((project) => task(project.name, project, project.sources)),
    ...actionableEmails.map((email) => task(email.subject || "이메일 확인", projectById.get(email.projectId), email.sources, email.category)),
    ...todayEvents.filter(active).map((event) => task(event.title || "일정 확인", projectById.get(event.projectId), event.sources, undefined, true))
  ]).sort(compare).slice(0, 3);
  return { generatedAt: input.generatedAt || now.toISOString(), dataAsOf: input.dataAsOf || input.generatedAt || now.toISOString(), coreTasks, todayEvents, weekDeadlines, actionableEmails, warningProjects, majorEvents, collectionSummary: { calendar: events.length, gmail: emails.length, sheets: projects.length, ...(input.collectionSummary || {}) }, limitations: Array.isArray(input.limitations) ? [...input.limitations] : [] };
}
function attach(items, aliases) { return (Array.isArray(items) ? items : []).filter((item) => item && typeof item === "object").map((item) => { const linked = attachProjectId(item, aliases); return { ...linked, sources: sourcesOf(linked) }; }); }
function sourcesOf(item) { return Array.isArray(item?.sources) ? item.sources : item?.source ? [item.source] : []; }
function uniqueSources(sources) { const seen = new Set(); return sources.filter((source) => { if (!source || typeof source !== "object") return false; const key = `${source.sourceType || ""}|${source.sourceId || ""}|${source.sourceUrl || ""}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function group(items) { const result = new Map(); for (const item of items) if (item.projectId) result.set(item.projectId, [...(result.get(item.projectId) || []), item]); return result; }
function task(title, project, sources, category, event) { return { key: `${project?.projectId || "general"}|${title}`, title, projectId: project?.projectId, status: project?.status, deadline: project?.deadline, category, event, sources }; }
function compare(left, right) { const rank = (value) => value === "RISK" ? 0 : value === "WARNING" ? 1 : 2; return rank(left.status) - rank(right.status) || daysUntil(left.deadline) - daysUntil(right.deadline) || (left.category === "ACTION_REQUIRED" ? -1 : 0) - (right.category === "ACTION_REQUIRED" ? -1 : 0) || Number(Boolean(left.event)) - Number(Boolean(right.event)) || `${left.projectId || ""}|${left.key}`.localeCompare(`${right.projectId || ""}|${right.key}`); }
function date(value) { const result = new Date(value); return Number.isFinite(result.getTime()) ? result : null; }
function kstKey(value) { return new Date(value.getTime() + 32400000).toISOString().slice(0, 10); }
function daysUntil(deadline, today = kstKey(new Date())) { const end = Date.parse(`${deadline}T00:00:00+09:00`), start = Date.parse(`${today}T00:00:00+09:00`); return Number.isFinite(end) && Number.isFinite(start) ? Math.ceil((end - start) / DAY) : Infinity; }
function hasOverlap(events) { const sorted = [...events].sort((left, right) => Date.parse(left.start) - Date.parse(right.start)); return sorted.some((event, index) => index && Date.parse(event.start) < Date.parse(sorted[index - 1].end)); }
function isToday(event, windows, today) { return event.allDay ? String(event.start).slice(0, 10) === today : within(event.start, windows.todayStart, windows.tomorrowStart); }
function before(day, end) { return !end || Date.parse(`${day}T00:00:00+09:00`) < new Date(end).getTime(); }
function within(value, start, end) { const time = Date.parse(value || ""); return Number.isFinite(time) && (!start || time >= new Date(start).getTime()) && (!end || time < new Date(end).getTime()); }
