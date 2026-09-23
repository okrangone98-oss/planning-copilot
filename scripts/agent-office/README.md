# Agent Office Scripts

이 폴더는 향후 로컬/야간 자동화 실행 스크립트를 둘 자리다.

현재 원칙:

- 실행 결과 초안은 기본적으로 `private/` 또는 `reports/private/`에 저장한다.
- GitHub에 커밋할 보고서는 사용자가 검토한 뒤 공개 가능한 내용만 남긴다.
- 자동 메일 발송, SNS 게시, 공문 제출은 구현하지 않는다.

## Daily Google Workspace Briefing

Run `npm run office:briefing` for live Desktop OAuth reads, or `npm run office:briefing -- --mock` for local sample data only. The runner creates one private `reports/private/YYYY-MM-DD-daily-briefing.md` file and logs only collection counts and its output path.

OAuth client-secret and token paths must remain outside this repository (`GOOGLE_OAUTH_CLIENT_SECRET_PATH`, `GOOGLE_OAUTH_TOKEN_PATH`). It requests only Gmail, Calendar, Drive, and Sheets read-only scopes. It never creates, modifies, sends, uploads, or deletes Google Workspace data. See `docs/google-workspace-briefing.md` for setup, spreadsheet-title fallback, and alias configuration.
