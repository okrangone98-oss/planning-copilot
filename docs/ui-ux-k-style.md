# UI/UX 개편 노트 — k-style-ui-ux 기반

이 문서는 UI/UX를 왜 이렇게 바꿨는지, 어디를 만지면 되는지를 남깁니다. 화면 코드를 고칠 때 기준으로 삼습니다.

## 참고한 원본

- [k-style-ui-ux](https://github.com/vmc-inner-circle/k-style-ui-ux) — `core/references/checklist.md`(P0·P1 비평 기준), `principles.md`, `screen-kinds.md`, `foundation/COMPONENTS.md`, `foundation/derive.py`(토큰 생성), `foundation/palettes/`(국내 서비스 팔레트)

## 스타일 파일 구조

`src/styles.css`는 아래 다섯 파일만 순서대로 불러옵니다. 화면별 CSS에서 색·글자 크기를 직접 적지 않고 토큰 변수만 씁니다.

| 파일 | 역할 |
| --- | --- |
| `src/styles/tokens.css` | 색(팔레트 3종)·타이포·여백·모서리·크기 변수 |
| `src/styles/base.css` | 리셋, 한국어 조판(`word-break: keep-all`), 공통 글자 |
| `src/styles/layout.css` | 사이드바·상단바·읽기 폭·모바일 탭바·하단 단계 바 |
| `src/styles/components.css` | 버튼·입력·배지·카드·표·빈 상태·개인정보 가드 |
| `src/styles/screens.css` | 홈·사업 관리·예산/정산·양식·시트 붙여넣기·hwpx·실험실 화면 |

토큰은 k-style-ui-ux의 `derive.py`로 계산했습니다(대비는 WCAG AA 4.5:1 기준, 제목/본문 비율 1.5 이상).

| 팔레트 | 브랜드 | 쓰는 때 |
| --- | --- | --- |
| `forest` (기본) | `#1f7a68` | 농촌·현장 업무, 차분한 기본값 |
| `blue` | `#1177ca` | 공고·보고서 중심으로 볼 때 (안내색은 보라로 밀어 둠) |
| `ink` | `#19191a` | 서류 작업처럼 색을 최소로 |

팔레트는 `<html data-palette="...">`만 바꾸면 전체에 적용됩니다. 사이드바 아래 `팔레트 전환`에서 고르고, 선택은 `localStorage`(`planningCopilotPalette`)에 남습니다.

## 적용한 규칙

- **한국어 조판**: `body`에 `word-break: keep-all`, 버튼 `white-space: nowrap`, 제목·본문에 `text-wrap: balance/pretty`.
- **읽기 폭**: 본문 최대 880px(`--content-w`), 넓은 표는 카드 안에서만 가로 스크롤.
- **터치 타겟**: 버튼 48px, 작은 버튼·목록 행 44px 이상.
- **선택 상태 하나**: 칩·세그먼트는 먹색/흰 칸, 체크·스위치는 브랜드 색. 정보 숫자에는 브랜드 색을 쓰지 않습니다.
- **배지 뜻 하나에 색 하나**: 기획(브랜드) · 신청(안내) · 집행(주의) · 완료(성공). 시간(D-day)은 배지가 아니라 글자.
- **빈 상태**: 작업이 없으면 무엇을 하면 되는지 한 줄과 버튼을 함께 보여 줍니다(`office-empty`, `home-line`).
- **모바일**: 390px에서 사이드바는 서랍, 아래 탭바(홈·사업·예산·양식·전체 메뉴), 예산표는 요약 아코디언.

## 메뉴 구조

사이드바는 `navGroups`(10개)와 `labNavItems`(17개, 기본 숨김)로 나뉘어 있습니다(`src/App.tsx`).
실험실은 `실험실` 토글을 열었을 때만 나오고, 실험실 화면으로 들어가면 자동으로 펼쳐집니다. 저장 키는 `planningCopilotLabOpen`입니다.

## 새로 붙은 기능

- `src/lib/budgetImport.mjs` — 시트 복붙(TSV) · CSV · Markdown 표를 예산 행으로 파싱. 단가·수량·금액이 어긋나면 경고만 남기고 표 값을 그대로 넣습니다. 테스트: `scripts/agent-office/test/budget-import.test.mjs`.
- `src/lib/hwpxBridge.mjs` — kordoc 명령 문자열, 로컬 브릿지 요청 본문/주소 검증, 응답 해석. 테스트: `scripts/agent-office/test/hwpx-bridge.test.mjs`.
- 브릿지 주소는 `localStorage`(`planningCopilotHwpxBridge`)에만 저장합니다.
