# Agent Office Scripts

이 폴더는 향후 로컬/야간 자동화 실행 스크립트를 둘 자리다.

현재 원칙:

- 실행 결과 초안은 기본적으로 `private/` 또는 `reports/private/`에 저장한다.
- GitHub에 커밋할 보고서는 사용자가 검토한 뒤 공개 가능한 내용만 남긴다.
- 자동 메일 발송, SNS 게시, 공문 제출은 구현하지 않는다.

## Daily Google Workspace Briefing

Run `npm run office:briefing` for live Desktop OAuth reads, or `npm run office:briefing -- --mock` for local sample data only. The runner creates one private `reports/private/YYYY-MM-DD-daily-briefing.md` file and logs only collection counts and its output path.

OAuth client-secret and token paths must remain outside this repository (`GOOGLE_OAUTH_CLIENT_SECRET_PATH`, `GOOGLE_OAUTH_TOKEN_PATH`). It requests only Gmail, Calendar, Drive, and Sheets read-only scopes. It never creates, modifies, sends, uploads, or deletes Google Workspace data. See `docs/google-workspace-briefing.md` for setup, spreadsheet-title fallback, and alias configuration.

## Local Harness and Control Tower

The harness currently accepts two job types:

~~~sh
npm run office:harness -- --job daily-briefing --mock
npm run office:harness -- --job daily-briefing
npm run office:harness -- --job agent-office-command --command "홍보 콘텐츠 기획"
npm run office:test
~~~

The first command uses local fixtures; the second performs read-only Google OAuth access. The AI office command runs with the simulation templates and does not call an LLM. Each run writes a private manifest, append-only events, Markdown artifact, and sanitized snapshot under reports/private/runs/<run-id>/. Import snapshot.json in the app's 업무 관제탑 tab to review the run. Browser approvals are local notes only and do not execute or publish anything.

Run state contracts and persistence are under lib/. Each supported job has one adapter under jobs/. A future job must provide an adapter, keep inputs and outputs within the snapshot allowlist, and include node:test coverage before being added to the CLI allowlist. Retryable errors must use RetryableStepError; only those errors retry, at most twice after the initial attempt.

The harness writes only local files. It does not send email or write to Calendar, Drive, Sheets, or external publishing services. See docs/agent-office-harness.md for operator instructions and docs/google-workspace-briefing.md for Windows/WSL OAuth setup.
