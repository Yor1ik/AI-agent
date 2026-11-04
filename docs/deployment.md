# 기존 Git 연결 Cloudflare Pages 배포

이 문서는 배포 절차입니다. 코드 작성과 로컬 검증은 원격 D1 생성·migration·Access 설정·Git push·배포가 완료됐다는 뜻이 아닙니다. 기존 Pages 이름·Git 브랜치·D1 ID는 대시보드에서 확인해야 합니다.

## 1. 기존 프로젝트 확인

기존 Cloudflare Pages 프로젝트에서 연결된 저장소가 Yor1ik/AI-agent인지 확인합니다. 실제 프로젝트명을 확인해 wrangler.toml의 기존 name과 맞추세요. 새 프로젝트를 임의 생성하거나 기존 프로젝트를 삭제할 필요는 없습니다. 배포 브랜치와 현재 작업 브랜치도 확인합니다.

빌드 설정:

| 항목 | 값 |
|---|---|
| 루트 | 저장소 루트 |
| 빌드 명령 | `npm run build` |
| 출력 디렉터리 | `dist` |
| Node | 24 LTS 권장 |

루트 functions/가 Pages Functions로 빌드됩니다. Workers AI 바인딩은 사용하지 않으므로 기존 AI 바인딩을 제거할 수 있습니다. Python 서버는 배포하지 않습니다.

## 2. D1 준비

Cloudflare 계정에서 개인용 D1 데이터베이스를 생성합니다. CLI 사용 시 공식 인증을 먼저 구성한 뒤 실행합니다.

```powershell
npx wrangler d1 create socratic-explorer
```

출력된 실제 database_id로 wrangler.toml의 `00000000-0000-0000-0000-000000000000`을 교체합니다. 바인딩 이름은 정확히 `DB`이며 database_name도 실제 이름과 맞춥니다. Pages Production과 필요한 Preview에 DB 바인딩이 적용되는지 확인하세요. Preview는 운영 DB를 공유하지 말고 별도 DB 또는 접근 불가로 두는 편을 권합니다.

원격 대상 확인 후 스키마를 적용합니다. 기존 데이터가 있는 DB라면 먼저 백업과 schema를 확인하고 새 앱을 기존 관계없는 DB에 연결하지 마세요.

```powershell
npm run db:migrate:remote
```

`--local`은 이 PC의 DB에만 적용하며 운영 schema를 만들지 않습니다. migration 파일은 배포 이후 수정하지 않고 다음 migration을 추가합니다. 로컬 `.wrangler` 데이터는 업로드하지 않습니다.

## 3. OpenRouter와 서버 설정

Pages 설정의 서버 환경변수/secret에 입력합니다. VITE_ 접두사를 쓰지 않습니다.

| 이름 | 설정 |
|---|---|
| `ENVIRONMENT` | `production` |
| `LOCAL_DEV` | `false` |
| `OPENROUTER_API_KEY` | 비밀값으로 입력 |
| `LLM_MODEL` | 공식 목록에서 확인한 고정 `:free` 모델 ID |
| `SEARCH_ENABLED` | `true` (검색 추가 비용 허용) |
| `ACCESS_ISSUER` | `https://내팀.cloudflareaccess.com` |
| `ACCESS_AUDIENCE` | 이 앱의 Access Application Audience 값 |
| `ALLOWED_EMAIL` | 허용할 본인 이메일, 가능하면 비밀값으로 관리 |

모델 후보인 Nemotron 3 Ultra가 실제 무료 엔드포인트로 존재하는지 먼저 확인합니다. 없다면 다른 고정 무료 모델을 사용자와 선택해야 합니다. 무작위 모델·Gemma·유료 모델로 조용히 바꾸지 않습니다. JSON 출력·OpenRouter web plugin·url_citation annotations와 실제 모델이 함께 작동하는지도 확인합니다. 미지원이면 오류를 표시하며 검색 성공을 가장하지 않습니다. provider data_collection=deny로 요청하므로 계정 및 제공업체 데이터 정책과 호환되는지 확인합니다.

공식 확인 대상: OpenRouter 모델 목록과 개인정보 정책, https://openrouter.ai/docs/api-reference/limits , https://openrouter.ai/api/v1/key . 한도 숫자·요금은 현재 공식 설정과 실제 응답을 기준으로 확인합니다. API 키는 README·커밋·화면·브라우저 번들에 넣지 않습니다.

## 4. Cloudflare Access

Zero Trust에서 이 Pages 앱을 본인만 쓰도록 Access application을 구성합니다. 사용 중인 pages.dev와 커스텀 도메인 모두를 확인하고 대체 주소가 보호를 우회하지 않게 하세요. Pages의 기본 Preview 접근 정책만으로 Production까지 보호된다고 가정하지 마세요.

- Allow 정책을 본인 이메일로 제한합니다.
- 팀 도메인·Application Audience를 위 환경변수와 일치시킵니다.
- 서버는 Access JWT의 RS256 서명·issuer·audience·exp·email을 다시 검증합니다. 이메일 헤더만 신뢰하지 않습니다.
- 정책이 없는 Preview/대체 호스트는 비활성화하거나 별도 Access로 보호합니다. 동일 audience를 무조건 재사용하지 않습니다.
- 인증 설정이 빠지면 원격 API가 503, 토큰이 없거나 잘못되면 401로 거부되는 것이 정상입니다. 개발용 우회를 원격에 설정해 해결하지 마세요.
- Access 요금제 및 계정 기능 가용성은 배포 계정에서 확인합니다.

서버는 변경 요청의 Origin도 요청 URL과 대조합니다. 프런트엔드와 API는 동일 호스트로 배포하세요.

## 5. 배포 후 실제 확인

사용자 요청으로 커밋을 GitHub 배포 브랜치에 올리면 Git 연동 배포가 실행됩니다. 위 설정을 저장한 뒤 재배포가 필요한 항목인지 Cloudflare 대시보드에서 확인하세요.

1. 로그아웃·시크릿 브라우저에서 API로 대화가 노출되지 않는지 확인합니다.
2. 본인 로그인 후 새 대화를 만들고 정상 발언과 정보가 부족한 발언으로 문답합니다. 질문이 결론을 강요하지 않는지 사람이 확인합니다.
3. 새로고침 후 이전 대화·수정·삭제가 유지되는지 확인합니다.
4. 직접 탐색 대상을 입력하고 질문 목록을 검토한 뒤 자료 조사를 시작합니다. 실제 열리는 출처와 인용 내용이 일치하는지 확인합니다.
5. 검색 실패·할당량 오류·일시정지·재개·부분 완료를 확인합니다. 실패한 호출도 한도에 포함될 수 있습니다.
6. 사고 지도에서 사용자 수정·삭제가 갱신 후 보존되는지 확인합니다.
7. 운영 로그에 사용자 발언이나 비밀값이 없는지 확인합니다. 외부 모델의 원문 오류는 사용자에게 그대로 노출하지 않습니다.

모든 확인이 끝나기 전에는 실제 AI·운영 배포까지 검증됐다고 기록하지 않습니다.
