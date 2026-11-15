// 기관 표준 사업계획서 연습 양식 — 양식 파일 없이 처음 써 보는 사람을 위한 예시 양식 1종.
//
// public/practice/plan-practice-form.hwpx 를 앱이 불러와 그대로 읽는다(업로드와 같은 경로).
// 이 HWPX 는 kordoc generate --preset 계획서 로 만든 실제 한글 문서라서,
// 연습 양식에 채운 값도 kordoc fill 로 원본 서식 그대로 넣을 수 있다.
// 다시 만들 때는: node scripts/make-practice-template.mjs

export const PRACTICE_TEMPLATE_LABEL = "기관 표준 사업계획서 연습 양식";

export const PRACTICE_TEMPLATE_FILE = "plan-practice-form.hwpx";

export const PRACTICE_TEMPLATE_NOTE =
  "처음 쓰는 사람이 양식 구조를 익히도록 만든 예시 양식입니다. 실제 공고에 낼 때는 공고에서 받은 양식으로 바꿔 주세요.";

/** 양식 원문 — 파일을 불러오지 못했을 때 같은 구조를 글자로 읽어 준다. */
export const PRACTICE_TEMPLATE_TEXT = `# 사업계획서 (기관 표준 연습 양식)

> 사업계획서를 처음 쓰는 사람이 양식 구조를 익히도록 만든 연습용 예시 양식임

## Ⅰ. 사업 개요

| 구분 | 내용 |
| --- | --- |
| 사업명 |  |
| 수행기관 |  |
| 사업기간 |  |
| 사업지역 |  |
| 총사업비 |  |
| 담당자 |  |

※ 사업명은 공고문의 사업명과 같게 적고, 기간은 시작과 끝을 함께 적습니다.

## Ⅱ. 추진 배경

| 항목 | 내용 |
| --- | --- |
| 지역 현황 |  |
| 문제점 |  |
| 추진 근거 |  |

※ 현황은 숫자(인구·가구·시설 수)로, 문제점은 그 숫자가 왜 문제인지로 씁니다.

## Ⅲ. 사업 목표

| 구분 | 내용 |
| --- | --- |
| 목표 |  |
| 대상 |  |
| 참여 인원 |  |

※ 목표는 “누가 무엇을 할 수 있게 되는가” 한 문장으로 씁니다.

## Ⅳ. 추진 계획

| 구분 | 내용 |
| --- | --- |
| 추진 내용 |  |
| 운영 방법 |  |
| 협력 기관 |  |

## Ⅴ. 추진 일정

| 구분 | 내용 |
| --- | --- |
| 계획 수립 |  |
| 실행 |  |
| 평가·보고 |  |

## Ⅵ. 소요 예산

| 비목 | 산출 내역 |
| --- | --- |
| 인건비 |  |
| 운영비 |  |
| 홍보비 |  |
| 예비비 |  |

※ 산출 내역은 “단가 × 횟수 = 금액” 꼴로 적으면 심사에서 계산이 맞아떨어집니다.

## Ⅶ. 기대 효과

| 구분 | 내용 |
| --- | --- |
| 정량 성과 |  |
| 정성 성과 |  |

검토 의견: [입력]
`;

/**
 * 연습 양식 파일 주소. 앱이 어디에 올라가 있든(document.baseURI) 같은 폴더의 practice/ 아래를 본다.
 * 예: http://127.0.0.1:5173/planning-copilot/ → .../planning-copilot/practice/plan-practice-form.hwpx
 */
export function practiceTemplateUrl(baseUri) {
  const base = String(baseUri ?? "").trim() || "http://localhost/";
  try {
    return new URL(`practice/${PRACTICE_TEMPLATE_FILE}`, base).toString();
  } catch {
    return `practice/${PRACTICE_TEMPLATE_FILE}`;
  }
}
