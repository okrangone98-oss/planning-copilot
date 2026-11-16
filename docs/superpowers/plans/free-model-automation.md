# 무료/로컬 모델 자동화 구현 Plan

## 구현 순서

1. `src/types.ts`에 모델 설정, 승인함, 프로젝트 기억 타입 추가
2. `src/lib/modelRouter.ts`에 모델 선택/실행 라우터 추가
3. `src/lib/storage.ts`에 localStorage 저장 함수 추가
4. `src/App.tsx`에 모델 설정, 승인함, 프로젝트 기억 탭 추가
5. `scripts/agent-office/nightly-report.mjs`에 로컬 야간 보고 생성 스크립트 추가
6. `npm run check`로 타입체크/빌드 검증

## 검증

- 모델 설정 탭이 렌더링된다.
- 시뮬레이션 모델 테스트가 동작한다.
- AI 사무국 결과를 승인함에 저장할 수 있다.
- 프로젝트 기억을 저장할 수 있다.
- 야간 보고가 `private/nightly-reports`에 생성된다.
