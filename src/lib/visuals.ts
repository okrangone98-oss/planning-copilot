import type { ProjectData } from "../types";

function safeNode(text: string, fallback: string) {
  const clean = String(text || fallback)
    .replace(/[`"'<>[\]{}|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 42);
  return clean || fallback;
}

function firstLine(text: string, fallback: string) {
  return safeNode(String(text || "").split(/\n|\. /).find(Boolean) || "", fallback);
}

export function buildMermaid(project: ProjectData) {
  return `flowchart LR
  A["문제: ${firstLine(project.problemSituation, "해결할 문제")}"]
  B["대상: ${firstLine(project.targetUsers, "대상자")}"]
  C["투입: ${firstLine(project.inputs, "인력/예산/협력")}"]
  D["활동: ${firstLine(project.activities, "주요 활동")}"]
  E["산출: ${firstLine(project.outputs, "산출물")}"]
  F["단기성과: ${firstLine(project.shortOutcomes, "단기 변화")}"]
  G["중장기성과: ${firstLine(project.longOutcomes, "확산 효과")}"]
  H["평가 포인트: ${firstLine(project.evaluationFocus, "평가기준")}"]

  A --> B --> C --> D --> E --> F --> G
  H -.-> D
  H -.-> F

  classDef problem fill:#fff7f2,stroke:#b85c38,color:#18202a;
  classDef action fill:#eef8f5,stroke:#1f7a68,color:#18202a;
  classDef outcome fill:#f4f7fb,stroke:#2454c6,color:#18202a;
  class A,B problem;
  class C,D,E action;
  class F,G,H outcome;`;
}
