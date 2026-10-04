# AI 사무국 하네스 운영 안내

이 안내는 로컬 하네스를 실행하고, 결과를 관제탑에서 검토하는 방법을 설명합니다. 현재 실행 가능한 작업은 아래 두 가지로 제한됩니다.

- Google Workspace 아침 보고: Gmail·Calendar·Drive·Sheets 읽기 전용 조회
- AI 사무국 명령: 템플릿 기반으로 작업 분해, 초안, 보고서 생성

## 시작 전 확인

저장소 루트에서 실행합니다. 하네스는 Node.js 기반이며 새 패키지가 필요하지 않습니다.

~~~sh
npm install
npm run office:test
~~~

## 작업 실행

### 샘플 데이터로 아침 보고서 만들기

실제 Google 계정이나 OAuth 자격 증명을 사용하지 않는 로컬 검증 모드입니다.

~~~sh
npm run office:harness -- --job daily-briefing --mock
~~~

### 실제 Google Workspace 자료로 아침 보고서 만들기

Google Cloud Desktop OAuth 설정 후 아래처럼 실행합니다.

~~~sh
npm run office:harness -- --job daily-briefing
~~~

이 명령은 읽기 전용 OAuth 범위만 사용합니다. 첫 실행에서는 브라우저에서 Google 계정 접근을 승인해야 합니다.

### AI 사무국 명령 실행

~~~sh
npm run office:harness -- --job agent-office-command --command "다음 주 의기양양 두레동아리 홍보 콘텐츠 기획해줘"
~~~

현재 AI 사무국 명령은 API 호출 없이 템플릿·규칙 기반 시뮬레이션으로 실행됩니다.

## 결과 확인

각 실행 결과는 Git 추적 대상이 아닌 개인용 reports/private/runs/<실행 ID>/ 디렉터리에 저장됩니다.

- manifest.json: 실행 종류, 상태, 재시도 횟수 등
- events.jsonl: 단계별 상태 이벤트
- snapshot.json: 관제탑에서 가져오는 정제된 요약 데이터
- artifacts/: Markdown 보고서와 작업 산출물

Google Workspace 아침 보고서는 기존 실행기와 호환되는 날짜별 Markdown 파일도 reports/private/에 생성합니다.

1. 앱의 업무 관제탑 탭을 엽니다.
2. 해당 실행 폴더의 snapshot.json을 선택하거나 화면에 끌어 놓습니다.
3. 실행 상태, 단계, 경고, 산출물, 출처와 승인 항목을 확인합니다.
4. 승인 기록 또는 보류 기록은 현재 브라우저의 localStorage에만 저장됩니다.

관제탑의 승인 기록은 실행을 재개하거나 외부로 전달하지 않습니다. 이메일 발송, Calendar·Drive·Sheets 수정, 공문 제출, SNS 게시 기능은 없습니다. 외부 작업은 지원되지 않습니다.

## 상태와 재시도

- WAITING_APPROVAL: 산출물을 만들었으며 사용자가 검토할 차례입니다.
- NEEDS_ATTENTION: 인증·설정 또는 일반 오류를 확인해야 합니다.
- FAILED: 재시도 가능 단계가 정해진 횟수만큼 실패했습니다.
- 재시도는 작업 코드가 명시적으로 재시도 가능하다고 분류한 단계만 최초 실행 이후 최대 2회입니다.
- 명령 내용은 로컬 파일이나 이벤트 로그에 원문으로 저장하지 않고, 실행 manifest에는 지문만 기록합니다.

## OAuth 파일 준비 및 환경변수

실제 Google 자료를 읽을 때만 필요합니다. 먼저 Google Cloud에서 Gmail API, Calendar API, Drive API, Sheets API를 활성화하고 **Desktop app 유형** OAuth 클라이언트를 만듭니다. 내려받은 JSON은 저장소 바깥에 두고, 파일 내용을 Codex 대화나 GitHub에 올리지 마세요.

### Windows PowerShell

아래는 Windows에서 저장소를 실행할 때의 예시입니다. OAuth JSON을 지정 경로로 옮긴 뒤, 같은 PowerShell 창에서 명령을 실행합니다.

~~~powershell
$oauthDir = Join-Path $env:USERPROFILE ".planning-copilot"
New-Item -ItemType Directory -Force -Path $oauthDir | Out-Null
$env:GOOGLE_OAUTH_CLIENT_SECRET_PATH = Join-Path $oauthDir "google-oauth-client.json"
$env:GOOGLE_OAUTH_TOKEN_PATH = Join-Path $oauthDir "google-oauth-token.json"
Test-Path $env:GOOGLE_OAUTH_CLIENT_SECRET_PATH
npm run office:harness -- --job daily-briefing
~~~

Test-Path 결과가 True여야 합니다. 토큰 파일은 첫 브라우저 인증이 성공하면 프로그램이 생성합니다. 환경변수는 현재 PowerShell 세션에만 적용됩니다.

### WSL 터미널

저장소가 WSL에서 실행 중이면 아래처럼 쓸 수 있습니다. WINDOWS_USER를 Windows 사용자 프로필 폴더명으로 바꾸고, 내려받은 JSON을 지정 경로로 옮깁니다.

~~~sh
WINDOWS_USER="Windows-프로필-폴더명"
OAUTH_DIR="/mnt/c/Users/$WINDOWS_USER/.planning-copilot"
mkdir -p "$OAUTH_DIR"
export GOOGLE_OAUTH_CLIENT_SECRET_PATH="$OAUTH_DIR/google-oauth-client.json"
export GOOGLE_OAUTH_TOKEN_PATH="$HOME/.config/planning-copilot/google-oauth-token.json"
test -f "$GOOGLE_OAUTH_CLIENT_SECRET_PATH" && echo "OAuth 클라이언트 파일 확인됨"
npm run office:harness -- --job daily-briefing
~~~

토큰 파일의 상위 디렉터리는 인증 과정에서 자동 생성됩니다. WSL 명령도 같은 터미널 세션에서 실행해야 합니다. 새 터미널을 열면 환경변수를 다시 설정하세요. 저장소 루트의 .env 파일은 자동으로 읽지 않습니다.

환경변수 이름만 설정 여부를 확인하려면 값을 출력하지 않고 아래처럼 점검할 수 있습니다.

~~~sh
test -n "$GOOGLE_OAUTH_CLIENT_SECRET_PATH" && echo "클라이언트 경로 설정됨" || echo "클라이언트 경로 미설정"
test -n "$GOOGLE_OAUTH_TOKEN_PATH" && echo "토큰 경로 설정됨" || echo "토큰 경로 미설정"
~~~

### 인증 또는 설정 오류가 난 경우

- 클라이언트 JSON 경로가 맞는지, 파일이 실제로 존재하는지 확인합니다.
- 이 값은 Google Cloud의 Desktop OAuth client 파일 경로여야 합니다. API 키 파일이나 서비스 계정 JSON은 맞지 않습니다.
- 두 환경변수가 현재 터미널에 설정돼 있는지 확인합니다. 경로 값 자체를 공개 채팅이나 로그에 붙여 넣지 않아도 됩니다.
- Google 계정 승인 화면이 열리지 않으면 명령을 실행한 터미널의 인증 URL 안내를 확인하고, 같은 컴퓨터의 브라우저에서 여세요.
- OAuth scope는 Gmail, Calendar, Drive, Sheets의 readonly 범위입니다. 쓰기 권한은 요청하지 않습니다.

## 개인 파일 정리

- 앱의 기록 지우기는 브라우저 localStorage에 저장한 관제탑 snapshot과 승인 overlay만 삭제합니다.
- 로컬 실행 결과까지 지우려면 reports/private/runs 안에서 확인한 실행 ID 폴더와 날짜별 briefing을 사용자가 직접 검토한 뒤 삭제합니다.
- OAuth 클라이언트와 토큰 파일은 저장소 밖의 지정 폴더에서 별도로 관리합니다.
- reports/private를 GitHub에 커밋하거나 공개 폴더로 복사하지 않습니다.

## 개발 참고

job 추가와 상태 계약은 현재 두 작업 범위 안에서만 수정합니다. job adapter, 실행기, 저장소는 scripts/agent-office/에 있고 snapshot schema를 바꾸면 validator, 타입, Node 테스트와 UI를 함께 갱신해야 합니다. Phase 2에서 실제 LLM이나 scheduler를 붙일 때도 OAuth 읽기 작업과 외부 쓰기 작업은 별도 승인 경계로 유지합니다.

상세 설계와 개발자 설명은 docs/superpowers/specs/2026-09-24-control-tower-harness-design.md, docs/superpowers/plans/2026-09-24-control-tower-harness.md, scripts/agent-office/README.md를 참고하세요.
