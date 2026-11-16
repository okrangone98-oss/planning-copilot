import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const privateDir = path.join(root, "private", "nightly-reports");
fs.mkdirSync(privateDir, { recursive: true });

const now = new Date();
const date = now.toISOString().slice(0, 10);
const command = process.env.OFFICE_COMMAND || "오늘의 AI 사무국 점검과 다음 액션 정리";
const provider = process.env.OFFICE_MODEL_PROVIDER || "simulation";
const report = `# AI 사무국 야간 보고 (${date})

- 생성시각: ${now.toISOString()}
- 모델 경로: ${provider}
- 기준 명령: ${command}

## 오늘의 핵심 3가지

- 승인함에 남은 초안과 보류 항목을 먼저 정리합니다.
- 공개 가능한 자료는 무료 API로, 민감한 자료는 Ollama 같은 로컬 LLM로 처리합니다.
- 내일 오전에 바로 실행할 체크리스트를 5개 이하로 유지합니다.

## 자동화 점검

- [ ] API 키는 저장소에 커밋하지 않았는가
- [ ] private/ 폴더에 민감자료를 보관했는가
- [ ] 자동 발송/게시/제출은 꺼져 있는가
- [ ] 보고서에 개인정보가 남아 있지 않은가

## 다음 액션 체크리스트

- [ ] 승인함의 '검토중' 항목 확인
- [ ] 오늘 쓸 보고서 1개를 Markdown으로 정리
- [ ] GPT에 물어볼 질문 1개만 선별
- [ ] 프로젝트 기억에 확정 사실 추가
- [ ] 필요 없는 초안 폐기
`;

const filePath = path.join(privateDir, `${date}-nightly-report.md`);
fs.writeFileSync(filePath, report);
console.log(filePath);
