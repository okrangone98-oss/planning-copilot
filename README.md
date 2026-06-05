# 사업계획서 코워크 에이전트

공고문, 지원사업 양식, 좋은 사업계획서 사례, 사용자의 아이디어를 함께 엮어 사업계획서 초안을 만드는 도구입니다.

목표는 단순 자동작성보다 큽니다. 사용자가 공부하고 판단하는 과정은 살리면서, 자료 정리와 초안 작성 속도는 혼자 할 때보다 훨씬 빠르게 만드는 코워크 시스템입니다.

배포 주소:

https://okrangone98-oss.github.io/planning-copilot/

## 실행 방법

개발 중에는 아래 명령으로 실행합니다.

```bash
npm install
npm run dev
```

배포 파일은 GitHub Actions가 자동으로 빌드해 GitHub Pages에 올립니다.

```bash
npm run build
```

## 무엇을 하는 도구인가

- PDF, Word, 텍스트 공고문을 읽고 중요한 내용을 정리합니다.
- 부처별 사업계획서 양식 차이를 반영해 작성 흐름을 잡습니다.
- 좋은 사례를 모아 두고 현재 공고와 맞는 참고 내용을 찾아옵니다.
- 사용자의 아이디어를 지우지 않고 문제정의, 실행계획, 성과지표로 바꿉니다.
- 직접 만들기 어려운 고급 판단은 AI에게 물어볼 질문으로 만들어 줍니다.
- Google Drive와 로컬 저장을 함께 사용합니다.
- Mermaid 기반 시각자료 초안을 만들 수 있습니다.
- Jira, Notion, Google Sheet, Google Drive 링크를 프로젝트별로 연결할 수 있습니다.

## 권장 사용 순서

1. `공고 해석`에 공고문을 넣고 분석합니다.
2. `사례 모으기`에 좋은 사업계획서와 비슷한 공고를 저장합니다.
3. `관련 사례 찾기`로 현재 공고와 맞는 참고 내용을 찾습니다.
4. `AI 질문`에서 복사할 질문을 만듭니다.
5. AI 답변을 붙여넣고 반영 메모를 만듭니다.
6. `시각자료`에서 논리모형과 성과 흐름도를 만듭니다.
7. `연결 허브`에서 Jira, Notion, Sheet, Drive 링크를 정리합니다.
8. 문제정의, 성과지표, 실행설계를 채웁니다.
9. `초안 조립`에서 사업계획서 초안을 만듭니다.
10. `백업`에서 파일로 저장하거나 Google Drive에 백업합니다.

## 저장 방식

기본 저장은 사용 중인 브라우저에 됩니다. 다른 컴퓨터에서도 이어서 쓰려면 `백업` 탭에서 백업 파일을 내려받거나 Google Drive 백업을 설정하세요.

중요한 문서 원본은 Google Drive에 보관하고, 앱에는 텍스트 추출본과 참고 메모를 저장하는 방식을 권장합니다.

## 외부 작업공간 연결

`연결 허브` 탭에서 Jira, Notion, Google Sheet, Google Drive 링크를 저장할 수 있습니다.

현재는 링크 연결을 우선 지원합니다. 이후에는 아래 기능으로 확장할 수 있습니다.

- Jira 작업 자동 생성
- Notion 기획 노트 저장
- Google Sheet 성과지표 자동 업데이트
- Google Drive 원본 문서 폴더 동기화

## Google Sheets 에이전트

Google Sheets를 자동으로 만들고 내 계정에 공유하는 로컬 에이전트 코드는 아래 문서에 정리했습니다.

[docs/google-sheets-agent.md](docs/google-sheets-agent.md)

## 개발 방향

자세한 제품 기준과 개발 로드맵은 아래 문서를 기준으로 관리합니다.

[docs/product-blueprint.md](docs/product-blueprint.md)

오픈소스 후보를 어떻게 포크하거나 기능 단위로 흡수할지는 아래 기준을 따릅니다.

[docs/open-source-integration.md](docs/open-source-integration.md)
