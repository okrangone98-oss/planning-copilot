# Google Workspace Daily Briefing

`npm run office:briefing` reads Calendar, Gmail, Drive, and Sheets through a local Desktop OAuth client and writes one Markdown briefing. It does not create, modify, send, upload, or delete Google Workspace data.

## Setup

1. In Google Cloud, enable the Gmail API, Google Calendar API, Google Drive API, and Google Sheets API.
2. Create a **Desktop** OAuth client and download its client-secret JSON.
3. Keep the client secret and OAuth token outside this repository. For example:

   ```sh
   export GOOGLE_OAUTH_CLIENT_SECRET_PATH="$HOME/.config/planning-copilot/google-oauth-client.json"
   export GOOGLE_OAUTH_TOKEN_PATH="$HOME/.config/planning-copilot/google-oauth-token.json"
   ```

4. Optionally set `PROJECT_STATE_SPREADSHEET_ID`. Without it, the reader uses the exact spreadsheet-title fallback `26 양터 전체사업 총괄표`.
5. Set `PROJECT_ALIAS_CONFIG_PATH` when the aliases differ from `automation/project-aliases.example.json`.
6. Run `npm run office:briefing`, then complete the browser approval when prompted.

The requested scopes are Gmail, Calendar, Drive, and Sheets `readonly` scopes only. No Write Scope is requested. The report is private by default at `reports/private/YYYY-MM-DD-daily-briefing.md`; review it before sharing.

## Windows PowerShell

When running the repository from Windows, place the downloaded Desktop OAuth JSON outside the repository, for example at %USERPROFILE%\.planning-copilot\google-oauth-client.json. Then set both paths in the same PowerShell session:

~~~powershell
$oauthDir = Join-Path $env:USERPROFILE ".planning-copilot"
New-Item -ItemType Directory -Force -Path $oauthDir | Out-Null
$env:GOOGLE_OAUTH_CLIENT_SECRET_PATH = Join-Path $oauthDir "google-oauth-client.json"
$env:GOOGLE_OAUTH_TOKEN_PATH = Join-Path $oauthDir "google-oauth-token.json"
Test-Path $env:GOOGLE_OAUTH_CLIENT_SECRET_PATH
npm run office:briefing
~~~

Test-Path must return True. The OAuth token file and its parent directory are created after browser authorization succeeds. Reapply the environment variables in a new PowerShell session.

## WSL

When running from WSL, the client JSON can stay outside the repository on the mounted Windows profile. Replace WINDOWS_USER with the Windows profile directory name and place the JSON at the resulting path:

~~~sh
WINDOWS_USER="Windows-프로필-폴더명"
OAUTH_DIR="/mnt/c/Users/$WINDOWS_USER/.planning-copilot"
mkdir -p "$OAUTH_DIR"
export GOOGLE_OAUTH_CLIENT_SECRET_PATH="$OAUTH_DIR/google-oauth-client.json"
export GOOGLE_OAUTH_TOKEN_PATH="$HOME/.config/planning-copilot/google-oauth-token.json"
test -f "$GOOGLE_OAUTH_CLIENT_SECRET_PATH" && echo "OAuth 클라이언트 파일 확인됨"
npm run office:briefing
~~~

Run the command in the same terminal session as the exports. The token directory is created automatically. The repository does not automatically load a .env file. Never commit or share the client JSON or token JSON.

## Commands

```sh
npm run office:briefing
npm run office:briefing -- --mock
npm run office:test
```

`--mock` uses only local sample fixtures and does not start OAuth or call Google APIs. It is intended for development and test verification.
