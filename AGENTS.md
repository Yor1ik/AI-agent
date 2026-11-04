# Socratic Explorer

React/Vite + Cloudflare Pages Functions + D1, 단일 사용자 과제 앱.

- 설계: docs/superpowers/specs/2026-11-05-socratic-explorer-design.md
- 계획: docs/superpowers/plans/2026-11-05-socratic-explorer.md
- 기존 격리 체크아웃을 사용한다. 사용자 요청 없이 worktree를 만들지 않는다.
- frontend/는 화면, functions/api/는 얇은 라우터, server/는 비밀값을 다루는 서버 로직이다.
- 사용자가 판단 주체다. AI는 문제·의도·심리를 진단하거나 탐색을 자동 시작하지 않는다.
- 대화는 개인 D1에 저장한다. 입력 원문·개인정보·키를 로그나 Git에 남기지 않는다.
- .dev.vars, .env, 로컬 DB와 .wrangler는 커밋하지 않는다. API 키는 서버에서만 쓴다.
- 확인하지 못한 동작·출처·잔여 호출 수를 확인한 것처럼 표시하지 않는다.
- 고정 무료 모델을 사용한다. Gemma·무작위 모델·유료 fallback을 사용하지 않는다.
- 관계 분석은 지도 열기/갱신 시에만 한다. 사용자 수정·삭제 관계는 보호한다.
- 하위 질문 개수는 제한하지 않는다. 사용자 선언에서 직접 도출되는 질문만 생성한다.
- npm test, npm run build, npm run test:e2e로 검증한다. 실제 API와 모의 테스트를 구분한다.
- 원격 migration·Git push·배포는 사용자가 요청할 때 수행한다.
