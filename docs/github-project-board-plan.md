# GitHub Project Board 설계

현재 Codex 세션에서는 GitHub Projects를 직접 생성할 수 있는 도구가 노출되어 있지 않다. 따라서 이 문서는 GitHub에서 수동으로 Project Board를 만들 때 그대로 옮길 수 있는 설계안이다.

## 1. 보드 이름

```text
AI Local Creator Operating System
```

## 2. 보드 목적

AI 로컬기획 사무국의 PRD, Phase 구현, 자동화, 에이전트 프롬프트, 운영 실험을 한 곳에서 추적한다.

## 3. 추천 뷰

- Roadmap: Phase별 진행 상황
- Kanban: 작업 상태 관리
- Backlog: 나중에 할 아이디어
- Automation: GitHub Actions, Gmail, Drive, n8n 관련 작업
- Prompts: 에이전트별 프롬프트 개선 작업

## 4. 추천 필드

- Status: Backlog / Ready / In Progress / Review / Done
- Phase: Phase 1 / Phase 2 / Phase 3 / Phase 4
- Area: Frontend / Agent Engine / Prompt / Automation / Docs / Security
- Priority: P0 / P1 / P2
- Risk: Low / Medium / High
- Owner: Daehun / Codex

## 5. 초기 이슈 목록

### Phase 1

- AI 사무국 탭 안정화
- 에이전트별 prompt 파일과 `agentRoles.ts` 동기화
- 아침 보고서 복사 UX 개선
- 기존 15개 탭 회귀 테스트

### Phase 2

- `scripts/agent-office/run.mjs` 설계
- reports 저장 형식 확정
- GitHub Actions 백그라운드 실행 설계
- GitHub Contents API로 보고서 열람

### Phase 3

- `callLLM()` 실제 API 연동
- API 실패 시 simulation fallback
- 비용 상한과 호출 횟수 제한
- LLM 응답 품질 평가 기준

### Phase 4

- 야간 자동 보고
- Gmail/Slack/Telegram/Notion 보고 채널 설계
- Google Drive 장기 기억
- Playwright 기반 업무 보조 실험

## 6. 생성 절차

1. GitHub 저장소 `planning-copilot`으로 이동
2. Projects 탭 또는 GitHub Projects 페이지 열기
3. New project 선택
4. Board 또는 Table 선택
5. 이름을 `AI Local Creator Operating System`으로 지정
6. 위 필드와 초기 이슈를 추가
7. 레포 이슈와 PR을 프로젝트에 연결
