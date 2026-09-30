# TradeX Web

`tradex/core`(Go API)를 위한 트레이딩 웹 클라이언트입니다. 간결한 카드형 UI, 패스키(WebAuthn) 인증,
Vercel 정적 배포를 전제로 만들어졌습니다. 관리자(admin) API는 의도적으로 사용하지 않습니다.

## 스택

- Next.js 16 (App Router, Turbopack) · React 19 · TypeScript
- Tailwind CSS v4 · shadcn/ui (Base UI) · lucide-react
- TanStack Query v5 (WebSocket 우선, REST 복구) · Recharts · sonner
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

## Vercel 배포 (정적)

1. `DegreeCode/web-tradex` 저장소를 Import 하고 **Root Directory를 저장소 루트(`./`)** 로 지정합니다.
2. Framework Preset은 **Next.js**(자동 감지)를 그대로 두면 `output: "export"`를 인식해 `out/`를
   정적으로 서빙합니다. 다른 프리셋을 쓸 경우 Output Directory를 `out`으로 지정하세요.
3. 환경 변수 **`NEXT_PUBLIC_API_BASE_URL`** 에 백엔드 주소를 넣습니다 (예: `https://api.example.com`).
   빌드 시점에 번들에 인라인되므로 변경하면 재배포해야 합니다.
4. Settings → Domains 에서 커스텀 도메인(예: `app.example.com`)을 연결합니다.
5. API 서버의 허용 오리진을 새 도메인으로 맞춥니다.

`vercel.json`은 모든 경로에 보안 헤더(클릭재킹 차단 `frame-ancestors 'none'`·`X-Frame-Options`,
`nosniff`, Referrer/Permissions 정책)를 붙입니다.

## 화면과 사용 API

| 화면 | 경로 | 사용 API |
| --- | --- | --- |
| 홈 | `/` | `GET /market`, `/me/nav`, `/me/nav/history`, `/me/accounts`, `/me/accounts/{id}/portfolio` |
| 마켓 | `/market` | `GET /market/tickers`(정렬 순서) + `tickers` WS |
| 종목 상세 | `/market/symbol?symbol=…` | `GET /market/symbols/{symbol}/trades`, `/candles`, `/disclosures`, `POST /orders/simulation`, `POST /orders` |
| 주문 | `/orders` | `GET /orders`, `POST /orders/{id}/cancellation`, `GET /me/trades` |
| 투자 | `/portfolio` | `GET /me/nav`, `/me/nav/history`, `/me/accounts/{id}/portfolio/history`, `/me/realized-pnl` |
| 마진 | `/margin` | `GET/POST /margin/positions`, `/margin/positions/{id}/…`, `POST …/simulation` |
| 송금 | `/transfers` | `GET/POST /transfers`, `GET /transfers/{id}`, `PATCH /transfers/{id}/recipient-decision`, `POST /transfers/{id}/cancellation` |
| 계좌 | `/accounts` | `GET/POST /me/accounts`, `DELETE /me/accounts/{id}` |
| 보안 | `/security` | `/me/passkeys*`, `/me/sessions*`, `/me/recovery-keys/rotate`, `/auth/logout` |
| 종목 상장 | `/listings/new` | `POST /symbols` |
| 알림 | `/notifications` | `GET /notifications`, `POST /notifications/{id}/read`, `/read-batch`, `/read-all` |
| 고객센터 | `/support` | `GET/POST /inquiries`, `GET /inquiries/{ticket}`, `POST /inquiries/{ticket}/messages`, `/resolution` |
| 발행사 관리 | `/market/symbol` (매니저에게만 표시) | `PATCH /symbols/{symbol}`, `GET /symbols/{symbol}/issuance-preview`, `POST /symbols/{symbol}/issuances`, `/symbols/{symbol}/manager-transfer-requests*` |

종목 기본정보는 화면마다 조회하지 않고 `GET /market/symbols`(최초 1회), `/market/symbols/changes`,
`/market/symbols/batch`로 탭 간에 공유하는 로컬 캐시를 동기화해 씁니다.

인증 화면: `/login`(패스키·복구키), `/signup`(가입 + 복구키 8개 발급), `/invite`(초대 수락),
`/recover`(복구 모드에서 새 패스키 등록). 약관: `/terms`, `/privacy`.

## WebSocket (실시간)

`src/lib/ws.ts`가 연결을 관리하고, `src/lib/hooks.ts`의 스트림 훅이 수신 프레임을 React Query 캐시에
반영합니다. 채널 구독은 참조 카운트로 관리되며, 끊기면 1s→30s 지수 백오프로 재연결합니다.

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
| private | `inquiry.replied` | 고객센터 | 문의 목록·상세 무효화 |

private 소켓은 로그인 상태에서만 열리고, 로그아웃 시 닫힙니다. 공개 시세·체결·시장 상태·공시는
WS 연결 중 중복 폴링을 멈추고, 연결 종료나 sequence gap에서 REST snapshot으로 복구합니다.
종목 기본정보는 `symbols/changes`와 `symbols/batch`로 별도 동기화합니다.

## 구현 메모

- **API 호출**: 모든 요청은 `src/lib/api.ts`의 단일 클라이언트를 지나며, `NEXT_PUBLIC_API_BASE_URL` +
  경로로 절대 URL을 만들어 `credentials: "include"`로 보냅니다.
- **CSRF**: `tradex_csrf` 쿠키를 읽어 `X-CSRF-Token` 헤더로 전송합니다(CSRF 쿠키는 두 호스트가 공유하는 상위 도메인으로 발급돼야 함).
- **멱등성**: 키가 필요한 변경은 논리 요청별 키를 유지합니다. 네트워크·5xx처럼 결과가 불확실한
  재시도에는 같은 키를 재사용하고, 성공 또는 확정적인 4xx 뒤의 새 요청에는 새 키를 사용합니다.
- **빠른 화면 전환**: 공통 메뉴는 Next.js 기본 프리페치로 정적 페이지 코드를 미리 가져오며,
  종목 목록 등의 링크는 `prefetch={false}`를 유지합니다. 프리페치는 업무 API를 호출하지 않습니다.
  공통 메뉴와 로딩 화면을 먼저 표시하고, 인증이 확인되면 페이지별 API 응답을 각 영역에 반영합니다.
- **숫자 처리**: 금액·수량·가격은 문자열 고정소수점입니다. `src/lib/format.ts`는 문자열 표시 정밀도를
  유지하고, 입력값은 검증 후 문자열 그대로 전송합니다(Credit 16자리, 수량·가격 8자리).
- **갱신**: WebSocket 실시간 반영 + 연결 종료/gap 시 REST 재조회. 캔들처럼 전용 stream이 없는
  데이터만 제한적으로 폴링합니다. 비공개 WS가 연결된 동안 계좌 데이터는 이벤트로 무효화되므로
  포커스·재마운트 재조회는 60초가 지난 뒤에만 합니다.
- **모듈**: `src/lib/hooks.ts`는 React Query 훅과 스트림, `src/lib/symbol-metadata.ts`는 탭 간에
  공유하는 종목 메타데이터 localStorage 캐시, `src/lib/candle-data.ts`는 캔들 버킷·빈 구간 계산을 맡습니다.
- **세션 만료**: `401 SESSION_INVALID` 수신 시 `["me"]` 캐시를 `null`로 내려 로그인 화면으로 보냅니다.
  이때 재요청(invalidate)은 하지 않습니다 — 무효화하면 401→이벤트→재요청이 무한 반복됩니다.
- **복구 모드**: `403 RECOVERY_RESTRICTED`는 별도 상태로 처리해 `/recover`에서 새 패스키를 등록하도록 안내합니다.

## 스크립트

```bash
npm run dev      # 개발 서버 (next dev)
npm run build    # 정적 빌드 → out/
npm run start    # out/ 정적 미리보기 (serve)
npm run lint     # ESLint
npm test         # 단위 테스트 (node:test + tsx, tests/*.test.{ts,mjs})
```

## 라이선스

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only)을 따릅니다.
