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

## Commands

```sh
npm run office:briefing
npm run office:briefing -- --mock
npm run office:test
```

`--mock` uses only local sample fixtures and does not start OAuth or call Google APIs. It is intended for development and test verification.
