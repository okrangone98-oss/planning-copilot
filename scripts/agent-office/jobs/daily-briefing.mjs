import { runBriefing } from "../daily-briefing.mjs";
import { renderDailyBriefing } from "../lib/briefing-renderer.mjs";

export const dailyBriefingJob = {
  async run({ mode = "oauth", now = new Date() } = {}) {
    const { briefing } = await runBriefing({ mode, now, writeOutput: false });
    const sources = collectSources(briefing);

    return {
      summary: "Gmail " + briefing.collectionSummary.gmail + "건, 일정 " +
        briefing.collectionSummary.calendar + "건, 사업 " + briefing.collectionSummary.sheets + "건을 읽었습니다.",
      artifactName: "daily-briefing.md",
      artifactContent: renderDailyBriefing(briefing),
      sources,
      approval: {
        title: "Daily Briefing 검토",
        summary: "오늘의 핵심 업무와 주의 항목을 확인해 주세요."
      }
    };
  }
};

function collectSources(briefing) {
  const entries = [
    ...briefing.coreTasks,
    ...briefing.todayEvents,
    ...briefing.weekDeadlines,
    ...briefing.actionableEmails,
    ...briefing.warningProjects,
    ...briefing.majorEvents
  ];
  const seen = new Set();
  return entries.flatMap((entry) => entry.sources || []).filter((source) => {
    const key = source.sourceType + "|" + source.sourceUrl;
    if (!source.sourceUrl || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
