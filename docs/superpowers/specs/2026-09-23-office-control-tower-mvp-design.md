# 사무국장 업무 관제탑 Agent MVP 설계

## 상태

- 승인 상태: 사용자 승인 완료
- 설계일: 2026-09-23
- 구현 대상: `G:\02_AI에이전트\planning-copilot-master`

## 목표

기존 `planning-copilot` 구조를 유지하면서, 개인 Google 계정으로 OAuth 인증한 뒤 Gmail, Google Calendar, Google Drive, Google Sheets의 원본 데이터를 읽고 하나의 Daily Briefing을 생성한다.

MVP는 실제 Google Workspace 데이터를 기준으로 동작해야 한다. Mock 데이터는 개발·테스트용으로만 사용하며 최종 검증은 실제 OAuth 연결로 수행한다.

## 범위

### 포함

- 오늘 Calendar 일정 조회
- 현재 시각 기준 향후 7일 Calendar 일정 조회
- 현재 시각 기준 향후 30일 주요 행사 조회
- 최근 48시간 Gmail 조회
- 업무성 메일과 일반 메일 분류
- 회신·확인이 필요한 메일 후보 추출
- `26 양터 전체사업 총괄표` 조회
- 주요 사업명·일정·상태 읽기
- Project alias 기반 `projectId` 연결
- 프로젝트 `NORMAL`, `WARNING`, `RISK` 판정
- 오늘의 핵심 업무 3건 생성
- 이번 주 마감업무 생성
- 주의 사업 생성
- 회신·확인 필요 이메일 생성
- 향후 30일 주요 행사 생성
- Daily Briefing Markdown 생성
- 모든 후보의 source 정보 유지

### 제외

- Gmail 발송
- Calendar 생성·수정·삭제
- Google Sheets 값 수정
- Google Drive 파일 수정·삭제
- Jira 연결 및 상태 변경
- Agent 자체 DB를 원본으로 사용하는 기능
- 브라우저 번들에 OAuth refresh token을 넣는 기능
- 자동 실행·자동 승인·자동 게시

## 현재 프로젝트와의 정합성

현재 저장소는 Vite, React, TypeScript 기반의 클라이언트 앱이다. 이미 `googleapis`, `dotenv`, `scripts/agent-office/`, `private/`, `reports/private/` 구조와 Agent Office 시뮬레이션 흐름이 있다.

따라서 이번 MVP는 새 프레임워크나 서버 아키텍처를 추가하지 않고 다음 경계를 사용한다.

- 웹앱: 기존 관제·Agent Office UI 유지
- 로컬 Node 실행기: OAuth, Google API 조회, 판단, Briefing 파일 생성
- Google Workspace: 실행 시 조회하는 원본 데이터
- `reports/private/`: 실행 결과를 남기는 로컬 출력 위치

현재 웹앱은 브라우저 전용이므로 OAuth refresh token을 브라우저에 두지 않는다. `npm run office:briefing` 실행이 OAuth 흐름을 시작하고, 인증된 로컬 실행기가 실제 데이터를 읽어 Briefing을 생성한다.

## 아키텍처

```text
npm run office:briefing
        |
        v
OAuthUserProvider
        |
        v
Google OAuth 승인
        |
        v
읽기 전용 Google API client
  |          |           |
Gmail     Calendar   Drive/Sheets
  \          |           /
   \         |          /
    Context Normalizer
          |
  Project Alias Resolver
          |
  Priority / Risk Judge
          |
  Daily Briefing Renderer
          |
reports/private/YYYY-MM-DD-daily-briefing.md
```

인증은 비즈니스 로직과 분리한다.

```js
class OAuthUserProvider {
  async getAuthorizedClient() {}
}

class MockProvider {
  async getAuthorizedClient() {}
}

// 향후 필요할 때 같은 인터페이스로 추가
class ServiceAccountProvider {
  async getAuthorizedClient() {}
}
```

Reader는 특정 인증 구현을 직접 생성하지 않고 `AuthProvider`가 제공하는 인증 클라이언트를 받는다.

## OAuth 설계

초기 MVP의 기본 인증 구현은 `OAuthUserProvider`다.

최소 Scope는 다음과 같다.

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/spreadsheets.readonly
```

필요 환경변수는 다음과 같다.

```text
GOOGLE_OAUTH_CLIENT_SECRET_PATH
GOOGLE_OAUTH_TOKEN_PATH
GOOGLE_CALENDAR_ID=primary
PROJECT_STATE_SPREADSHEET_ID
PROJECT_STATE_SHEET_NAME
PROJECT_ALIAS_CONFIG_PATH
```

- Client Secret JSON은 저장소 밖의 경로를 사용한다.
- refresh token은 `GOOGLE_OAUTH_TOKEN_PATH`가 가리키는 저장소 밖의 파일에만 저장한다.
- 저장소에 실제 토큰, Client Secret, 개인 메일 본문을 추가하지 않는다.
- OAuth callback은 로컬 loopback 주소를 사용한다.
- 기존 유효 토큰이 있으면 재승인하지 않고 refresh token으로 갱신한다.
- 토큰이 없으면 승인 URL과 callback 대기 상태를 터미널에 표시한다.
- Write Scope는 요청하지 않는다.

## 공통 데이터 계약

모든 업무 후보는 원본 추적이 가능해야 한다.

```ts
type SourceRef = {
  sourceType: "gmail" | "calendar" | "drive" | "sheets";
  sourceId: string;
  sourceUrl: string;
  projectId?: string;
  detectedAt: string;
};
```

메일, 일정, 사업 상태, 생성된 업무는 이 `SourceRef`를 포함하거나 연결한다. `detectedAt`은 실행 시점의 ISO 문자열이며, 날짜 판단의 기준 시각과 혼동하지 않는다.

## Reader 설계

### CalendarAdapter

- Google Calendar API `events.list`를 읽기 전용으로 호출한다.
- 시간대는 `Asia/Seoul` 기준으로 계산한다.
- 오늘 범위는 해당 날짜 00:00부터 다음 날짜 00:00 직전까지다.
- 7일 범위는 오늘부터 7번째 날짜가 끝나는 시점까지다.
- 30일 범위는 오늘부터 30번째 날짜가 끝나는 시점까지다.
- 중복 이벤트는 Calendar event ID로 제거한다.
- 일정 제목, 시작·종료 시각, all-day 여부, 참석자 수, 설명 요약, HTML 링크를 정규화한다.
- 주요 행사는 all-day 일정, 2시간 이상 일정, 또는 설정된 주요 행사 키워드가 제목에 포함된 일정으로 선별한다.

### GmailAdapter

- Gmail API에서 현재 시각 기준 최근 48시간 메시지를 읽는다.
- 기본 조회에서 광고·프로모션·뉴스레터 후보를 제외할 수 있도록 Gmail label과 제목·발신자 규칙을 함께 사용한다.
- MVP에서는 메일을 발송하거나 라벨을 변경하지 않는다.
- 메시지 ID, thread ID, 제목, 발신자, 수신 시각, snippet, label, Gmail URL을 정규화한다.
- 동일 thread에서 같은 업무 후보가 여러 번 나오면 가장 최근 메시지를 대표로 사용한다.

분류 우선순위는 다음과 같다.

1. 광고·프로모션·뉴스레터·수신거부 안내 → `IGNORE`
2. 비용·견적·세금계산서·입금·예산 → `FINANCE`
3. 지원·신청·접수·공모 → `APPLICATION`
4. 취소·불참·변경 → `CANCELLATION`
5. 파일·첨부·자료·제출 → `DOCUMENT`
6. 일정·회의·행사·시간 → `SCHEDULE`
7. 회신·확인·검토·요청·답변 필요 → `ACTION_REQUIRED`
8. 답변 대기·회신 대기·확인 대기 → `WAITING`
9. 나머지 업무 관련 메일 → `REFERENCE`

규칙 간 충돌이 있으면 `ACTION_REQUIRED`, `WAITING`, `FINANCE`, `APPLICATION`, `CANCELLATION`, `DOCUMENT`, `SCHEDULE`, `REFERENCE`, `IGNORE` 순으로 업무 후보의 중요도를 계산하되, 광고·프로모션·뉴스레터는 항상 `IGNORE`로 고정한다.

### DriveSheetsAdapter

- `PROJECT_STATE_SPREADSHEET_ID`가 있으면 해당 ID를 우선 사용한다.
- ID가 없으면 Drive에서 파일명 `26 양터 전체사업 총괄표`를 검색한다.
- `PROJECT_STATE_SHEET_NAME`이 있으면 해당 탭을 사용하고, 없으면 첫 번째 탭을 사용한다.
- 첫 번째 행을 헤더로 보고 다음 의미의 헤더 변형을 찾는다.
  - 사업명: `사업명`, `사업`, `프로젝트`, `Project`
  - 일정: `일정`, `기간`, `마감`, `행사일`, `deadline`
  - 상태: `상태`, `진행상태`, `진행`, `status`
- 행마다 사업명·일정·상태를 정규화한다.
- Sheet URL과 spreadsheet ID를 `SourceRef`로 보존한다.
- 값 읽기 후 batchUpdate, values.update, permissions.create 등 쓰기 API를 호출하지 않는다.

## Project Identity

alias 매핑은 설정 파일로 관리한다. 기본 예시는 다음과 같다.

```json
{
  "P-WELCOME-2026": [
    "웰컴센터",
    "양양읍 웰컴센터",
    "웰컴문화",
    "KAN-49"
  ],
  "P-SHARE-2026": [
    "성과공유회",
    "모두의 동아리존",
    "KAN-51"
  ]
}
```

Resolver는 다음을 수행한다.

- 한글·영문 대소문자·공백·일부 구분기호를 정규화한다.
- 사업명, Calendar 제목, Gmail 제목과 본문 snippet에 alias가 포함되는지 확인한다.
- 여러 프로젝트가 동시에 매칭되면 가장 긴 alias를 우선한다.
- 매칭되지 않으면 `projectId`를 억지로 생성하지 않고 미지정 상태로 둔다.

## Priority와 Risk

완료로 판단되는 상태는 다음 값을 포함한다.

```text
완료, 완료함, 종료, done, completed, closed
```

완료 상태의 사업·업무는 신규 업무나 위험 항목으로 다시 생성하지 않는다.

프로젝트 상태 규칙:

- `NORMAL`: 아래 경고·위험 조건이 없음
- `WARNING`: 7일 이내 중요 일정, 회신 대기, 미확인 자료, 준비사항 미완료 중 하나 이상
- `RISK`: D-3 이하 핵심 업무 미완료, 외부 승인 미확보, 일정 충돌, 필수자료 누락 중 하나 이상
- 위험 조건과 경고 조건이 동시에 있으면 `RISK`

업무 중복 제거 키는 `projectId + normalized action + sourceType + sourceId`를 기본으로 하고, 서로 다른 원본에 같은 업무가 나타나면 하나의 업무에 여러 SourceRef를 연결한다.

오늘의 핵심 업무 3건은 다음 정렬 기준을 사용한다.

1. `RISK` 프로젝트
2. D-day가 가까운 미완료 업무
3. `ACTION_REQUIRED` 또는 `WAITING` 업무 메일
4. 오늘 Calendar 일정과 직접 연결된 업무
5. 원본 발생 시각이 최신인 업무

동점이면 사업명과 source ID의 정렬로 결과를 결정해 실행마다 같은 순서를 유지한다.

## Daily Briefing 출력

출력 파일은 다음 위치에 생성한다.

```text
reports/private/YYYY-MM-DD-daily-briefing.md
```

보고서 구조:

```markdown
# 오늘 업무 브리핑

- 생성 시각:
- 데이터 기준 시각:
- 읽기 모드: OAuth 사용자 인증

## 오늘의 핵심 업무 3건

## 오늘 일정

## 이번 주 마감업무

## 회신/확인 필요한 이메일

## 주의 사업

## 향후 30일 주요 행사

## 데이터 수집 요약

## 확인 필요 및 한계
```

각 항목에는 가능한 경우 프로젝트 ID와 원본 링크를 함께 표시한다. 보고서에 메일 본문 전체를 복제하지 않고 제목·발신자·snippet 요약만 사용한다.

## Human Approval 경계

MVP의 실행기는 읽기와 브리핑 파일 생성만 수행한다.

- 메일 발송 함수 없음
- Calendar 수정 함수 없음
- Sheets 쓰기 함수 없음
- Drive 수정 함수 없음
- Jira 변경 함수 없음

향후 Write Scope나 외부 실행을 추가할 때는 별도 승인 모델과 실행 도구를 먼저 설계한다.

## 테스트와 검증

### 자동 테스트

- MockProvider가 Reader 계약을 만족하는지 확인
- Calendar의 오늘·7일·30일 날짜 경계 확인
- Gmail 48시간 경계 확인
- 뉴스레터·광고·프로모션의 `IGNORE` 분류 확인
- 업무 메일 카테고리 분류 확인
- alias가 올바른 `projectId`로 연결되는지 확인
- 동일 업무 중복 제거 확인
- 완료 상태가 신규 업무로 생성되지 않는지 확인
- D-3, D-7 경계의 Risk/Warning 판정 확인
- Daily Briefing 필수 섹션과 source 링크 확인

### 실제 OAuth 검증

1. Client Secret과 빈 token path를 저장소 밖에 준비한다.
2. `npm run office:briefing`을 실행한다.
3. Google OAuth 승인 화면에서 4개 read-only Scope를 승인한다.
4. 실제 Gmail·Calendar·Drive·Sheets 조회 성공 여부를 확인한다.
5. `26 양터 전체사업 총괄표`가 실제로 선택되는지 확인한다.
6. 실제 Daily Briefing이 생성되는지 확인한다.
7. 실행 전후 Google Workspace 원본의 변경 내역이 없는지 확인한다.
8. Gmail 업무 메일과 뉴스레터가 구분되는지 확인한다.
9. 동일 업무가 중복 생성되지 않는지 확인한다.

실제 OAuth 자격증명이나 개인 데이터는 저장소·로그·테스트 fixture에 포함하지 않는다.

## 남은 한계

- 현재 웹앱은 클라이언트 전용이므로 브라우저 안에서 로컬 Node 실행기를 직접 호출하지 않는다.
- MVP의 실제 생성 경로는 로컬 CLI와 Markdown 파일이다.
- Google 계정의 언어·라벨·메일 제목 표현에 따라 Gmail 규칙을 추가 조정할 수 있다.
- Sheet 컬럼 구조가 예상 헤더와 다르면 환경변수나 설정으로 명시해야 한다.
- alias에 없는 신규 사업은 자동으로 프로젝트를 생성하지 않는다.
- Jira는 연결하지 않는다.
