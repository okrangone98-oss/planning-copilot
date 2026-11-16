# 무료 API 직접 호출 옵션

AI 질문을 복사해 외부 챗 화면에 붙여넣던 흐름은 그대로 두고, **브라우저에서 무료 OpenAI 호환 API를 바로 호출**할 수 있는 경로를 추가했습니다. 목적은 비용 0원 운영입니다. 유료 전환이 필요한 모델은 목록에 넣지 않았습니다.

## 제공자와 브라우저 호출 가능 여부

2026-11-15, `Origin: https://okrangone98-oss.github.io`로 실제 CORS 프리플라이트(`OPTIONS`)를 보내 확인한 결과입니다.

| 제공자 | Base URL | 기본 모델 | CORS | 확인된 응답 |
| --- | --- | --- | --- | --- |
| OpenRouter Free | `https://openrouter.ai/api/v1` | `openrouter/free` | 가능 | `204` · `access-control-allow-origin: *` |
| Groq 무료 티어 | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` | 가능 | `204` · `access-control-allow-origin: *` |
| Google Gemini(OpenAI 호환) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | 가능 | `200` · 요청 Origin을 그대로 허용 |
| LG K-EXAONE 2.5 | `https://api.exaone.ai/v1` | `k-exaone_v2.5` | 불가 | `OPTIONS 401`, CORS 허용 헤더 없음 |
| GitHub Models | `https://models.github.ai/inference` | `openai/gpt-4.1-mini` | 불가 | `OPTIONS 200`, CORS 허용 헤더 없음 |
| AMD Token Lab | `https://api.tokenlab.amd.com/v1` | `Gemma-4-31B-IT` 등 10종 | 불가 | `OPTIONS 403`, CORS 허용 헤더 없음 |
| 로컬 프록시 | 사용자 입력 | 사용자 입력 | 환경에 따름 | loopback·사설망 주소만 허용 |

- OpenRouter 모델 목록(`/v1/models`)에 `openrouter/free`가 실제로 있습니다(2026-11-15 확인, 전체 470개 중).
- AMD Token Lab은 발급 키로 `GET /v1/models`가 `200`으로 응답하고 `Gemma-4-31B-IT`, `Qwen3.8-27B`, `DeepSeek-V4.1-Flash`, `DeepSeek-V4-Flash`, `MiniCPM5-2B` 등을 돌려줍니다. 다만 브라우저 직접 호출은 CORS로 막힙니다. 참고로 대시보드 표기(`DeepSeek-V4.1-Flash-1017`)와 API 모델 id(`DeepSeek-V4.1-Flash`)가 다르므로, 모델 이름 칸은 직접 고칠 수 있게 두었습니다.
- CORS가 막힌 제공자도 **선택지로 남겨 두었습니다**. 로컬 프록시로 중계하면 같은 키로 쓸 수 있고, 브라우저에서 직접 부르면 실패 이유를 정직하게 보여 준 뒤 복사·붙여넣기 흐름으로 넘어갑니다.

## 키 취급 원칙

- 입력한 API 키는 **React 메모리에만** 있습니다. localStorage, 백업 JSON, 아카이브, 승인함, Markdown 내보내기 어디에도 쓰지 않습니다.
- 저장 설정(`planningCopilotModelSettings`)은 `sanitizeModelSettings`의 허용 목록으로만 기록합니다. 허용 목록에 없는 필드(예: `apiKey`, `token`, `geminiApiKey`)는 저장 단계에서 사라집니다. 테스트로 고정했습니다.
- 키 입력칸은 `type="password"`, `autocomplete="new-password"`이고, 입력한 키를 지우는 버튼이 있습니다. 탭을 닫으면 사라집니다.
- 키가 오류 메시지나 응답 본문에 섞여 나와도 `redactSecrets`로 가립니다(`tl-…`, `sk-or-…`, `gsk_…`, `AIza…`, `AQ.…`, `ghp_…`, `Bearer …`).
- Google Gemini 키는 **구형식 `AIza…`와 2026년 Google AI Studio가 발급하는 신형식 `AQ.…` 둘 다** 받습니다. 키 형식 검사는 모양만 보므로, 실제 유효성은 테스트 호출 응답(401/400 등)으로만 확인됩니다.
- 요청 주소는 제공자별 고정값을 씁니다. 사용자가 주소를 바꿀 수 있는 것은 로컬 프록시뿐이고, 그마저도 loopback(`127.0.0.1`, `localhost`, `::1`)과 사설 IPv4(`10.`, `172.16~31.`, `192.168.`)만 허용합니다. 공용 인터넷 주소를 열어 두면 입력한 키가 임의 서버로 나가기 때문입니다.

## 실행 전 확인

프로젝트 내용이 외부로 나가는 일이므로, 무료 API 경로에서는 모델 설정에 **외부 전송 확인 체크**가 있어야 실행됩니다(탭 세션 한정, 저장하지 않음). 확인 전에 실행하면 모델 설정 화면으로 안내합니다.

## 실패했을 때

| 상황 | 화면 표시 |
| --- | --- |
| CORS·네트워크 차단 | "브라우저가 이 API로의 직접 요청을 막았습니다(CORS 또는 네트워크 차단). 키가 틀린 것은 아닐 수 있습니다. 로컬 프록시를 쓰거나 질문 복사 흐름으로 이어서 진행해 주세요." |
| 401·403 | 키·권한 확인 안내 + 가려진 응답 발췌 |
| 429 | 호출 한도 안내, 다른 제공자 제안 |
| 404 | 모델 이름 확인 안내 |
| 시간 초과 | 다시 실행 안내 |

실패 화면에는 **"질문 복사로 이어가기"** 버튼이 함께 나오므로, 기존 복사·붙여넣기 흐름으로 그대로 진행할 수 있습니다. 성공한 응답은 "AI 답변 칸에 넣기"로 기존 반영 메모 흐름에 바로 붙습니다.

## 확인된 실행 결과 (2026-11-15, 헤드리스 브라우저)

- OpenRouter에 형식에 맞는 가짜 키로 호출: 브라우저 요청이 CORS를 통과해 제공자 응답 `401 {"message":"User not found."}`를 받았습니다. 즉 CORS 허용 제공자는 브라우저에서 실제로 호출됩니다.
- AMD Token Lab에 형식에 맞는 가짜 키로 호출: 브라우저 콘솔에 `blocked by CORS policy`가 기록되고, 화면에는 위 CORS 안내가 표시되었습니다.
- 어느 경우에도 입력한 키는 localStorage에 남지 않았습니다(`keyLeak: false`).

## 남은 일

- 실제 유효 키로 각 제공자의 응답 품질을 비교하는 검증은 하지 않았습니다(키를 이 작업에서 쓰지 않음).
- CORS가 막힌 제공자를 쓰려면 로컬 프록시가 필요합니다. 프록시 자체(예: Hermes 경유)는 이 저장소 범위 밖입니다.
