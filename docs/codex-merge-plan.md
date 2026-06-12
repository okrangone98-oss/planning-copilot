# Codex 병합 및 확장 계획

이 문서는 `AI 사무국` MVP를 실제 자동화 시스템으로 확장하기 위한 병합 계획이다. 현재 구현은 API 키 없이 동작하는 템플릿 기반 시뮬레이션 모드이며, 외부 발송이나 게시 기능은 포함하지 않는다.

## 1. 현재 병합 범위

이번 범위는 웹앱 안에서 수동으로 실행하는 MVP다.

- `src/data/agentRoles.ts`: 7개 에이전트 역할 매니페스트
- `src/lib/agentOffice.ts`: 명령 분해, 담당 배정, 초안 생성, 아침 보고서 조립
- `src/types.ts`: 에이전트 사무국 타입
- `src/App.tsx`: `AI 사무국` 탭과 4개 결과 영역
- `assets/styles.css`: 사무국 탭 UI 스타일

워크플로우 파일은 만들지 않는다. API 키도 코드나 문서에 적지 않는다.

## 2. LLM API 연동 계획

실제 Claude API 또는 다른 LLM API는 `src/lib/agentOffice.ts`의 `callLLM(prompt)` 함수가 교체 지점이다.

현재 구조:

```ts
export function callLLM(prompt: string): string {
  return `[simulation: future-llm-extension-point] ${prompt.slice(0, 120)}`;
}
```

향후 교체 방향:

1. 브라우저 빌드에는 API 키를 절대 넣지 않는다.
2. GitHub Actions 또는 서버 환경에서만 `ANTHROPIC_API_KEY` 같은 시크릿을 읽는다.
3. `runOffice()`는 그대로 두고, 에이전트별 초안을 만들 때 `callLLM()`을 선택적으로 호출한다.
4. 키가 없거나 호출이 실패하면 현재 시뮬레이션 템플릿으로 자동 폴백한다.
5. 호출 횟수, `max_tokens`, timeout을 코드 레벨에서 제한한다.

이 방식을 쓰면 UI, 타입, 보고서 조립 로직은 유지하고 LLM 호출부만 바꿀 수 있다.

## 3. GitHub Actions 제안

향후 자동 실행은 별도 PR에서 `.github/workflows/agent-office.yml`로 추가한다. 이번 PR에서는 생성하지 않는다.

권장 트리거:

- `issues.opened`
- `issues.labeled`
- `workflow_dispatch`

권장 조건:

- Issue에 `agent-task` 라벨이 있을 때만 실행
- 제목이 `[명령]`으로 시작하면 제목을 명령으로 사용
- 아니면 Issue 본문 첫 문단을 명령으로 사용

권장 권한:

```yaml
permissions:
  contents: write
  issues: write
```

권장 안전장치:

- `timeout-minutes: 15`
- 동일 Issue 중복 실행 방지를 위한 `concurrency`
- API 키가 없어도 시뮬레이션 모드로 성공
- 결과물 상단에 공개 저장소 주의 문구 포함

## 4. 보고서 저장 계획

GitHub Actions 단계에서만 `reports/` 폴더를 사용한다. 파일명은 아래 형식을 권장한다.

```text
reports/YYYY-MM-DD-명령-slug.md
```

보고서에는 다음 정보를 포함한다.

- 원본 명령
- 생성 시각
- 참여 에이전트
- 실행 모드(`simulation` 또는 `llm`)
- 오늘의 핵심 3가지
- 에이전트별 산출물 요약
- 다음 액션 체크리스트

## 5. 운영 안전 원칙

- 이메일 자동 발송 금지
- SNS 자동 게시 금지
- 공문 자동 제출 금지
- 주민 개인정보 자동 업로드 금지
- 사용자가 승인하기 전 외부 서비스에 쓰기 작업 금지
- 공개 저장소에 민감정보 입력 금지

AI 사무국의 역할은 사람을 대체하는 것이 아니라, 혼자 일하는 사람에게 팀의 초안을 제공하는 것이다. 최종 판단과 실행은 사용자가 맡는다.
