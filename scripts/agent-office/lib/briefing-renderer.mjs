export function renderDailyBriefing(briefing = {}) {
  const sections = [
    ["오늘의 핵심 업무 3건", briefing.coreTasks, task],
    ["오늘 일정", briefing.todayEvents, event],
    ["이번 주 마감업무", briefing.weekDeadlines, project],
    ["회신/확인 필요한 이메일", briefing.actionableEmails, email],
    ["주의 사업", briefing.warningProjects, project],
    ["향후 30일 주요 행사", briefing.majorEvents, event]
  ];
  return [
    "# 오늘 업무 브리핑",
    metadata(briefing),
    ...sections.flatMap(([heading, items, format]) => [`## ${heading}`, list(items, format)]),
    "## 데이터 수집 요약", summary(briefing.collectionSummary),
    "## 확인 필요 및 한계", list(briefing.limitations, (value) => String(value))
  ].filter(Boolean).join("\n\n");
}
function metadata(briefing) { return [briefing.generatedAt && `- 생성 시각: ${briefing.generatedAt}`, briefing.dataAsOf && `- 데이터 기준: ${briefing.dataAsOf}`].filter(Boolean).join("\n"); }
function list(items, format) { return Array.isArray(items) && items.length ? items.map((item) => `- ${format(item)}`).join("\n") : "- 없음"; }
function task(item) { return `${item.title || "확인 필요"}${id(item)}${links(item.sources)}`; }
function event(item) { return `${item.title || "제목 없는 일정"}${id(item)}${item.start ? ` · ${item.start}` : ""}${links(item.sources || [item.source])}`; }
function project(item) { return `${item.name || item.title || "사업"}${id(item)}${item.status ? ` · ${item.status}` : ""}${item.deadline ? ` · 마감 ${item.deadline}` : ""}${links(item.sources || [item.source])}`; }
function email(item) { return `${item.subject || "제목 없음"}${id(item)} · ${item.from || "발신자 미상"}${item.receivedAt ? ` · ${item.receivedAt}` : ""}${item.category ? ` · ${item.category}` : ""}${item.snippet ? ` · ${snippet(item.snippet)}` : ""}${links(item.sources || [item.source])}`; }
function id(item) { return item?.projectId ? ` [${item.projectId}]` : ""; }
function links(sources) { const urls = [...new Set((Array.isArray(sources) ? sources : []).map((source) => source?.sourceUrl).filter(Boolean))]; return urls.map((url, index) => ` · [출처${urls.length > 1 ? index + 1 : ""}](${url})`).join(""); }
function snippet(value) { const text = String(value).replace(/\s+/g, " ").trim(); return text.length > 160 ? `${text.slice(0, 157)}...` : text; }
function summary(value) { const entries = Object.entries(value || {}); return entries.length ? entries.map(([key, count]) => `- ${key}: ${count}`).join("\n") : "- 수집 요약 없음"; }
