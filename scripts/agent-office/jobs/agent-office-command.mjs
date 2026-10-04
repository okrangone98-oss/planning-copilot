import { runOfficeCore } from "../../../src/lib/agentOfficeCore.mjs";

export const agentOfficeCommandJob = {
  run({ command, now = new Date() } = {}) {
    if (typeof command !== "string" || !command.trim()) {
      throw new Error("AI 사무국 명령을 입력해 주세요.");
    }
    const result = runOfficeCore(command, { createdAt: now.toISOString(), mode: "simulation" });

    return {
      summary: "명령을 작업 분해, 역할별 초안, 검수와 아침 보고서로 구성했습니다.",
      artifactName: "agent-office-report.md",
      artifactContent: result.report.markdown,
      sources: [],
      approval: {
        title: "AI 사무국 산출물 검토",
        summary: result.drafts.length + "개 역할 초안을 검토해 주세요."
      }
    };
  }
};
