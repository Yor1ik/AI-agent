# Socratic Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 기존 Cloudflare Pages 레포를 단일 사용자 소크라테스 문답·출처 기반 탐색·사고 지도 앱으로 전환한다.

**Architecture:** React/Vite 화면, 얇은 Pages Functions 어댑터, server/의 공통 서비스, D1 저장을 사용한다. OpenRouter 고정 무료 모델과 검색 어댑터를 분리하고, 조사 단계는 클라이언트가 순차 구동한다.

**Tech Stack:** JavaScript ESM, React, Vite, Tailwind, React Flow, react-markdown, remark-gfm, syntax highlighter, jose, Zod, Wrangler, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-11-05-socratic-explorer-design.md

## Global Constraints
- 기존 체크아웃 /workspace/AI-agent에서 작업한다. 별도 worktree는 만들지 않는다.
- 기존 설계안의 20개 기능 모두 유지한다. 하위 질문 수의 최소·최대·고정 개수를 두지 않는다.
- Gemma 계열·무작위 무료 라우터·자동 유료 모델 전환은 사용하지 않는다.
- 검색 추가 비용은 승인되었다. 추가 충전은 승인되지 않았다. 원격 운영 데이터 생성·푸시·배포는 별도 요청 없이 실행하지 않는다.
- API 키·개인 데이터·로컬 DB·.dev.vars를 Git에 넣지 않는다. 사용자 입력은 로그에 남기지 않는다.
- Cloudflare Pages Git 연동은 유지한다. 원격 프로젝트 식별자·모델 ID·인증값은 추측하지 않는다.
- 모든 저장 변경은 D1 조건부 batch로 처리하며 실패한 revision 갱신 후 후속 변경이 실행되지 않게 한다.
- 모의 테스트, 실제 제공업체 테스트, 로컬 검증, 배포 검증을 구분한다.

## Review Focus
1. 두 탭 동시 편집·실행: stale 응답과 중복 외부 호출을 차단한다 (Tasks 2, 5).
2. 끊긴 조사와 timeout: 완료된 결과는 유지하고 재시도·지연 응답을 구분한다 (Task 5).
3. Access 설정 누락·위조·프리뷰: 원격 API는 거부한다 (Task 1).
4. 잘린 JSON·검색 출처 누락·알 수 없는 잔여량: 완료·출처·정확한 잔여량을 꾸미지 않는다 (Tasks 3, 5).
5. 메시지 편집 취소·재생성 실패·그래프 삭제 후 재분석: 기존 데이터와 사용자 수정이 유지된다 (Tasks 4, 6).

## 파일과 공통 계약
- frontend/src/{App.jsx,api.js,styles.css}, components/, features/{dialogue,research,graph}/: 화면별 UI.
- server/{auth.js,http.js,errors.js,schemas.js,db.js,sessions.js,dialogue.js,research.js,graph.js}, server/llm/{client.js,search.js,prompts.js}: 서버 로직.
- functions/api/[[path]].js: /api/* 라우팅. 기존 ask/meta는 제거한다.
- migrations/0001_initial.sql, tests/{auth,db,llm,dialogue,research,graph}.test.js, tests/e2e/app.spec.js.
- 응답 성공은 JSON 데이터, 실패는 {error:{code,message,retryAfter?,details?}}와 적절한 HTTP status. 외부 원문 오류와 비밀값은 노출하지 않는다.
- ID는 서버 crypto.randomUUID(), 시각은 UTC ISO. DB 레코드는 snake_case, API DTO는 camelCase.
- RequestContext={db,env,ownerId,fetchImpl,now}; 테스트에서 fetchImpl과 now를 대체한다.
- Session={id,title,revision,status,createdAt,updatedAt}; Message={id,sessionId,position,role,content,mode,researchRunId?}.
- ResearchRun={id,sessionId,declaration,status,revision,activeStepId,steps,result?}; Step={id,position,question,status,result?,sources,uncertainties,error?}.
- GraphEdge={id,sourceId,targetId,type,userEdited}; Source={id,title,url,stepId}.

### Task 1: 인증되는 Pages 앱 기반
**Files:** package.json, package-lock.json, vite.config.js, frontend/index.html, frontend/src/App.jsx, frontend/src/styles.css, functions/api/[[path]].js, server/{auth,http,errors,schemas}.js, wrangler.toml, .gitignore, .dev.vars.example, AGENTS.md, tests/auth.test.js.
**Interfaces:** authorize(request,env): Promise<{ownerId}>; handleApi(request,env): Promise<Response>; App renders Korean tab navigation.
- [x] JWT 위조·만료·잘못된 aud/issuer·다른 이메일·설정 누락 거부와 배포 환경의 로컬 우회 거부 테스트를 먼저 작성한다. 변경 요청의 다른 Origin도 거부한다.
- [x] npm test -- tests/auth.test.js가 구현 부재로 실패함을 확인한다.
- [x] 의존성을 고정 설치하고 Pages 출력 dist, Vite 루트 frontend, Tailwind 및 React를 구성한다. 서버는 jose의 원격 JWKS 검증을 사용한다. 앱 전체에 Access를 적용하는 배포 문서를 준비하고 API도 독립 검증한다. 로컬 개발은 명시적 플래그와 플랫폼의 로컬 실행 표식, loopback 요청을 모두 요구한다.
- [x] 인증 테스트 PASS 및 npm run build 성공을 확인한다. dist에 .dev.vars와 API 키가 없는지 검사한다.
- [x] 관련 파일만 커밋한다: feat: scaffold authenticated Cloudflare application.

### Task 2: D1 저장과 revision 원자성
**Files:** migrations/0001_initial.sql, server/{db,sessions}.js, tests/db.test.js.
**Interfaces:** createSession(ctx): Promise<Session>; listSessions(ctx): Promise<Session[]>; getSession(ctx,id): Promise<{session,messages}>; previewEdit(ctx,id,messageId): Promise<{revision,affected}>; editMessage(ctx,id,messageId,{content,expectedRevision}): Promise<Session>; deleteSession(ctx,id,expectedRevision): Promise<void>.
- [x] 실제 로컬 D1에서 세션 CRUD, 정렬·복구, stale 편집 시 모든 연관 데이터 보존, 동시 편집 한 건만 성공, 외래키 정합성 테스트를 작성한다.
- [x] npm test -- tests/db.test.js로 실패를 확인한다.
- [x] 설계의 7개 테이블과 인덱스를 만든다. 편집 batch의 첫 UPDATE는 expectedRevision과 변경 식별자로 잠그고 모든 후속 변경을 그 식별자 조건으로 제한한다. 세션 종속 데이터만 삭제한다. 변경 수 0은 409로 반환한다. cascade 또는 명확한 삭제 순서를 사용한다.
- [x] 로컬 D1 migration을 적용하고 같은 테스트가 통과하는지 확인한다. 다른 세션의 데이터가 유지되는지도 확인한다.
- [x] feat: add D1 sessions and guarded edits 커밋.

### Task 3: OpenRouter 공통 호출과 검색 어댑터
**Files:** server/llm/{client,search,prompts}.js, server/schemas.js, tests/llm.test.js, .dev.vars.example.
**Interfaces:** complete(ctx,{purpose,messages,schema,search}): Promise<{content,sources,model}>; getUsage(ctx): Promise<{appAttempts,providerRemainingCalls:null|number,creditRemaining:null|number}>. purpose는 dialogue/decompose/research/synthesize/graph/followup 중 하나다.
- [x] mock fetch로 401·429·일일 한도 명시 응답·timeout·잘린 JSON·유효 source ID 누락·지원되지 않는 검색·금액만 있는 키 API 응답을 테스트한다. 금액을 호출 수로 바꾸지 않음을 assert한다.
- [x] npm test -- tests/llm.test.js 실패를 확인한다.
- [x] 고정 모델·구조 JSON 스키마 검증·제한된 재시도·Retry-After·안전한 오류를 구현한다. 공식 모델 목록과 무료 데이터 정책을 확인할 수 있을 때 모델 ID를 검증한다. 미확인 시 실호출 준비 상태로 두고 임의 ID를 기본값으로 만들지 않는다. 검색 제공업체 annotations만 source로 인정한다. 기존 크레딧 내 검색은 허용하지만 유료 모델 fallback은 금지한다.
- [x] 테스트 PASS를 확인한다. 키가 없으면 실제 호출은 unrun으로 기록한다. 키와 네트워크가 있으면 문답·JSON·검색 지원을 소량 실호출로 따로 검증한다.
- [x] feat: add OpenRouter and verified-source adapters 커밋.

### Task 4: 문답과 기록 UI
**Files:** server/dialogue.js, functions/api/[[path]].js, frontend/src/{api.js,App.jsx}, frontend/src/features/dialogue/, tests/dialogue.test.js.
**Interfaces:** sendMessage(ctx,sessionId,{content,expectedRevision}): Promise<{session,messages}>; regenerate(ctx,sessionId,{messageId,expectedRevision}): same; setSessionStatus(ctx,id,{status,expectedRevision}): Promise<Session>. status=active/paused.
- [x] 이전 맥락·질문 자체 검토 프롬프트, 사용자 요청 없는 검색 금지, 편집 취소 보존, 재생성 실패 시 기존 답 보존, stale AI 결과 폐기 테스트를 작성한다.
- [x] npm test -- tests/dialogue.test.js 실패를 확인한다.
- [x] 새 대화·이전 대화·삭제 확인·자동 저장·편집 영향 확인·재생성·내 발언 돌아보기·중단/재개·로딩/재시도를 연결한다. 재생성은 같은 발언의 표현·검토 유형만 바꾸고 새 전제를 금지한다. 검색 없는 사실 응답의 불확실성을 명시한다.
- [x] 테스트 PASS 및 로컬 HTTP 다회 대화·새로고침 복구를 mock 제공업체와 확인한다.
- [x] feat: implement Socratic dialogue and history 커밋.

### Task 5: 사용자 주도 탐색과 실제 단계 상태
**Files:** server/research.js, frontend/src/features/research/, tests/research.test.js.
**Interfaces:** createResearch(ctx,sessionId,{declaration,expectedRevision}): Promise<ResearchRun>; advanceResearch(ctx,runId,{expectedRevision}): Promise<ResearchRun>; getResearch(ctx,runId): Promise<ResearchRun>; pauseResearch(ctx,runId): Promise<ResearchRun>; retryStep(ctx,runId,stepId,{expectedRevision}): Promise<ResearchRun>; followup(ctx,runId,{content,allowSearch}): Promise<Message>.
- [x] 하위 질문 1개·7개 모두 수용, 선언 원문 보존, 미요청 자동 탐색 거부, 부분 실패 보존, 두 탭에서 외부 호출 한 번, timeout 후 지연 결과 거부, 출처 없는 완료 거부를 테스트한다.
- [x] npm test -- tests/research.test.js 실패를 확인한다.
- [x] 선언 원문과 AI 분해를 분리 저장한다. 질문 개수 제한 없이 중복 제거와 스키마 검증을 수행한다. 실행 전 목록·예상 호출량을 보여준다. 조건부 상태 UPDATE 성공 요청만 외부 호출하고 단계별 저장·재개·일시정지·재시도를 구현한다. 백그라운드 완료를 보장하지 않는다. polling은 활성 탭에서만 backoff와 함께 실행한다.
- [x] 하위 질문 결과·출처·불확실성·종합·추가 질문·문답 복귀 화면을 연결하고 테스트 PASS를 확인한다. 실제 검색이 불가하면 unsupported로 표시하며 mock 성공과 구별한다.
- [x] feat: implement resumable source-based research 커밋.

### Task 6: 수정 가능한 사고 지도
**Files:** server/graph.js, frontend/src/features/graph/, tests/graph.test.js.
**Interfaces:** getGraph(ctx,sessionId): Promise<{revision,nodes,edges}>; refreshGraph(ctx,sessionId,{expectedRevision}): same; saveEdge(ctx,sessionId,{id?,sourceId,targetId,type,expectedRevision}): Promise<GraphEdge>; deleteEdge(ctx,sessionId,edgeId,{expectedRevision}): Promise<void>.
- [x] 다른 세션 ID·잘못된 관계 유형 거부, 삭제 후 AI 재생성 방지, 사용자 편집 덮어쓰기 방지, 변경 없는 지도 열기 시 외부 호출 0회 테스트를 작성한다.
- [x] npm test -- tests/graph.test.js 실패를 확인한다.
- [x] React Flow 노드 원문·관계 편집/추가/삭제와 tombstone을 구현한다. 메시지 전송은 분석을 호출하지 않는다. 지도 열기/갱신 시만 요청하고 심리·의도를 단정하지 않는 프롬프트를 적용한다.
- [x] 테스트 PASS와 UI 새로고침 후 수정 보존을 확인한다.
- [x] feat: add editable thought map 커밋.

### Task 7: 안전한 출력과 통합 UX
**Files:** frontend/src/components/{MarkdownMessage,ErrorNotice,ConfirmDialog,UsageNotice}.jsx, frontend/src/styles.css, tests/e2e/app.spec.js, playwright.config.js.
**Interfaces:** MarkdownMessage({content}), ErrorNotice({error,onRetry}), ConfirmDialog({impact,onConfirm,onCancel}), UsageNotice({usage}).
- [x] 브라우저 테스트에 원 설계의 6개 시나리오, 입력 중 중복 클릭, 원시 HTML·javascript 링크 비실행, 코드 복사, 좁은 화면 탭 전환·키보드 조작을 작성한다.
- [x] npm run test:e2e로 기대한 실패를 확인한다.
- [x] 안전한 Markdown/GFM·하이라이트·복사·가로 스크롤, 모바일 레이아웃, 오류별 재시도, 앱 시도 수와 제공업체 잔여량을 구별하는 안내를 구현한다.
- [x] npm test, npm run build, npm run test:e2e 통과를 확인한다. 테스트 수·skip·실제 제공업체 미실행을 별도 기록한다.
- [x] feat: integrate safe rendering and application UX 커밋.

### Task 8: Windows 실행과 Pages 배포 인계
**Files:** README.md, AGENTS.md, .dev.vars.example, wrangler.toml, docs/deployment.md, docs/verification.md, package.json scripts.
**Interfaces:** npm ci; npm run db:migrate:local; npm run dev; npm run build; npm run preview:local; npm test; npm run test:e2e.
- [x] README의 Windows PowerShell 명령에 POSIX 전용 환경 변수 구문·경로가 없는지 확인한다. 원격/로컬 migration 대상과 secret 입력 위치를 분리한다.
- [x] 저장소의 기존 Pages 프로젝트명 확인 절차, npm run build/dist 설정, D1 생성/DB 바인딩, Access/JWKS/audience/email 설정, OpenRouter key/고정 model/search 설정, preview 보호, 원격 migration을 문서화한다. 실제 식별자나 키는 넣지 않는다.
- [x] 저장한 로컬 명령으로 앱 시작·HTTP 응답·D1 복구를 검증한다. 20개 기능을 각 테스트/수동 확인에 대응시키고 미검증 상태를 숨기지 않는다. 비용과 무료 데이터 정책 안내를 포함한다.
- [x] git diff --check, npm test, npm run build와 필요한 e2e를 확인한다. 별도 검토에서 보안·동시성·출처·비용 노출을 확인한다. 기존 알려진 성공 검증은 변경 없으면 불필요하게 반복하지 않는다.
- [x] docs: document Windows workflow and Pages deployment 커밋. 사용자 요청 전 Git push·원격 배포는 수행하지 않는다.

## 자체 검토
20개 기능은 Tasks 4(문답 7개), 5(탐색 7개), 6(지도), 7(출력·오류·UI), 2(저장), 8(운영)에 대응한다. 공유 함수명과 DTO는 위 계약을 따른다. 외부 제공업체·D1 원격·Access 실제 검증은 자격증명과 네트워크가 필요한 별도 결과다. 이 계획은 현재 실행 결과가 아니다.
