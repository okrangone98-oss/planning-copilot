# Codex Phase 1 구현 지시서

## 목표

`planning-copilot`에 AI 로컬기획 사무국 Phase 1 MVP를 구현한다. Phase 1은 브라우저 안에서 동작하는 시뮬레이션 모드이며, 외부 API 호출과 자동 발송은 하지 않는다.

## 구현 범위

1. `AI 사무국` 탭을 기존 내비게이션 패턴에 맞춰 추가한다.
2. 사용자가 명령 한 줄을 입력하면 `runOffice(command)`가 실행된다.
3. 결과 화면은 아래 4개 영역으로 나뉜다.
   - 작업 분해
   - 담당 에이전트
   - 에이전트별 초안
   - 아침 보고서
4. 아침 보고서는 마크다운 텍스트로 제공하고 복사 버튼을 둔다.
5. 기존 사업계획서 작성 15개 탭은 그대로 유지한다.

## 필수 파일

- `src/types.ts`: AgentRole, AgentTask, AgentDraft, MorningReport, OfficeResult 타입
- `src/data/agentRoles.ts`: 7개 에이전트 매니페스트
- `src/lib/agentOffice.ts`: 사무국 실행 엔진
- `src/App.tsx`: AI 사무국 탭과 UI
- `assets/styles.css`: UI 스타일

## 에이전트 목록

- chief: 비서실장
- local-planning: 기획 담당
- research: 리서치 담당
- content: 콘텐츠 담당
- admin-doc: 행정문서 담당
- email-draft: 서신 담당
- review: 검수 담당

## 구현 원칙

- 신규 외부 의존성 추가 금지
- API 키 코드 포함 금지
- 이메일, SNS, 공문 자동 발송 금지
- 템플릿 기반 결정적 출력 우선
- `callLLM()`은 향후 API 연동 확장 지점으로만 둔다
- 초보자가 읽을 수 있도록 중요한 주석은 한국어로 작성하되, 과도한 주석은 피한다

## 완료 기준

- `npm install` 성공
- `npm run check` 통과
- `AI 사무국` 탭에서 명령 입력 후 4개 결과 영역 렌더링
- 기존 탭 기능 회귀 없음
- `.github/workflows` 파일 생성 금지
- API 키 없음

## 수동 테스트 시나리오

1. 브라우저에서 `AI 사무국` 탭 클릭
2. 명령 입력: `다음 주 의기양양 두레동아리 홍보 콘텐츠 기획해줘`
3. `사무국 실행` 클릭
4. 작업 분해 표가 보이는지 확인
5. 담당 에이전트 카드가 보이는지 확인
6. 에이전트별 초안이 한국어로 나오는지 확인
7. 아침 보고서 복사 버튼이 동작하는지 확인
