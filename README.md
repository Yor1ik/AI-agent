# Socratic Explorer

질문을 통해 내 생각을 살펴보고, **직접 정한 대상만** 자료와 출처를 바탕으로 탐색하는 단일 사용자 웹앱입니다.

React + Vite / Cloudflare Pages Functions / D1 / OpenRouter로 구성합니다. 기존 Git 연결 Pages 프로젝트를 그대로 활용할 수 있습니다. FastAPI 서버나 Python 설치는 필요하지 않습니다.

## Windows 로컬 실행

Node.js 22.12 이상(권장: Node 24 LTS)을 설치하고 PowerShell에서 실행합니다.

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run preview:local
```

터미널에 표시되는 로컬 주소로 접속합니다. `.dev.vars`에 **서버용** `OPENROUTER_API_KEY`, 공식 모델 목록에서 확인한 고정 `LLM_MODEL`을 입력하면 실제 문답을 사용할 수 있습니다. 예제 파일에는 실제 키나 미확인 모델 ID가 없습니다. 로컬 실행만 `ENVIRONMENT=local`, `LOCAL_DEV=true`를 사용합니다. 실제 Cloudflare 프로젝트에는 이 두 로컬 값을 복사하지 마세요.

화면을 빠르게 수정할 때는 Pages 로컬 서버를 실행한 상태로 다른 터미널에서 `npm run dev`를 실행합니다. Vite가 API를 로컬 Pages에 전달합니다. 로컬 데이터는 `.wrangler/`에 저장되며 원격 데이터와 다릅니다. 재실행·빌드로 로컬 DB를 지우지 않습니다.

## 주요 기능

- 대화 생성·선택·삭제, 자동 저장, 이전 맥락을 유지하는 소크라테스식 문답
- 내 발언 돌아보기, 영향 범위 확인 후 편집, 질문 재생성, 중단·재개
- 직접 작성한 탐색 선언 보존, 개수 제한 없는 관련 하위 질문, 단계별 조사·부분 실패·재시도
- 실제 검색 annotations의 출처, 결과 통합, 불확실성, 추가 질문, 문답 복귀
- React Flow 사고 지도, 관계 추가·수정·삭제, 사용자 수정과 삭제 보호
- 안전한 Markdown/GFM, 코드 강조·복사, 모바일 화면

AI는 심리나 의도를 진단하거나 사용자의 결론을 정하지 않습니다. 탐색은 사용자의 요청으로만 시작합니다. 관계 분석은 메시지마다 실행하지 않고 지도 열기·갱신 때만 요청합니다.

## OpenRouter와 비용

사용자가 제안한 Nemotron 3 Ultra 무료 엔드포인트는 **정확한 ID·현재 제공 여부·JSON/검색 지원을 검증해야 하는 후보**입니다. `openrouter/free` 같은 무작위 라우팅, Gemma, 유료 모델 자동 전환은 거부합니다. 앱은 `:free` 고정 모델 ID를 요구하지만 접미사만으로 현재 실제 가격·제공 여부를 증명하지는 못합니다. 연결 전에 OpenRouter의 모델 페이지에서 확인하세요.

검색 추가 비용 사용은 승인된 상태로 기본 `SEARCH_ENABLED=true`입니다. 무료 모델 호출도 할당량 제한이 있으며 검색 비용은 별도일 수 있습니다. 10달러 잔액으로 모든 사용을 보장하지 않습니다. 추가 충전·자동 결제·유료 fallback은 구현하지 않습니다. 기본 탐색은 하위 질문 n개일 때 n+2회이며 재시도·추가 검색·관계 분석은 별도입니다. 모델 호출은 실패 시 자동으로 반복하지 않고 사용자가 재시도합니다.

사용량 표시는 **보관된 대화에서 이 앱이 시도한 호출 수**입니다. 다른 앱의 호출, 삭제한 대화, 정확한 계정 일일 잔여량을 나타내지 않습니다. 키 메타데이터가 금액 잔액만 반환하면 무료 요청 잔여량으로 변환하지 않습니다. 429와 확인된 일일 소진을 구분하며 응답 정보가 부족하면 일반 한도 오류로 표시합니다.

개인 발언이 OpenRouter와 모델 제공업체에 전달됩니다. 무료 모델의 데이터 보관·학습 정책과 계정 개인정보 설정을 확인하세요. API 요청은 제공업체의 데이터 수집 거부 설정을 사용하므로 해당 정책을 만족하는 제공업체가 없으면 실패할 수 있습니다. 민감한 개인정보를 입력하지 마세요.

## Cloudflare 배포

[배포 안내](docs/deployment.md)에 기존 Pages 설정, D1, OpenRouter, Access 설정을 정리했습니다. `wrangler.toml`의 D1 ID는 로컬용 자리표시자이며 원격 배포 전에 교체해야 합니다. 기존 Pages 프로젝트명도 Cloudflare 대시보드와 대조하세요. 저장소의 `ai-for-someone`은 기존 값이며 실제 프로젝트 식별을 보장하지 않습니다.

**필수 보안:** Pages 전체에 Cloudflare Access를 적용하고, 서버 환경변수에 issuer·audience·허용 이메일을 설정하세요. 서버도 JWT 서명을 검증합니다. 미설정 원격 API는 거부됩니다. 프리뷰도 보호하거나 비활성화하세요. API 키·허용 이메일·DB 파일을 Git에 올리지 마세요.

## 검증

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

브라우저 설치가 필요한 경우 Playwright가 안내하는 OS 의존성도 설치하세요. 시스템 Chromium을 쓰려면 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`에 실행 파일 경로를 지정할 수 있습니다. 기본은 Playwright 관리 브라우저입니다.

서버 테스트는 실제 로컬 D1 엔진과 가짜 외부 HTTP 응답을 사용합니다. 브라우저 테스트는 모의 API를 사용하므로 실제 모델 품질·검색 성공·운영 배포를 증명하지 않습니다. [검증 기록](docs/verification.md)을 참고하세요.

## 구조

```text
frontend/       React 화면과 기능별 컴포넌트
functions/api/  얇은 Pages API 진입점
server/         인증, D1, 문답·탐색·지도, OpenRouter 어댑터
migrations/     D1 스키마
 tests/         서버와 브라우저 테스트
```

기존 도면 출력 템플릿은 새 앱으로 교체했습니다. `docs/01_인터뷰기록.md` 등 수업 기록은 보존했으며 예전 앱 안내가 남아 있을 수 있습니다.
