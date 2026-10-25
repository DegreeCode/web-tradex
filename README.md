# TradeX Web

`tradex/core`(Go API)를 위한 트레이딩 웹 클라이언트입니다. 간결한 카드형 UI, 패스키(WebAuthn) 인증,
Vercel 정적 배포를 전제로 만들어졌습니다. 관리자(admin) API는 의도적으로 사용하지 않습니다.

## 스택

- Next.js 16 (App Router, Turbopack) · React 19 · TypeScript
- Tailwind CSS v4 · shadcn/ui (Base UI) · lucide-react
- TanStack Query v5 (WebSocket 우선, REST 복구) · lightweight-charts (가격·자산 차트) · sonner
- `@simplewebauthn/browser` (패스키 등록/로그인)

## 배포 형태: 정적 익스포트 + API 직접 연결

```
브라우저 ──(정적 HTML/JS)──► Vercel CDN          (서버 함수 없음)
        └──(직접 fetch)────► tradex core (API)   (쿠키·CSRF 그대로 사용)
```

- `next.config.ts`에 `output: "export"`만 설정했습니다. 빌드하면 `out/`에 정적 파일만 생성되고,
  Vercel은 서버리스/엣지 함수 없이 CDN에서 파일만 서빙합니다. 런타임 비용·콜드스타트가 없습니다.
- 프록시(rewrites)를 두지 않으므로 브라우저가 API를 직접 호출합니다. 설정값은 빌드 시점에 번들에
  인라인되는 `NEXT_PUBLIC_API_BASE_URL` 하나뿐입니다.

### 직접 연결의 전제 조건

로그인 쿠키가 `SameSite=Lax` + `Secure`로 발급되므로, 프론트와 API는 **같은 사이트**(같은 registrable
domain)에 있어야 쿠키가 오갑니다. Vercel에는 **커스텀 도메인**을 붙여 주세요.

| 구분 | 예시 | 이유 |
| --- | --- | --- |
| 프론트 | `https://app.example.com` (Vercel 커스텀 도메인) | `*.vercel.app`은 API와 cross-site라 쿠키가 전송되지 않음 |
| API | `https://api.example.com` | 같은 사이트(`example.com`)라 세션 쿠키 전송 가능 |

API 서버는 프론트 오리진을 CORS·WebAuthn 허용 오리진으로 등록하고, 프론트가 읽어야 하는 CSRF 쿠키를
두 호스트가 공유하는 상위 도메인으로 발급해야 합니다. 구체적인 설정 방법은 API 서버 문서를 따릅니다.

### 트레이드오프

- 프리뷰(`*.vercel.app`)에서는 화면은 보이지만 **로그인 쿠키가 실리지 않아** 인증 흐름을 확인할 수
  없습니다. 인증까지 확인하려면 API와 같은 사이트의 커스텀 프리뷰 도메인을 사용하고,
  API 서버의 허용 오리진도 그 도메인에 맞춰야 합니다. `*.vercel.app` 오리진을 허용 목록에 추가하는
  것만으로는 SameSite 제한이 해소되지 않습니다.
- 종목 상세는 정적 익스포트 제약 때문에 경로 파라미터 대신 **쿼리 파라미터**를 씁니다:
  `/market/symbol?symbol=ABC.M` (임의 경로는 빌드 시점에 생성할 수 없습니다).

## 로컬 실행

1. API 서버를 `http://localhost:8080`에서 실행하고, 허용 오리진에 `http://localhost:3000`을 등록합니다.
   Node.js 24 이상을 사용하세요(`.nvmrc`, `engines`).
   `localhost:3000`과 `localhost:8080`은 같은 사이트(포트는 SameSite 판단에 영향 없음)라 별도 도메인
   설정이 필요 없습니다.

2. 프론트:

```bash
cp .env.example .env.local    # NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
npm install
npm run dev                   # http://localhost:3000
```

Chrome은 localhost를 보안 컨텍스트로 취급하므로 `Secure` 쿠키도 저장됩니다.

3. 정적 산출물 확인(선택): `npm run build` → `out/` 생성, `npm run start`로 그대로 서빙해 확인합니다.
   빌드 결과물의 meta CSP가 로컬 미리보기에서도 적용됩니다.

## 보안 헤더

`vercel.json`은 CSP, HSTS, COOP, XFO, nosniff, Referrer/Permissions 정책과 정적 자산 캐시
헤더를 설정합니다. 이 헤더 CSP는 배포 기준선으로 유지하고, `npm run build`가 내보낸 모든 HTML에
meta CSP를 추가합니다. meta CSP는 `<meta charset>` 직후에 넣고, 각 페이지 인라인 스크립트를
sha256 해시로 허용하며(`script-src 'unsafe-inline'` 없음), `connect-src`를 `'self'`와
`NEXT_PUBLIC_API_BASE_URL`에서 만든 API·WS 오리진으로 제한합니다. 환경 변수가 없거나 유효하지
않으면 빌드가 실패합니다. `frame-ancestors`와 `upgrade-insecure-requests`는 헤더에만 둡니다.

## Vercel 배포 (정적)

1. `DegreeCode/web-tradex` 저장소를 Import 하고 **Root Directory를 저장소 루트(`./`)** 로 지정합니다.
2. Framework Preset은 **Next.js**(자동 감지)를 그대로 두면 `output: "export"`를 인식해 `out/`를
   정적으로 서빙합니다. 다른 프리셋을 쓸 경우 Output Directory를 `out`으로 지정하세요.
3. 환경 변수 **`NEXT_PUBLIC_API_BASE_URL`** 에 백엔드 주소를 넣습니다 (예: `https://api.example.com`).
   빌드 시점에 번들에 인라인되므로 변경하면 재배포해야 합니다.
4. Settings → Domains 에서 커스텀 도메인(예: `app.example.com`)을 연결합니다.
5. API 서버의 허용 오리진을 새 도메인으로 맞춥니다.

`vercel.json`은 `buildCommand`로 `npm run build`를 실행하고, 모든 경로에 HSTS, 클릭재킹 차단
(`frame-ancestors 'none'`·`X-Frame-Options`), `form-action 'self'`,
`Cross-Origin-Opener-Policy: same-origin`, `nosniff`, Referrer/Permissions 정책과 정적 자산 캐시
헤더를 붙입니다. 헤더 CSP와 meta CSP는 함께 적용됩니다.

## 화면과 사용 API

| 화면 | 경로 | 사용 API |
| --- | --- | --- |
| 홈 | `/` | `GET /market`, `/me/nav`, `/me/nav/history`, `/me/accounts`, `/me/accounts/{id}/portfolio` |
| 마켓 | `/market` | `GET /market/tickers`(정렬 순서) + `tickers` WS |
| 종목 상세 | `/market/symbol?symbol=…` | `GET /exchange/info`, `GET /market/symbols/{symbol}/trades`, `/candles`, `/disclosures`, `POST /orders/simulation`, `POST /orders` |
| 주문 | `/orders` | `GET /orders`, `POST /orders/{id}/cancellation`, `GET /me/trades` |
| 투자 | `/portfolio` | `GET /me/nav`, `/me/nav/history`, `/me/accounts/{id}/portfolio/history`, `/me/realized-pnl` |
| 마진 | `/margin` | `GET/POST /margin/positions`, `/margin/positions/{id}/…`, `POST …/simulation` |
| 송금 | `/transfers` | `GET/POST /transfers`, `GET /transfers/{id}` (목록에 당사자 ID가 없는 이전 백엔드에서만), `PATCH /transfers/{id}/recipient-decision`, `POST /transfers/{id}/cancellation` |
| 계좌 | `/accounts` | `GET/POST /me/accounts`, `DELETE /me/accounts/{id}` |
| 보안 | `/security` | `/me/passkeys*`, `/me/sessions*`(limit 50 + cursor), `/me/recovery-keys/rotate`, `/auth/logout`, `/auth/step-up/*`(필요할 때) |
| 종목 상장 | `/listings/new` | `POST /symbols` |
| 알림 | `/notifications` | `GET /notifications`, `POST /notifications/{id}/read`, `/read-batch`, `/read-all` |
| 고객센터 | `/support` | `GET/POST /inquiries`, `GET /inquiries/{ticket}`, `GET/POST /inquiries/{ticket}/messages`, `/resolution` |
| 기기 연결 | `/link` | `POST /auth/device-links`, `GET /auth/device-links/current`, `POST /me/device-links/lookup`, `/approve-options`, `/approve`, `/deny` |
| 설정 | `/settings` | 업무 API 없음(로컬 환경설정만 저장) |
| 발행사 관리 | `/market/symbol` (매니저에게만 표시) | `PATCH /symbols/{symbol}`, `GET /symbols/{symbol}/issuance-preview`, `POST /symbols/{symbol}/issuances`, `/symbols/{symbol}/manager-transfer-requests*` |

종목 기본정보는 화면마다 조회하지 않고 `GET /market/symbols`(최초 1회), `/market/symbols/changes`,
`/market/symbols/batch`로 탭 간에 공유하는 로컬 캐시를 동기화해 씁니다.
종목 식별자는 대문자로 바꾸고 형식(영문 1~8자)을 검증한 뒤 사용하므로 소문자 공유 링크도 같은 종목으로 엽니다.
송금은 조회 가능한 경우 `exchange/info.transfer.fee_ppm`으로 수수료를 표시하고 금액+수수료를 검증하며,
주식 수수료는 추정값이고 추정할 수 없으면 서버 판정을 따릅니다.

## 둘러보기 (비로그인)

로그인하지 않아도 마켓(`/market`)과 종목 상세(`/market/symbol`)는 볼 수 있습니다. 로그인 화면의
"로그인 없이 마켓 둘러보기"로 들어가며, 다른 화면은 로그인 화면으로 보냅니다. 주문 영역은 로그인 후
같은 종목으로 돌아오는 버튼으로 바뀌고, 최근 체결·공시는 로그인 안내로 대신합니다.

비로그인 공개 API는 IP당 분당 60회로 제한되므로 둘러보기는 다음 원칙을 따릅니다.

- WebSocket은 public·private 모두 열지 않습니다(SharedWorker도 띄우지 않음). 세션이 확인된 뒤에만 연결합니다.
- 로그인 전용 API와 체결 내역(`/trades`), 공시(`/disclosures`)를 호출하지 않습니다. 종목 상세는
  차트 설정을 위해 `GET /exchange/info`를 한 번 조회합니다.
  `tradex_csrf` 쿠키는 세션 쿠키와 함께 발급·삭제되므로, 이 쿠키가 없으면 `GET /me`도 보내지 않습니다.
- 시세는 5초마다 폴링합니다(숨겨진 탭은 멈춤).
  - 마켓: `GET /market/tickers?sort=…&limit=200` 한 번으로 정렬 순서와 시세를 함께 받습니다.
  - 종목 상세: `GET /market/tickers/{symbol}`.
- 캔들은 종목 화면에 들어올 때(기간을 바꿀 때 포함) 한 번만 불러오고, 이전 캔들 불러오기·포커스 재조회는
  하지 않습니다. 이후에는 폴링한 시세에서 체결 수가 늘면 그 사이의 체결을 한 건으로 묶어 마지막 체결가를
  종가로, 고가·저가와 거래량(시세의 당일 거래량 차이)을 현재 캔들에 반영합니다. 5초 사이의 중간 고가·저가는
  담기지 않습니다.
- 그 밖에는 종목 기본정보 동기화(`symbols/changes`, 분당 1회)뿐이라 화면당 분당 약 13회입니다.

로그인 상태의 요청은 공개 API를 포함해 모두 세션 쿠키를 싣기 때문에(`credentials: "include"`),
서버가 인증된 요청에 별도 한도를 적용하면 비로그인 IP 한도와 따로 계산됩니다.

인증 화면: `/login`(패스키·복구키), `/signup`(가입 + 복구키 8개 발급), `/invite`(초대 수락),
`/recover`(복구 모드에서 새 패스키 등록). 약관: `/terms`, `/privacy`.

## WebSocket (실시간)

`ws.ts`는 SharedWorker 사용 가능 여부를 골라 탭 간 공유 소켓 또는 탭 직접 소켓을 만들고,
`ws-transport.ts`의 `TradexSocket`이 연결·재연결을 소유합니다. SharedWorker를 쓰면 `ws-worker.ts`와
`ws-hub.ts`가 두 소켓을 대신 운영하고, 공통 훅 정책은 `src/lib/hooks/socket.ts`에 있습니다.
스트림 훅은 수신 프레임을 React Query 캐시에 반영합니다. 채널 구독은 참조 카운트로 관리되며,
끊기면 1s→30s 지수 백오프로 재연결합니다. SharedWorker 프로토콜은 v2이며 private 메시지에 세션
세대를 실어, 계정 초기화가 확인될 때까지 이전 계정의 대기 프레임 전달을 멈춥니다.

| 소켓 | 채널 | 사용하는 화면 | 동작 |
| --- | --- | --- | --- |
| public | `tickers` | 셸 전체 | symbol 기준 시세 병합·상장폐지 tombstone 제거 |
| public | `disclosures` | 셸 전체 | 새 공시 수신 시 관련 REST 캐시 갱신 |
| public | `market_state` | 셸 전체 | 시장 상태 캐시 갱신(종목별 이벤트는 해당 종목 무효화) |
| public | `trades:{symbol}` | 종목 상세 | 스냅샷으로 교체 후 새 체결을 앞에 추가(중복은 `sequence`로 제거) |
| private | `notification.*` | 셸 · 알림 | 알림 캐시에 바로 반영하고, 체결·송금 등 알림 종류에 맞는 데이터를 무효화 |
| private | `trigger.activated` | 주문 · 투자 | 주문·체결·포트폴리오·NAV 무효화 (체결 자체는 알림으로 전달) |
| private | `transfer.updated` | 송금 | 송금·포트폴리오·NAV 무효화 |
| private | `margin.*` | 마진 | 포지션·잔고 무효화 |
| private | `listing.updated`, `issuance.created` | 마켓 | 해당 종목 기본정보 갱신 |
| private | `inquiry.replied`, `inquiry.opened` | 고객센터 | 문의 목록·상세 무효화 |

두 소켓 모두 로그인 상태에서만 열리고(둘러보기는 위의 REST 폴링), private 소켓은 로그아웃 시 닫힙니다. 공개 시세·체결·시장 상태·공시는
WS 연결 중 중복 폴링을 멈추고, 연결 종료나 sequence gap에서 REST snapshot으로 복구합니다.
체결 sequence에 빈틈이 생기면 `trades:{symbol}`을 다시 구독해 새 스냅샷을 받고, 공개 소켓이 없는
동안에는 로그인 상태에서도 기존 시세 API를 5초마다 조회하며 그 결과로 캔들도 갱신합니다(sequence
중복 제거). 소켓이 열리면 시세 폴링을 멈춥니다. 숨겨진 탭의 폴링은 중단됩니다.
private 핸드셰이크의 `AUTH_FAILED`는 일시 오류로 새 티켓으로 백오프 재시도하고, 서버가 post-auth
ping에 응답하거나 update를 보낸 뒤에만 스트림을 open으로 봅니다. 세션 만료 판정은 REST 티켓 발급
401 또는 `SESSION_INVALID`에서만 합니다.
종목 기본정보는 `symbols/changes`와 `symbols/batch`로 별도 동기화합니다.

같은 심볼이 재상장되면 새 상장 시각 이전의 공시 캐시를 제거하고, 공시 페이지 커서를 초기화해
현재 회차를 다시 조회합니다. 빈 REST 목록에 이전 WebSocket 공시를 다시 채워 넣지 않으며,
새 WebSocket 스냅샷은 실시간 공시 캐시를 교체합니다.

## 구현 메모

- **API 호출**: 모든 요청은 `src/lib/api.ts`의 단일 클라이언트를 지나며, `NEXT_PUBLIC_API_BASE_URL` +
  경로로 절대 URL을 만들어 `credentials: "include"`로 보냅니다.
- **CSRF**: `tradex_csrf` 쿠키를 읽어 `X-CSRF-Token` 헤더로 전송합니다(CSRF 쿠키는 두 호스트가 공유하는 상위 도메인으로 발급돼야 함).
- **멱등성**: 키가 필요한 변경은 논리 요청별 키를 유지합니다. 네트워크·5xx처럼 결과가 불확실한
  재시도에는 같은 키를 재사용하고, 성공 또는 확정적인 4xx 뒤의 새 요청에는 새 키를 사용합니다.
- **빠른 화면 전환**: 로그인한 사용자의 공통 메뉴는 Next.js 기본 프리페치로 정적 페이지 코드를
  미리 가져옵니다. 비로그인 상태의 공통 메뉴와 종목 목록 등의 링크는 `prefetch={false}`로
  불필요한 다운로드를 줄입니다. 프리페치는 업무 API를 호출하지 않습니다.
  공통 메뉴와 로딩 화면을 먼저 표시하고, 인증이 확인되면 페이지별 API 응답을 각 영역에 반영합니다.
- **숫자 처리**: 금액·수량·가격은 문자열 고정소수점입니다. `src/lib/format.ts`는 문자열 표시 정밀도를
  유지하고, 입력값은 전송 전에 소수점 표기를 정규화합니다(`.5`→`0.5`, `1.`→`1`, `.`은 거부;
  Credit 16자리, 수량·가격 8자리).
- **갱신**: WebSocket 실시간 반영 + 연결 종료/gap 시 REST 재조회. 캔들처럼 전용 stream이 없는
  데이터만 제한적으로 폴링합니다. 비공개 WS가 연결된 동안 계좌 데이터는 이벤트로 무효화되므로
  포커스·재마운트 재조회는 60초가 지난 뒤에만 합니다. 열려 있는 주문 묶음과 bracket 자식은 비공개
  소켓이 끊긴 동안에만 15초마다 확인합니다.
- **모듈** (`src/lib`):
  - `hooks/`: 인증·계좌·주문·송금·종목 관리·고객센터·시세·캔들·공시·알림의 React Query 훅.
    각 화면은 해당 모듈을 직접 참조하며, 공통 구독·stale time 정책은 `socket.ts`에서 관리합니다
  - `candle-query.ts`: 취소 신호를 전달하는 캔들 REST 스냅샷·복구 페이지 조회
  - `market-cache.ts`: 종목 메타데이터·시세·거래 상태 이벤트를 종목 목록/상세 캐시에 반영(이벤트 순서 역전 방지 워터마크 포함)
  - `notification-cache.ts`: 알림 프레임·읽음 처리를 불러온 알림 목록 캐시에 반영
- `candle-data.ts` / `candle-cache.ts`: 캔들 버킷·빈 구간 계산 / 실시간 체결을 캔들 캐시에 합치는 런타임.
    체결마다 같은 타임스탬프를 다시 계산하지 않도록 버킷·시각 파싱 결과를 상한 있는 메모로
    재사용하고, 마지막 종목 스트림을 닫으면 체결 재생 상태를 해제합니다
  - `symbol-metadata.ts`: 탭 간에 공유하는 종목 메타데이터 localStorage 캐시
  - `accounts.ts`·`instruments.ts`·`clipboard.ts`: 계좌 표시 이름(“추가 계좌 2”), 상한가·최근 체결 표시 조건, 복사 처리
- **화면 공통**: 페이지 제목은 `PageHeader`, 커서 목록의 다음 페이지는 `LoadMoreButton`(필터 결과가 비어도 표시),
  되돌릴 수 없는 동작(계좌·패스키 삭제, 복구키 재발급, 전체 로그아웃)은 `ConfirmDialog`로 확인합니다.
  화면 렌더링 오류는 `(app)/error.tsx`가 셸을 유지한 채 다시 시도 화면을 보여주고, 없는 주소는 `not-found.tsx`가 처리합니다.
  탭 제목은 경로별 `layout.tsx`의 metadata(`%s · TradeX`)로 정합니다.
- **세션 만료**: `401 SESSION_INVALID` 수신 시 `["me"]` 캐시를 `null`로 내려 로그인 화면으로 보냅니다.
  이때 재요청(invalidate)은 하지 않습니다 — 무효화하면 401→이벤트→재요청이 무한 반복됩니다.
  비공개 조회 캐시는 사용자별 키가 없으므로, 로그인 상태가 끝나면 `["me"]`를 뺀 캐시를 지우고
  다른 계정으로 바뀌면 다시 조회합니다. 로그인·로그아웃·계정 전환은 `BroadcastChannel`/`storage`로
  다른 탭에 전파해 각 탭이 `/me`를 다시 확인하고 비공개 캐시를 비웁니다. 같은 전환이 두 전달 경로로
  들어와도 한 번만 처리하고, 새 세션 확인 중에는 이전 사용자 정보를 숨깁니다. 요청은 시작 시 세션
  세대를 기록해 뒤늦게 도착한 이전 세션 응답이 현재 세션을 만료·차단하지 않게 하고, 패스키 성공은
  이동 전에 다른 탭에 refresh를 전파합니다.
- **캔들 히스토리**: 최신 구간은 5,000버킷으로 제한해 실시간 병합 비용을 유지하고, 창을 벗어난 실제
  캔들은 `history`로 보관합니다. 서버 커서를 폐기하지 않으므로 차트는 아래쪽으로 계속 스크롤하거나
  "이전 캔들 더 불러오기"를 눌러 오래된 REST 페이지를 계속 가져올 수 있습니다. 불변 캔들 행 기준으로
  차트 점 변환을 캐시합니다.
- **패스키 재인증**: 서버가 송금·계좌 삭제·패스키 추가/삭제·복구키 재발급에 `403 STEP_UP_REQUIRED`를
  보내면 `POST /auth/step-up/options`·`/verify`로 패스키를 다시 확인한 뒤 같은 요청(같은 멱등 키)을
  한 번 다시 보냅니다. 동시에 거부된 요청은 패스키 확인 한 번을 공유하고, 취소하면 원래 거부를 그대로
  보여줍니다. WebAuthn 코드는 처음 재인증이 필요할 때만 불러옵니다.
- **복구 모드**: `403 RECOVERY_RESTRICTED`는 별도 상태로 처리해 `/recover`에서 새 패스키를 등록하도록 안내합니다.

## 스크립트

```bash
npm run dev      # 개발 서버 (next dev)
npm run build    # 정적 빌드 → out/ + 페이지별 meta CSP
npm run start    # out/ 정적 미리보기 (serve)
npm run lint     # ESLint
npm run typecheck # TypeScript 검사
npm test         # 단위 테스트 (node:test + tsx, tests/**/*.test.ts)
npm run check    # lint + typecheck + test
npm run check:bundle # 22개 내보낸 경로의 스크립트 용량 예산 검사
```

## 의존성 메모

모듈별 점검 기록은 커밋하지 않고 로컬에만 유지합니다.

- Next.js·eslint-config-next는 16.4.3, TanStack React Query는 5.104.5, lucide-react는 1.61.0을 사용합니다.
- ESLint는 9를 유지합니다. `eslint-plugin-react`(eslint-config-next 포함)의 peer 범위가 ESLint 9까지입니다.
- TypeScript는 6.0을 유지하고 컴파일 target은 ES2022입니다. `typescript-eslint`의 지원 범위가 `<6.1.0`입니다.
- Next.js는 보안 릴리스 대응을 위해 정확한 버전으로 고정합니다.
- `@types/node`는 개발 환경의 Node 24 LTS와 맞춥니다.
- shadcn으로 생성한 UI 컴포넌트는 소스에서 관리합니다. 생성 CLI를 설치 의존성으로
  유지하지 않으며, 실제 사용하는 Base UI 상태 스타일은 `globals.css`에 정의합니다.
- 로컬 정적 서버 `serve`가 고정한 `compression`은 메모리 누수 수정판인 1.8.2 이상으로
  override합니다. 상위 패키지에서 수정판을 사용하면 override를 제거할 수 있습니다.
- 2026-10-25 검사 기준 `npm audit`(개발 의존성 포함)은 취약점 0건입니다. `serve`가 쓰는
  `fast-uri`는 URI 해석 취약점 수정판(3.1.9 이상)으로 잠금 파일에서 갱신했습니다.

## 라이선스

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only)을 따릅니다.
