# 사무국장 업무 관제탑 하네스 설계

## 상태

- 설계일: 2026-09-24
- 승인 상태: 사용자 검토 요청
- 구현 브랜치: `feat/control-tower-harness`
- 연계 설계: `2026-09-23-office-control-tower-mvp-design.md`

## 목표

기존 사무국장 업무 관제탑과 로컬 실행기를 연결하는 운영 하네스를 만든다. 하네스는 작업을 정해진 단계로 실행하고 상태, 재시도, 승인 대기, 산출물 위치를 기록한다. 브라우저 앱은 민감정보가 제거된 스냅샷을 사용자가 직접 불러와 현재 업무 상태를 확인한다.

MVP의 실제 실행 작업은 다음 두 개로 제한한다.

1. `daily-briefing`: Google Workspace 읽기 결과로 일일 브리핑 생성
2. `agent-office-command`: 사용자 명령을 분석해 에이전트별 초안과 최종 보고 생성

## 운영 원칙

- 원본 업무 정보와 실행 산출물은 로컬에 둔다.
- Git에는 코드, 템플릿, 스키마, 익명화된 예시만 기록한다.
- 외부 발송, 제출, 게시, Google Workspace 쓰기는 수행하지 않는다.
- 승인함의 승인은 산출물 확정과 수동 내보내기 허용을 뜻한다.
- 브라우저에는 OAuth 토큰, API 키, 메일 전문을 전달하지 않는다.
- 모든 실행은 출처와 상태 변경 이력을 추적할 수 있어야 한다.

## 선택한 방식

### 단계적 혼합 구조

Phase 1에서는 로컬 Node 하네스가 실행 결과와 관제용 스냅샷을 파일로 생성한다. 사용자는 관제탑 UI에서 스냅샷 파일을 직접 불러온다.

Phase 2에서는 필요할 때만 로컬 sidecar API를 추가하여 실시간 실행, 상태 갱신, 승인 처리를 연결한다. Phase 1의 파일 계약을 그대로 API 응답 계약으로 재사용한다.

```text
Google 읽기 전용 API / 로컬 명령
              |
              v
       Local Harness Runner
       - 작업 단계 실행
       - 상태 전이
       - 안전한 재시도
       - 승인 대기
       - 감사 로그
              |
              v
 reports/private/runs/<runId>/
       - manifest.json
       - events.jsonl
       - snapshot.json
       - artifacts/*.md
              |
       수동 파일 불러오기
              |
              v
       업무 관제탑 React UI
```

이 방식은 현재 Vite 클라이언트 구조를 유지하고 별도 서버와 신규 의존성을 만들지 않는다. 파일 스냅샷은 장애 조사와 실행 이력 보존에도 유리하다.

## MVP에서 Playwright를 제외하는 이유

두 작업은 로컬 Node 코드와 공식 Google API로 완료할 수 있으므로 브라우저 자동 조작이 필요하지 않다. Playwright를 런타임에 포함하면 로그인 세션, 화면 변경, 타임아웃, CAPTCHA 같은 실패 요인이 늘어난다.

Playwright는 다음 경우에만 후속 도입한다.

- 관제탑 UI의 개발·회귀 테스트
- 공식 API가 없는 웹사이트에서 사용자가 승인한 읽기 작업
- 사용자 화면과 동일한 경로를 검증해야 하는 제한적 시나리오

## 실행 단위와 디렉터리

각 실행은 충돌하지 않는 `runId`를 가진다.

```text
run-YYYYMMDD-HHmmss-<shortId>
```

출력 구조는 다음과 같다.

```text
reports/private/
  runs/
    <runId>/
      manifest.json
      events.jsonl
      snapshot.json
      artifacts/
        daily-briefing.md
        agent-office-report.md
  control-tower-latest.json
```

- `manifest.json`: 실행 요청, 작업 종류, 시작·종료 시각, 최종 상태
- `events.jsonl`: 상태 전이와 오류를 한 줄 한 이벤트로 추가 기록
- `snapshot.json`: 관제탑 UI가 읽는 정제된 데이터
- `artifacts/`: 사람이 검토할 Markdown 산출물
- `control-tower-latest.json`: 가장 최근 스냅샷의 복사본

Windows 호환성을 위해 최신 스냅샷은 심볼릭 링크 대신 임시 파일 작성 후 이름을 바꾸는 방식으로 교체한다.

## 상태 모델

실행과 단계는 다음 상태를 사용한다.

```text
QUEUED
RUNNING
WAITING_APPROVAL
SUCCEEDED
NEEDS_ATTENTION
FAILED
CANCELLED
```

주요 전이는 다음과 같다.

```text
QUEUED -> RUNNING
RUNNING -> WAITING_APPROVAL
RUNNING -> NEEDS_ATTENTION
RUNNING -> FAILED
WAITING_APPROVAL -> SUCCEEDED
WAITING_APPROVAL -> NEEDS_ATTENTION
```

MVP의 승인은 외부 작업을 실행하지 않는다. 사용자가 산출물을 확인하고 승인 상태를 관제탑에 기록하면 해당 실행을 `SUCCEEDED`로 확정할 수 있다. 스냅샷 수동 불러오기 구조에서는 승인 상태를 브라우저 로컬 저장소에 보관하며 원본 실행 기록은 변경하지 않는다.

## 재시도와 오류 처리

자동 재시도는 같은 입력으로 다시 실행해도 부작용이 없는 단계에만 적용한다.

- 허용: 읽기 전용 API 조회, 템플릿 기반 초안 생성, 스냅샷 파일 생성
- 최대 횟수: 최초 실행 이후 2회
- 대기: 짧은 지수 백오프
- 금지: 인증 오류, 설정 누락, 스키마 검증 실패, 사용자 입력 오류

재시도 금지 오류는 `NEEDS_ATTENTION`으로 전환하고 해결 방법을 한글로 기록한다. 모든 재시도가 실패한 일시적 오류는 `FAILED`로 전환한다. 무한 재시도는 허용하지 않는다.

## 작업 정의

### daily-briefing

기존 `scripts/agent-office/daily-briefing.mjs`의 읽기 전용 흐름을 하네스 단계로 감싼다.

```text
입력 검증
-> OAuth 및 설정 확인
-> Calendar/Gmail/Sheets 조회
-> 업무 후보 정규화
-> 우선순위·위험 판정
-> Daily Briefing 생성
-> 관제용 데이터 정제
-> 승인 대기 스냅샷 생성
```

기존 브리핑 생성 로직을 재사용하고 하네스는 상태와 실행 기록만 책임진다.

### agent-office-command

사용자 명령을 템플릿 기반으로 처리한다.

```text
명령 검증
-> 작업 분해
-> 에이전트 배정
-> 에이전트별 초안 생성
-> 최종 보고 생성
-> 관제용 데이터 정제
-> 승인 대기 스냅샷 생성
```

MVP는 무료·로컬 실행이 가능한 규칙 기반 모드를 기본값으로 사용한다. 실제 LLM 호출은 기존 모델 라우터 또는 향후 provider adapter를 통해 추가하되 하네스 상태 계약은 바꾸지 않는다.

## 스냅샷 계약

관제탑에 전달할 스냅샷은 다음 정보를 포함한다.

```ts
type ControlTowerSnapshot = {
  schemaVersion: "1.0";
  generatedAt: string;
  run: {
    id: string;
    jobType: "daily-briefing" | "agent-office-command";
    status: HarnessStatus;
    startedAt: string;
    finishedAt?: string;
    summary: string;
  };
  steps: HarnessStepSummary[];
  alerts: HarnessAlert[];
  approvals: ApprovalItem[];
  artifacts: ArtifactRef[];
  sources: SanitizedSourceRef[];
};
```

스냅샷에는 다음 정보를 넣지 않는다.

- OAuth access token과 refresh token
- API 키와 환경변수 값
- Gmail 본문 전문과 첨부파일
- 주민 개인정보와 비공개 연락처
- 로컬 비밀 파일의 절대 경로

메일과 일정은 제목, 분류, 시각, 원본 링크 등 업무 판단에 필요한 최소 정보만 포함한다. 민감할 가능성이 있는 문자열은 산출 전에 마스킹한다.

## 관제탑 UI

기존 메뉴 패턴을 따라 `AI 운영` 범주에 `업무 관제탑` 화면을 연결한다.

화면은 다음 순서로 구성한다.

1. 스냅샷 불러오기와 마지막 갱신 시각
2. 실행 상태 요약: 진행 중, 승인 대기, 확인 필요, 완료
3. 주의 항목과 승인 대기 항목
4. 단계별 실행 이력
5. 산출물 요약과 기존 `AI 사무국`, `승인함` 이동 동선

파일 선택과 드래그 앤 드롭을 지원하고 JSON 스키마를 검증한다. 정상 스냅샷만 브라우저 로컬 저장소에 보관하며 사용자가 삭제할 수 있다. 잘못된 파일은 원인을 한국어로 보여주고 기존 정상 스냅샷을 유지한다.

## CLI 인터페이스

하네스는 한 번에 한 작업을 명시적으로 실행한다.

```bash
npm run office:harness -- --job daily-briefing
npm run office:harness -- --job daily-briefing --mock
npm run office:harness -- --job agent-office-command --command "다음 주 동아리 홍보 콘텐츠 기획해줘"
```

명령 누락, 지원하지 않는 작업, 필수 설정 누락은 명확한 사용법과 함께 실패한다. 민감한 명령 문자열은 이벤트 로그에 전문으로 반복 저장하지 않고 요약 또는 해시를 사용한다.

## 테스트 전략

- 상태 전이와 금지 전이를 단위 테스트한다.
- 재시도 가능 오류와 즉시 확인 필요 오류를 구분하는 테스트를 작성한다.
- 두 작업을 mock 입력으로 끝까지 실행해 파일 세트를 검증한다.
- 스냅샷 스키마 검증과 민감정보 제외를 테스트한다.
- UI에서 정상 파일, 잘못된 JSON, 다른 버전 스냅샷을 검증한다.
- 기존 `npm run office:test`, `npm run check`, `npm run build`를 모두 통과시킨다.

Playwright E2E는 MVP 필수 검증에 포함하지 않는다. 현재 프로젝트의 테스트 도구로 로직과 렌더링을 검증하고, 필요할 때 별도 개발 테스트로 추가한다.

## 범위 제외

- Gmail 자동 발송
- Calendar·Drive·Sheets 쓰기
- 외부 사이트 자동 게시·제출
- 자동 승인
- 장기 실행 서버와 큐 시스템
- 실시간 WebSocket 상태 전송
- Playwright 기반 런타임 자동화
- 두 작업 이외의 범용 작업 플러그인

## Phase 2 확장 지점

파일 스냅샷 계약을 유지한 채 로컬 sidecar API를 추가한다.

- `POST /runs`: 작업 시작
- `GET /runs/:id`: 상태 조회
- `GET /runs/:id/snapshot`: 관제 데이터 조회
- `POST /runs/:id/approval`: 산출물 승인 또는 보류
- Server-Sent Events 또는 짧은 폴링으로 상태 갱신

sidecar는 loopback 주소에만 바인딩하고 임의 외부 접근을 허용하지 않는다. 실제 외부 쓰기 기능이 필요해질 경우 작업별 권한, 재확인, 감사 로그를 별도 설계한 뒤 추가한다.

## 완료 기준

- 두 작업이 동일한 하네스 상태 모델로 실행된다.
- 각 실행마다 manifest, event log, snapshot, Markdown 산출물이 생성된다.
- 관제탑에서 스냅샷을 수동으로 불러오면 상태와 승인 대기 항목이 한국어로 보인다.
- 외부 발송·수정 없이 승인과 보류를 로컬에서 기록할 수 있다.
- 토큰, API 키, 메일 전문, 개인정보가 Git과 관제 스냅샷에 포함되지 않는다.
- 기존 AI 사무국과 Daily Briefing 기능이 회귀 없이 동작한다.
