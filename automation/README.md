# Automation

이 폴더는 AI 로컬기획 사무국의 자동화 설정 샘플과 운영 설계를 담는다.

## 규칙

- 실제 키와 계정정보는 이 폴더에 저장하지 않는다.
- 실제 로컬 경로와 민감 설정은 `private/` 또는 `*.local.json`에 둔다.
- GitHub에 올라가도 되는 파일은 `*.example.json`과 문서 중심으로 관리한다.

## 파일

- `office.config.example.json`: 공개 가능한 기본 사무국 설정 예시
- `local-agent-registry.example.json`: 외부 에이전트 repo/폴더 연동 설계 예시

## 실행 방향

초기 자동화는 로컬 초안 생성이 우선이다.

1. 로컬 설정 읽기
2. 에이전트별 프롬프트 선택
3. 초안 생성
4. `private/` 또는 `reports/private/`에 저장
5. 사용자가 검토 후 공개 가능한 것만 GitHub에 반영
