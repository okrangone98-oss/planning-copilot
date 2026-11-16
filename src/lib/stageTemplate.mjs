// 운영 단계 템플릿 — 확정된 사업을 업무·일정으로 바꿀 때 쓰는 기본값.
// 브라우저와 node 테스트에서 함께 쓰므로 mjs로 두고, 타입은 stageTemplate.d.mts에 둔다.
// 단계는 필수가 아니다. 사업에 맞지 않는 단계는 건너뛰고, 만든 업무는 사용자가 고쳐 쓴다.

export const TEMPLATE_VERSION = "phase1.v1";

/**
 * 단계 정의.
 * - startOffset: 사업 시작일 기준 일수(음수는 시작 전)
 * - endOffset: 사업 종료일 기준 일수(음수는 종료 전)
 * - sessionOffset: 회차 시작일 기준 일수
 * - dependsOn: "단계id/업무slug". 같은 단계면 slug만 적어도 된다.
 * - sessionScoped: 회차마다 한 벌씩 만든다.
 */
export const STAGES = [
  {
    id: "plan",
    label: "사업기획",
    purpose: "목표·대상·운영 범위를 한 장으로 맞춘다.",
    tasks: [
      {
        slug: "goal",
        title: "사업 목표·대상 정리",
        priority: "high",
        startOffset: -20,
        criteria: "목표 1문장과 대상·규모를 적었다."
      },
      {
        slug: "scope",
        title: "운영 범위·회차 수 확정",
        priority: "high",
        startOffset: -18,
        criteria: "회차 수와 회당 인원이 정해졌다.",
        dependsOn: ["goal"]
      },
      {
        slug: "roles",
        title: "추진체계·역할 정리",
        priority: "normal",
        startOffset: -14,
        criteria: "담당·협력기관 역할이 나뉘었다.",
        dependsOn: ["goal"]
      }
    ]
  },
  {
    id: "planBudget",
    label: "계획·예산",
    purpose: "비목·단가와 재원 비율을 맞춘다.",
    tasks: [
      {
        slug: "budget-lines",
        title: "비목·단가·수량 정리",
        priority: "high",
        startOffset: -14,
        criteria: "예산 편성표에 모든 비목이 들어갔다."
      },
      {
        slug: "budget-check",
        title: "예산 총액·재원 비율 점검",
        priority: "normal",
        startOffset: -10,
        criteria: "총액과 국비·지방비·자부담 합계가 맞는다.",
        dependsOn: ["budget-lines"]
      }
    ]
  },
  {
    id: "review",
    label: "검토·승인",
    purpose: "내부 검토와 결재를 마친다.",
    skipHint: "이미 확정된 위탁·자체 사업은 이 단계를 건너뛰어도 됩니다.",
    tasks: [
      {
        slug: "internal-review",
        title: "내부 검토 의견 받기",
        priority: "high",
        startOffset: -10,
        criteria: "검토 의견과 반영 여부를 기록했다.",
        dependsOn: ["plan/scope"]
      },
      {
        slug: "approve",
        title: "확정안 승인",
        priority: "high",
        startOffset: -7,
        criteria: "승인일과 승인자를 기록했다.",
        dependsOn: ["internal-review"]
      }
    ]
  },
  {
    id: "resources",
    label: "자원확보",
    purpose: "강사·장소·물품을 확보한다.",
    skipHint: "강사가 없는 사업은 강사 섭외 업무를 지워도 됩니다.",
    tasks: [
      {
        slug: "instructor",
        title: "강사·협력자 섭외 확정",
        priority: "high",
        startOffset: -10,
        criteria: "강사별 일정과 회차가 맞았다."
      },
      {
        slug: "venue",
        title: "장소·시설 예약",
        priority: "normal",
        startOffset: -9,
        criteria: "회차별 장소와 사용 시간이 확정됐다.",
        dependsOn: ["plan/scope"]
      },
      {
        slug: "materials",
        title: "재료·장비 구매 계획",
        priority: "normal",
        startOffset: -7,
        criteria: "품목·수량·단가를 견적과 맞췄다.",
        dependsOn: ["planBudget/budget-lines"]
      }
    ]
  },
  {
    id: "promotion",
    label: "홍보·모집",
    purpose: "참가자를 모으고 명단을 확정한다.",
    tasks: [
      {
        slug: "promo-plan",
        title: "홍보 채널·일정 정리",
        priority: "normal",
        startOffset: -8,
        criteria: "채널별 게시일과 담당이 정해졌다."
      },
      {
        slug: "recruit-open",
        title: "참가자 모집 공고",
        priority: "high",
        startOffset: -6,
        criteria: "모집 공고가 게시됐다.",
        dependsOn: ["promo-plan"]
      },
      {
        slug: "recruit-close",
        title: "참가자 명단 확정",
        priority: "high",
        startOffset: -2,
        criteria: "정원과 대기자를 확정했다.",
        dependsOn: ["recruit-open"]
      }
    ]
  },
  {
    id: "prep",
    label: "운영 준비",
    purpose: "회차마다 필요한 것을 미리 챙긴다.",
    sessionScoped: true,
    tasks: [
      {
        slug: "prep-check",
        title: "{seq}회차 준비물·강사 확인",
        priority: "high",
        sessionOffset: -3,
        criteria: "준비물·강사·장소를 회차 전에 확인했다."
      },
      {
        slug: "prep-roster",
        title: "{seq}회차 참석자 명단·출석부 준비",
        priority: "normal",
        sessionOffset: -2,
        criteria: "출석부와 참석자 명단을 준비했다."
      }
    ]
  },
  {
    id: "run",
    label: "실행",
    purpose: "회차를 운영하고 현장 기록을 남긴다.",
    sessionScoped: true,
    tasks: [
      {
        slug: "run-session",
        title: "{seq}회차 운영",
        priority: "high",
        sessionOffset: 0,
        criteria: "계획한 프로그램을 진행했다.",
        dependsOn: ["prep/prep-check"]
      },
      {
        slug: "run-record",
        title: "{seq}회차 사진·출석 기록",
        priority: "normal",
        sessionOffset: 1,
        criteria: "사진과 출석 결과를 남겼다.",
        dependsOn: ["run-session"]
      }
    ]
  },
  {
    id: "issue",
    label: "변경·이슈 대응",
    purpose: "회차별 변경과 문제를 남긴다.",
    sessionScoped: true,
    tasks: [
      {
        slug: "issue-log",
        title: "{seq}회차 변경·이슈 기록",
        priority: "low",
        sessionOffset: 1,
        criteria: "변경 사유와 조치를 남겼다."
      }
    ]
  },
  {
    id: "evidence",
    label: "증빙 관리",
    purpose: "회차 증빙을 모아 정산을 준비한다.",
    tasks: [
      {
        slug: "evidence-per-session",
        title: "{seq}회차 증빙 모으기",
        sessionScoped: true,
        sessionOffset: 3,
        criteria: "회차 사진·출석부·영수증 사본을 한 폴더에 넣었다."
      },
      {
        slug: "evidence-check",
        title: "정산 증빙 체크리스트 점검",
        priority: "high",
        endOffset: -20,
        criteria: "필수 증빙 누락이 없다."
      }
    ]
  },
  {
    id: "settlement",
    label: "예산 정산",
    purpose: "지출과 증빙을 대조하고 정산서를 낸다.",
    tasks: [
      {
        slug: "settle-ledger",
        title: "지출 내역·증빙 대조",
        priority: "high",
        endOffset: -14,
        criteria: "지출 합계와 예산 집행 내역이 맞는다."
      },
      {
        slug: "settle-report",
        title: "정산서 작성·제출",
        priority: "high",
        endOffset: -7,
        criteria: "정산서와 증빙 철을 제출했다.",
        dependsOn: ["settle-ledger"]
      }
    ]
  },
  {
    id: "evaluation",
    label: "성과 평가",
    purpose: "목표 대비 실적을 확인한다.",
    tasks: [
      {
        slug: "outcome-data",
        title: "참여·성과 데이터 집계",
        priority: "normal",
        endOffset: -10,
        criteria: "회차별 참석·만족도 합계를 냈다."
      },
      {
        slug: "outcome-review",
        title: "목표 대비 실적 점검",
        priority: "normal",
        endOffset: -7,
        criteria: "목표와 실적의 차이, 그 이유를 적었다.",
        dependsOn: ["outcome-data"]
      }
    ]
  },
  {
    id: "report",
    label: "결과보고·환류",
    purpose: "결과보고를 내고 다음 사업에 남긴다.",
    tasks: [
      {
        slug: "report-draft",
        title: "결과보고 초안 작성",
        priority: "high",
        endOffset: -5,
        criteria: "기존 결과보고 목차를 채웠다.",
        dependsOn: ["evaluation/outcome-review"]
      },
      {
        slug: "report-submit",
        title: "결과보고 제출·환류",
        priority: "high",
        endOffset: 0,
        criteria: "제출본과 개선 메모를 남겼다.",
        dependsOn: ["report-draft"]
      }
    ]
  }
];

export const STAGE_IDS = STAGES.map((stage) => stage.id);
export const MAX_SESSION_COUNT = 60;

const STAGE_INDEX = new Map(STAGES.map((stage, index) => [stage.id, index]));
const STAGE_MAP = new Map(STAGES.map((stage) => [stage.id, stage]));

export function stageLabel(id) {
  return STAGE_MAP.get(String(id || ""))?.label || "기타";
}

export function stageIndex(id) {
  return STAGE_INDEX.has(String(id || "")) ? STAGE_INDEX.get(String(id)) : STAGES.length;
}

export function isStageId(id) {
  return STAGE_MAP.has(String(id || ""));
}

/** 화면에서 단계 목록을 그릴 때 쓰는 요약. (템플릿 원본은 STAGES) */
export function listStages() {
  return STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    purpose: stage.purpose || "",
    skipHint: stage.skipHint || "",
    sessionScoped: Boolean(stage.sessionScoped),
    taskCount: stage.tasks.length
  }));
}

function shiftDate(dateText, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || "").trim());
  if (!match) return "";
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(base)) return "";
  return new Date(base + Math.round(days) * 86400000).toISOString().slice(0, 10);
}

/** 같은 사업 안에서 업무 하나를 다시 만들 때도 같은 값이 나오도록 하는 멱등 키. */
export function taskSourceKey({ templateVersion = TEMPLATE_VERSION, stage, sessionSequence = 0, slug }) {
  return `${templateVersion}:${stage}:${Number(sessionSequence) || 0}:${slug}`;
}

function resolveDependencyKey(stageId, reference, sessionSequence, sessionScoped, skipped) {
  const raw = String(reference || "");
  if (!raw) return "";
  const [maybeStage, maybeSlug] = raw.includes("/") ? raw.split("/") : [stageId, raw];
  const targetStage = STAGE_MAP.get(maybeStage);
  // 건너뛴 단계의 업무는 만들어지지 않으므로 그 선행 관계도 만들지 않는다.
  if (!targetStage || skipped?.has(targetStage.id)) return "";
  const targetTask = targetStage.tasks.find((task) => task.slug === maybeSlug);
  if (!targetTask) return "";
  const targetScoped = Boolean(targetTask.sessionScoped ?? targetStage.sessionScoped);
  return taskSourceKey({
    stage: targetStage.id,
    sessionSequence: targetScoped && sessionScoped ? sessionSequence : 0,
    slug: targetTask.slug
  });
}

/**
 * 단계 정의를 업무 초안 목록으로 편다.
 * sessions: [{ sequence, startAt }] — 없으면 1..sessionCount 회차를 상정한다.
 */
export function buildTemplateTasks({
  sessionCount = 1,
  sessions = [],
  skipStages = [],
  startDate = "",
  endDate = "",
  templateVersion = TEMPLATE_VERSION
} = {}) {
  const skipped = new Set((Array.isArray(skipStages) ? skipStages : []).filter((id) => isStageId(id)));
  const plannedSessions = (Array.isArray(sessions) && sessions.length
    ? sessions.map((session, index) => ({
      sequence: Number(session?.sequence) || index + 1,
      startAt: String(session?.startAt || "")
    }))
    : Array.from({ length: Math.max(1, Math.min(MAX_SESSION_COUNT, Math.round(Number(sessionCount) || 1))) }, (_, index) => ({
      sequence: index + 1,
      startAt: ""
    }))
  ).slice(0, MAX_SESSION_COUNT);

  const drafts = [];
  for (const stage of STAGES) {
    if (skipped.has(stage.id)) continue;
    for (const task of stage.tasks) {
      const sessionScoped = Boolean(task.sessionScoped ?? stage.sessionScoped);
      const runs = sessionScoped ? plannedSessions : [{ sequence: 0, startAt: "" }];
      for (const session of runs) {
        const sessionStart = String(session.startAt || "").slice(0, 10);
        let dueDate = "";
        if (sessionScoped && sessionStart && task.sessionOffset !== undefined) {
          dueDate = shiftDate(sessionStart, task.sessionOffset);
        } else if (!sessionScoped && task.startOffset !== undefined && startDate) {
          dueDate = shiftDate(startDate, task.startOffset);
        } else if (!sessionScoped && task.endOffset !== undefined && endDate) {
          dueDate = shiftDate(endDate, task.endOffset);
        }
        drafts.push({
          sourceKey: taskSourceKey({ templateVersion, stage: stage.id, sessionSequence: session.sequence, slug: task.slug }),
          stage: stage.id,
          stageLabel: stage.label,
          sessionSequence: session.sequence,
          title: task.title.replace("{seq}", String(session.sequence || 1)),
          priority: task.priority || "normal",
          dueDate,
          completionCriteria: task.criteria || "",
          dependsOn: (task.dependsOn || [])
            .map((reference) => resolveDependencyKey(stage.id, reference, session.sequence, sessionScoped, skipped))
            .filter(Boolean)
          ,
          templateVersion
        });
      }
    }
  }
  return drafts;
}

/** 회차 기본값: 번호만 있고 날짜·제목은 비어 있다. 사용자가 채운다. */
export function buildSkeletonSessions(count) {
  const total = Math.max(1, Math.min(MAX_SESSION_COUNT, Math.round(Number(count) || 1)));
  return Array.from({ length: total }, (_, index) => ({
    sequence: index + 1,
    title: `${index + 1}회차`,
    startAt: ""
  }));
}
