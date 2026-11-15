# 워크브레인 내보내기 (david-workbrain · Notion)

작성한 사업계획서 초안, 예산 편성표, 정산 증빙 체크리스트, 결과보고 초안, 후속 할 일을 **Markdown 한 편**으로 묶어 복사하거나 `.md` 파일로 내려받습니다.

## 느슨한 연계 원칙

세 저장소·앱을 하나로 합치지 않습니다. 각자 역할만 하고, 경계는 Markdown으로 잇습니다.

| 도구 | 역할 |
| --- | --- |
| planning-copilot | 공고 해석, 사업계획서 초안, 예산 편성, 정산 증빙 점검, 결과보고 초안 |
| david-workbrain | 업무 지식, SOP, 문서 템플릿, Obsidian 노트 |
| my-workbench | 업무 지시, 진행 현황, 결과 검토·승인 |

앱 안에서는 `설정·연결 → 프로젝트 링크`와 `워크브레인 내보내기` 화면에서 두 워크스페이스로 바로 갈 수 있습니다.

- my-workbench: https://okrangone98-oss.github.io/my-workbench/
- david-workbrain: https://github.com/okrangone98-oss/david-workbrain

## 문서 구조

YAML frontmatter는 david-workbrain의 기존 노트(`Templates/TPL_결과보고서.md`, `Templates/TPL_사업MOC.md`)와 같은 키를 씁니다.

```yaml
---
type: project
title: "2026 양양 두레동아리 활동지원"
description: "…한 줄 요약…"
resource: planning_copilot
source_path: "01_회사_사업/2026-양양-두레동아리-활동지원_예산정산결과보고_2026-11-15.md"
domain: company
agent_ready: true
sensitive_handling: "개인정보, 정산자료, 계약자료, 주민정보 가능 자료는 자동 요약하지 않고 검토 필요로 표시"
status: draft
program: "2026 양양 두레동아리 활동지원"
agency: "농림축산식품부 · 양양군"
funding_source: "국고보조금"
budget_total: 24180000
deadline: "2026-11-28"
tags: ["planning-copilot", "국고보조사업", "예산정산"]
created: "2026-11-15"
timestamp: "2026-11-15"
exported_by: planning-copilot
---
```

본문 섹션:

1. 메타데이터(사업명·회계연도·기관·재원·예산 총액·재원 구성·증빙 진행·보고서 작성 상태·작성 폴더·출처)
2. 추진 일정·마감일 요약(신청·교부, 사업 시작·종료, 정산, 결과보고 + D-day)
3. 예산 편성표(재원 구성 / 비목별 편성 / 비목별 비중)
4. 정산 증빙 체크리스트(그룹별 `- [x]` / `- [ ]`, 필수 표시, 항목 메모)
5. 결과보고서 초안(섹션별 내용, 미작성은 `_작성 필요_`)
6. 사업계획서 초안(선택)
7. 후속 할 일(마감 확인 / 보완 작업 체크리스트)
8. 연결(my-workbench, david-workbrain, Jira·Notion·Sheet·Drive 링크)

## 사용

1. `워크브레인 내보내기`에서 넣을 폴더(`01_회사_사업` 또는 `outputs`), `domain`, `status`, 마감일, 태그, 포함 범위를 고릅니다.
2. 미리보기에서 문서를 확인합니다.
3. `Markdown 복사`(Obsidian·GitHub용), `Notion용 복사`(frontmatter를 코드블록으로 옮긴 형태), `.md 내려받기` 중 필요한 것을 씁니다.
4. david-workbrain에서는 받은 파일을 고른 폴더에 넣고 커밋합니다. `source_path`는 넣을 위치를 그대로 적어 두므로, 실제 경로와 다르면 frontmatter 한 줄만 고치면 됩니다.

## 지키는 선

- 원본 증빙 파일(계약서·세금계산서·출석부·사진 등)은 담지 않습니다. 요약·체크 상태·할 일만 담습니다.
- 주민 명단, 개인 연락처, 계좌번호 같은 값은 이 앱이 수집하지 않으며, 메모에 적은 내용은 사용자가 직접 확인해야 합니다. 내보내기 문서를 GitHub 공개 저장소에 올리지 마세요.
- API 키·토큰은 frontmatter에도 본문에도 들어가지 않습니다(테스트로 고정).
- Notion 붙여넣기는 서식만 맞춘 것이고, 앱이 Notion API로 직접 쓰지는 않습니다.

## 검증

- 내보내기 테스트: frontmatter 키·파일명 규칙·일정 D-day·체크리스트 표기·합계 금액·포함 범위 옵션·키 미포함·Notion 변환 7개 통과.
- 헤드리스 브라우저에서 실제 화면으로 생성한 문서: 5,392자, 일정 표·`- [x]` 항목·후속 할 일·워크스페이스 링크 포함 확인.
