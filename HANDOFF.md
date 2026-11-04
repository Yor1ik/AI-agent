# Socratic Explorer 인수인계

작성: 2026-11-05 (Asia/Seoul). 다음 세션은 **기존 구현을 다시 만들지 말고 Cloudflare 연결·테스트 배포부터 이어갈 것**.

## 1. 지금 해야 할 일

사용자는 앱을 직접 써 볼 **실제 테스트 배포 주소**를 원한다. 테스트 배포를 명시적으로 승인했다. GitHub의 별도 preview 브랜치까지 업로드했으나 Cloudflare 인증·네트워크·실제 프로젝트 설정이 없어 배포 URL을 확인하지 못했다.

가장 최근의 배포 관련 사용자 요청:

> Fetch and execute the appropriate instructions to set me up for Cloudflare from https://developers.cloudflare.com/agent-setup/prompt.md

이 공식 문서 요청은 이 환경의 프록시가 HTTP 403으로 차단했다. **본문을 읽지 못했고 해당 지침도 실행하지 못했다.** 다음 세션에서 접근 가능 여부를 확인한 뒤 실제 문서를 읽고 적절한 절차를 수행해야 한다. 안내 내용을 추측해 실행하지 말 것.

최신 사용자 요청은 이 인수인계 파일 작성이다. 기존 테스트 배포 목표는 취소되지 않았다.

## 2. 저장소와 브랜치

- 저장소: https://github.com/Yor1ik/AI-agent
- 현 작업 경로: `/workspace/AI-agent`
- 현 로컬 브랜치: `work` (플랫폼이 제공한 기존 격리 체크아웃)
- 원격 테스트 브랜치: `socratic-explorer-preview`
- 브랜치 링크: https://github.com/Yor1ik/AI-agent/tree/socratic-explorer-preview
- 원격 `main`은 기존 템플릿 `4009f37ff22c835def4e75e36030ee0ffe56f40d` 상태로 유지했다.
- 구현 커밋: `de7f87b15e0d75a46036d96f137435c7e5240718`
- 수정·검토 반영 커밋: `afd0dcb33d35c87070ecbd5e67b5d6fe609943e3`
- 위 두 구현 커밋은 원격 preview 브랜치에 올라가 있다. 이 인수인계 문서는 그 이후 문서 커밋이다.
- 새 세션에서 HEAD·원격·사용자 변경을 먼저 확인할 것. 강제 push, reset, 임의 main 병합은 하지 말 것.
- 다른 환경이라면 위 preview 브랜치를 체크아웃한다. 현재 환경에서는 별도 worktree를 만들 필요가 없다.

## 3. 확정된 제품 방향

대학교 과제용 **단일 사용자 Socratic Explorer**. 원래 설계의 React + FastAPI + 로컬 SQLite에서, 사용자의 명시적 승인으로 **React/Vite + Cloudflare Pages Functions + D1**으로 전환했다. 기존 Git 연결 Cloudflare Pages 앱을 활용하는 것이 목표다. 원래 도면 출력 앱은 교체했고 Git 기록에는 남아 있다.

핵심 원칙:

- AI는 사용자의 진짜 문제·심리·의도·결론을 대신 판단하지 않는다.
- 문답은 기본적으로 주요 질문 하나와 같은 호출 안의 자체 검토를 사용한다.
- 종료·재개와 결론 여부는 사용자가 결정한다.
- 탐색은 사용자가 직접 작성한 선언과 명시적 실행 요청으로만 시작한다.
- **하위 질문 개수의 최소·최대·고정 제한을 두지 않는다.** 선언에서 직접 도출되는 질문만 만들고 중복은 제거한다. `3~5개`, `최대 5개`를 되살리지 말 것.
- 자료 검색과 출처가 없는 응답을 조사 완료로 표시하지 않는다.
- 관계 분석은 매 메시지마다 실행하지 않고 지도 열기·갱신 때만 수행한다. 사용자 수정·삭제를 AI가 덮어쓰지 않는다.
- 단일 사용자라도 공개 주소이므로 인증이 필요하다. 원격 API는 Access 설정이 없으면 거부하도록 구현했다.

전체 20개 기능은 `docs/verification.md`의 대응표에 정리했다. 새 요구 없이 핵심 기능을 축소하지 말 것.

## 4. OpenRouter 모델·비용 결정

- 제공업체: **OpenRouter**.
- 사용자는 크레딧 **10달러를 이미 충전**했다고 했고 **웹 검색의 추가 비용을 허용**했다.
- 추가 충전·자동 결제·자동 유료 모델 전환은 승인하지 않았다.
- **Gemma 계열은 오류가 잦다는 사용자 요청으로 제외**.
- 후보는 **Nemotron 3 Ultra 무료 엔드포인트**이나 정확한 모델 ID·실제 무료 제공 여부는 아직 확인하지 못했다. 존재를 검증한 것처럼 말하거나 ID를 지어내지 말 것.
- 무작위 `openrouter/free` 라우터는 사용하지 않는다. 확인된 고정 `:free` ID를 `LLM_MODEL`에 설정해야 한다.
- 코드에는 미확인 기본 모델 ID가 없다. 키·모델 미설정은 안전한 구성 오류로 처리한다.
- JSON 출력, OpenRouter `web` plugin, 실제 `url_citation` annotations, 무료 모델 데이터 정책을 실호출 전 확인해야 한다.
- 서버 요청은 provider `allow_fallbacks:false`, `data_collection:'deny'`를 사용한다. 해당 정책과 호환되는 제공업체가 없으면 실패할 수 있다.
- 자동 재시도는 없고 사용자 재시도만 제공한다. 실패 호출·검색 비용을 조용히 반복 소모하지 않기 위함이다.
- 앱 시도 수를 정확한 계정 일일 잔여 횟수로 표시하지 않는다. `/api/v1/key`의 금액 잔액을 호출 수로 변환하지 않는다.

무료 한도 20회/분, 50회/일, 누적 10달러 구매 시 1,000회/일이라는 외부 검토 정보는 받았지만 공식 문서 접근이 막혀 현재 수치를 독립 검증하지 못했다. 상수로 보장하지 않는다.

## 5. 코드와 문서 지도

먼저 `AGENTS.md`, 아래 설계/검증/배포 문서를 읽는다.

- `README.md`: Windows/로컬 실행과 비용·개인정보 안내
- `docs/deployment.md`: 기존 Pages·D1·Access·OpenRouter 설정과 운영 확인 절차
- `docs/verification.md`: 실제 실행한 검증과 미검증 항목, 20개 기능 추적
- `docs/superpowers/specs/2026-11-05-socratic-explorer-design.md`: 수정·합의된 설계
- `docs/superpowers/plans/2026-11-05-socratic-explorer.md`: 수행한 구현 계획
- `frontend/`: React, Vite, Tailwind, React Flow, Markdown/GFM·코드 강조
- `functions/api/[[path]].js`: 얇은 Pages 어댑터
- `server/api.js`: 경로·입력 검증
- `server/auth.js`: Access JWT의 서명·issuer·audience·exp·허용 이메일 검증 및 변경 요청 Origin 검사
- `server/{db,sessions,dialogue,research,graph}.js`: 저장 및 기능 로직
- `server/llm/`: OpenRouter 어댑터·출처 추출·프롬프트
- `migrations/0001_initial.sql`: D1 스키마
- `tests/`: 실제 Miniflare D1 기반 서버 테스트와 모의 API 기반 브라우저 테스트

의존성은 lockfile에 고정돼 있다. Node >=22.12, 권장 Node 24 LTS. Wrangler 4.157.0, Miniflare 4.20260730.0. 지원 런타임에 맞춰 compatibility_date는 2026-07-30이다.

## 6. 실행 방법

새 머신:

```sh
npm ci
# .dev.vars가 없을 때만 .dev.vars.example을 복사한다. 기존 사용자 파일을 덮어쓰지 않는다.
npm run db:migrate:local
npm run preview:local
```

Windows PowerShell의 복사 명령:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

- `npm run preview:local`은 빌드 후 Pages/D1을 로컬에서 실행한다.
- 개발용 API 주소는 loopback 8788, Vite 화면은 별도 터미널의 `npm run dev`로 실행 가능하다.
- 이것은 **사용자가 외부에서 접속할 수 있는 배포 주소가 아니다.** 사용자에게 이 서버의 localhost 링크를 테스트 배포 URL처럼 제공하지 말 것.
- `.dev.vars` 로컬 값: `ENVIRONMENT=local`, `LOCAL_DEV=true`. 배포에는 `ENVIRONMENT=production`, `LOCAL_DEV=false`.
- 로컬 D1은 `.wrangler/`이며 원격 DB가 아니다. 로컬 migration을 적용했다고 원격 schema가 생기지 않는다.
- Wrangler Worker에 process 환경변수의 키가 자동 바인딩된다고 가정하지 말 것. 로컬은 ignored `.dev.vars`, 운영은 Pages의 서버 secret 바인딩을 안전하게 설정한다.
- `.dev.vars`, `.env`, DB, `.wrangler`, `node_modules`, `dist`는 Git에서 제외했다.
- 기존 서버 프로세스가 새 세션에 살아 있다고 가정하지 말고 필요하면 재시작한다.

## 7. 검증 상태: 통과와 미실행을 구분

이전 세션에서 확인:

- `npm ci --no-audit --no-fund`: 재설치 성공.
- `npm test`: **36/36 통과**, skip 없음. 실제 Miniflare D1 사용, 외부 LLM HTTP는 모의 응답.
- `npm run build`: 성공. 지도·탐색은 코드 분할.
- Playwright Chromium: **7/7 통과**, skip 없음. API는 모의 응답.
- 클라우드의 시스템 Chromium 사용 명령:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

- 다른 머신에서는 `npx playwright install chromium` 후 `npm run test:e2e`. 위 환경변수 설정 구문은 Linux용이며 Windows에서는 PowerShell 방식 또는 Playwright 기본 브라우저를 쓴다.
- 실제 Wrangler Pages + 로컬 D1 HTTP 검증: 화면 200, 세션 CRUD, 키 누락 503·사용자 발언 보존·생성 잠금 해제, 지도 revision 변경과 stale 수정 409 거부.
- 로컬 migration 적용 및 재실행 `No migrations to apply` 확인.
- 데스크톱·모바일 화면과 가로 넘침 없는 상태 확인.

**미실행:** 실제 OpenRouter 문답 품질/중립성, 실제 웹 검색·출처, Windows OS 직접 실행, 운영 D1/Access/Cloudflare 배포. 모의 테스트 통과로 실제 모델이나 배포가 정상이라고 말하지 말 것.

검토로 발견해 이미 고친 문제(다시 구현할 필요 없음):

1. sessions 자체 UPDATE에 바깥 id/owner 조건이 없어 다른 세션까지 바뀌던 문제 → `sessionGate`로 대상 행 제한.
2. 마지막 AI 질문 뒤에 메시지는 없어도 연관 탐색이 있으면 재생성 전 삭제 확인 필요 → 항상 impact 조회·revision 전달.
3. 조사 출처를 결과보다 먼저 저장해 중단된 출처가 섞이던 문제 → 출처 교체·결과·실행권 해제를 하나의 조건부 D1 batch로 확정.
4. 오래된 지도 화면 수정이 삭제 관계를 되살리던 문제 → snapshot revision과 변경 요청의 expectedRevision, 기존 수정 ID 검증.
5. 탐색 시작 탭이 실행 중 실제 단계를 표시하지 않던 문제 → 보수적 상태 조회 및 낮은 revision 응답 무시.

독립 코드 검토 한 번을 거쳤고 위 항목을 RED→GREEN 회귀 테스트로 확인했다. 이후 의미 있는 코드 변경을 하면 해당 테스트와 필요한 검증을 다시 수행한다.

## 8. 현재 배포 장애와 실제 관찰

마지막 runtime 상태 조회:

- 실행 환경 running, 관찰은 current.
- 적용된 custom allowed hosts: **빈 목록**.
- 적용된 secret/runtime variable: **없음**.
- `wrangler whoami`: **not authenticated**.
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `OPENROUTER_API_KEY`, `LLM_MODEL`, `ACCESS_ISSUER`, `ACCESS_AUDIENCE`, `ALLOWED_EMAIL`는 조사 당시 process에 설정되지 않았다.
- GitHub HTTPS Git 프록시의 read와 preview 브랜치 push는 실제 성공했다. raw GitHub 토큰이 없다는 이유로 GitHub 인증을 다시 요구하지 말 것.
- GitHub commit 공개 화면에서 Cloudflare 배포 링크를 찾지 못했다. 배포가 성공/실패했다고 확정하지 않았다.
- 공식 문서 URL 요청은 HTTP CONNECT 프록시 403. 프록시 우회·TLS 검증 해제를 하지 않았다.

클라우드 설정 **초안**에는 다음을 저장했지만 실행 환경에 반영된 것은 아니다:

- custom domains: `api.cloudflare.com`, `developers.cloudflare.com`, `openrouter.ai`
- secret 요구사항: `CLOUDFLARE_API_TOKEN` → `api.cloudflare.com`, `OPENROUTER_API_KEY` → `openrouter.ai`
- 일반 변수 요구사항: `LLM_MODEL`
- 현재 앱용 `install_script`, `start_skill`

문서 접근용 네트워크 도메인 `developers.cloudflare.com`과 API 토큰의 전송 대상 `api.cloudflare.com`은 다르다. **토큰을 문서 도메인으로 전달하도록 설정하지 말 것.**

중요한 사용자 UI 혼선:

- 사용자는 비밀값을 어디 입력하는지 몰랐고, 세션의 환경 설정 메뉴가 보이지 않는다고 했다.
- 이전 답변에서 실제 화면을 확인하지 않고 '환경 설정 메뉴' 위치를 단정했다가 정정했다. 다음 세션은 이 잘못된 UI 안내를 반복하지 말 것.
- 보이는 GitHub 저장소 페이지는 secret 설정 화면이 아니다.
- 사용자는 '허용된 도메인' 입력값을 물었으나 어떤 설정 화면인지 확정되지 않았다.
- 이 세션에서 비밀값의 실제 입력·저장·게시가 완료됐다고 확인한 적이 없다.
- 클라우드 환경 설정의 게시와 Cloudflare Pages 앱 배포는 별도 작업이다.
- Cloudflare API 토큰은 에이전트의 배포 권한이고, OpenRouter 키는 앱이 AI를 호출할 때 쓰는 서버 비밀값이다. 혼동하지 말 것.

## 9. 다음 세션의 권장 순서

1. 현재 Git/런타임/네트워크/secret **이름과 readiness만** 확인한다. 키 값·환경 전체·credential 파일 내용을 출력하지 않는다. 다른 세션의 environment ID나 readiness를 재사용하지 않는다.
2. 접근 가능하면 사용자가 요청한 공식 https://developers.cloudflare.com/agent-setup/prompt.md 를 읽고 적절한 설정을 실행한다. 아직 차단되면 구체적인 차단 원인과 현재 이용 가능한 설정 UI를 확인한다. 프록시를 우회하거나 보지 못한 문서를 실행했다고 말하지 않는다.
3. 기존 인증으로 `wrangler whoami` 등 정상 CLI를 사용한다. 사용할 수 있는 API 권한을 조사하고 꼭 필요한 missing credential만 안전한 입력 경로로 요청한다. 브라우저/커넥터가 새 세션에 실제 제공되면 그 도구를 우선 활용한다.
4. 계정의 **실제 Pages 프로젝트명과 Git 연결·preview 설정**을 확인한다. repo의 `name = "ai-for-someone"`는 템플릿의 기존 값으로, 실제 원격 프로젝트 식별이 확인된 게 아니다.
5. 전용 테스트 D1 DB를 생성/선택해 `DB`에 연결하고 실제 ID로 설정한다. `00000000-0000-0000-0000-000000000000`은 로컬 placeholder이며 원격 사용 불가. 관련 없는 운영 DB를 건드리지 않는다. 원격 migration 전에 대상을 확인한다.
6. 기존 Pages 빌드 명령을 `npm run build`, output을 `dist`, root를 저장소 루트로 설정한다. 원래 output `public` 설정이 원격에 남아 있을 수 있다. Git push만으로 이 설정이 바뀌었다고 가정하지 않는다.
7. Access의 issuer/audience/허용 이메일을 설정하고 Production/Preview/대체 호스트 보호를 확인한다. 인증 우회를 켜서 배포 오류를 숨기지 않는다. Access 없이 API는 503/401로 거부되는 것이 현재 정상 동작이다.
8. OpenRouter 키와 확인된 고정 무료 모델 ID를 서버에 연결하고 JSON/검색 annotations를 소량 실호출 검증한다. 무료 제공 여부·데이터 정책·검색 추가 비용도 실제 공식 정보와 응답으로 확인한다.
9. `socratic-explorer-preview`로 테스트 배포하고 Cloudflare가 반환한 **실제 배포 URL**을 얻는다. 본인 로그인·D1 기록 복구·문답·명시적 조사·출처·관계 수정 보호를 smoke test한다. 성공한 부분과 막힌 부분을 분리해 보고한다.

사용자는 테스트 배포를 승인했지만 **main 병합·운영 전환·추가 결제·보호 해제**까지 승인한 것은 아니다. 가능한 범위의 작업은 계속 진행하고, 같은 permission/secret 질문을 불필요하게 반복하지 않는다.

## 10. 다음 세션에 붙여넣을 짧은 요청

> Yor1ik/AI-agent의 socratic-explorer-preview 브랜치에 있는 HANDOFF.md를 먼저 읽고 Cloudflare 테스트 배포를 이어가 주세요. 앱 구현은 완료돼 있으니 다시 만들지 마세요. 공식 https://developers.cloudflare.com/agent-setup/prompt.md 를 실제로 가져와 읽고 필요한 연결을 진행해 주세요. 현재 단계는 Cloudflare 인증·네트워크·D1·Access·OpenRouter 설정과 실제 preview 배포 URL 확보입니다. 키 값은 채팅에 요청하지 마세요.
