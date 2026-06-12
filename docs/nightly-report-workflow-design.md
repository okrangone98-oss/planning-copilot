# 야간 보고 Workflow 설계

이 문서는 AI 로컬기획 사무국의 야간 자동 실행과 아침 보고를 설계하기 위한 문서다. 현재 단계에서는 설계만 작성하며 `.github/workflows` 파일은 만들지 않는다.

## 1. 목적

매일 밤 사용자의 반복 업무를 자동으로 정리하고, 다음 날 아침에 바로 볼 수 있는 보고서를 생성한다.

야간 실행의 목표는 “사용자가 자는 동안 초안을 만들어 두는 것”이며, 외부 발송이나 게시까지 자동화하지 않는다.

## 2. 실행 시간

권장 시간:

- 야간 작업 시작: 매일 01:00 KST
- 아침 보고 준비: 매일 07:00 KST

GitHub Actions cron 기준:

```yaml
# 01:00 KST = 16:00 UTC 전날
- cron: "0 16 * * *"

# 07:00 KST = 22:00 UTC 전날
- cron: "0 22 * * *"
```

GitHub Actions cron은 지연될 수 있으므로 정확한 알람 용도로 쓰지 않는다.

## 3. 야간 작업 후보

- 공모사업 조사
- 정책자료 조사
- 블로그 초안 작성
- SNS 초안 작성
- 메일 초안 작성
- 행정문서 초안 작성
- 다음 날 우선순위 제안
- 최근 reports 요약

## 4. 입력 데이터

초기에는 레포 안의 설정 파일을 사용한다.

권장 파일:

```text
automation/nightly-office.config.json
```

예시 구조:

```json
{
  "mode": "simulation",
  "timezone": "Asia/Seoul",
  "dailyKeywords": ["농촌 정책", "로컬 콘텐츠", "공모사업", "AI 자동화"],
  "defaultCommand": "내일 아침 로컬기획 사무국 보고서를 만들어줘",
  "maxAgentRuns": 7,
  "allowExternalSend": false
}
```

## 5. 출력 데이터

권장 저장 위치:

```text
reports/nightly/YYYY-MM-DD-morning-report.md
```

보고서 구성:

- 공개 저장소 주의 문구
- 오늘의 핵심 3가지
- 에이전트별 산출물 요약
- 공모/정책/콘텐츠 기회
- 메일·행정문서 초안 링크 또는 본문
- 다음 액션 체크리스트

## 6. GitHub Actions 설계안

향후 별도 PR에서 다음 워크플로우를 만든다.

파일 후보:

```text
.github/workflows/nightly-agent-office.yml
```

권장 job:

1. checkout
2. setup-node
3. npm ci
4. npm run check 또는 agent-office 전용 타입 체크
5. `node scripts/agent-office/nightly.mjs` 실행
6. reports 파일 생성
7. 변경사항 커밋
8. Issue 또는 Discussions에 요약 댓글 작성 optional

## 7. 보안 원칙

- 자동 이메일 발송 금지
- SNS 자동 게시 금지
- 공문 자동 제출 금지
- 민감정보 reports 커밋 금지
- API 키는 GitHub Secrets로만 주입
- API 키가 없어도 simulation 모드로 성공해야 함

## 8. Phase별 적용

### Phase 1

- 웹앱 내 수동 실행
- simulation mode
- workflow 생성 없음

### Phase 2

- GitHub Actions 야간 workflow 추가
- reports 자동 생성
- Issue 댓글 또는 GitHub Pages에서 확인

### Phase 3

- LLM API 선택 연결
- 실패 시 simulation fallback
- 비용 상한, timeout, max token 제한

### Phase 4

- Gmail, Slack, Telegram, Notion 보고 연동
- 단, 자동 발송은 명시 승인 기반으로만 확장
