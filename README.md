# Minimal Binance Spot Bot (Python)

기능
- 가격 조회: BTCUSDT 등 심볼 현재가
- 오더북 조회: 지정한 개수만큼 상위 호가
- 잔고 조회: 스팟 계정의 BTC/USDT 잔고 (free/locked)
- 주문: 시장가 매수/매도 + 테스트 주문
- .env 파일 설정 지원, Testnet 지원

설치/준비
- Python 3.10+ 권장
- .env 파일(예시) — 프로젝트 루트에 생성
  BINANCE_API_KEY=your_key
  BINANCE_API_SECRET=your_secret
  # 선택: 테스트넷 사용
  BINANCE_TESTNET=true
  # 혹은 명시적 베이스 URL 지정 (위보다 우선)
  # BINANCE_BASE_URL=https://testnet.binance.vision

- 또는 환경변수 설정 (PowerShell)
  setx BINANCE_API_KEY "your_key"
  setx BINANCE_API_SECRET "your_secret"
  (새 터미널 열기)

Testnet
- 플래그: --testnet 사용 시 기본 베이스 URL을 https://testnet.binance.vision 으로 설정
- 환경변수: BINANCE_TESTNET=true 를 .env 또는 시스템 환경변수로 설정
- 베이스 URL 우선순위: --base-url > BINANCE_BASE_URL > --testnet/BINANCE_TESTNET > 기본(prod)
- 주의: 테스트넷은 테스트넷 전용 키가 필요합니다.

사용법
- 가격:       python main.py price --symbol BTCUSDT
- 오더북:     python main.py orderbook --symbol BTCUSDT --limit 10
- 잔고:       python main.py balances
- 테스트매수: python main.py --testnet test-buy --symbol BTCUSDT --quote 20
- 테스트매도: python main.py --testnet test-sell --symbol BTCUSDT --qty 0.001
- 실매수:     python main.py buy --symbol BTCUSDT --quote 20  (또는 --qty)
- 실매도:     python main.py sell --symbol BTCUSDT --qty 0.001
- .env 경로 지정: python main.py --env .env.local price
- 베이스 URL 직접 지정: python main.py --base-url https://testnet.binance.vision price

주의사항
- 실거래 전에 test-order로 먼저 검증하세요.
- LOT_SIZE, MIN_NOTIONAL 등 거래제한으로 너무 작은 양/금액은 실패할 수 있습니다.
- 지역/계정 제한 및 API 제한을 준수하세요.

Troubleshooting
- -2015 Invalid API-key, IP, or permissions:
  - Testnet 사용 시 반드시 테스트넷 전용 API 키/시크릿을 사용하세요 (prod 키와 다릅니다).
  - API 키 권한에서 Spot Trading 권한을 활성화하세요.
  - IP 화이트리스트가 켜져 있으면 현재 IP를 등록하거나 제한을 해제하세요.
  - 베이스 URL 확인: --base-url, BINANCE_BASE_URL, --testnet/BINANCE_TESTNET 설정 순으로 적용됩니다.
  - 간단 점검: `python main.py --testnet balances` 로 계정 조회 시도.
- 설정 확인: `python main.py --testnet config` 로 base URL, 키 로딩 여부, 키 prefix를 확인하세요.

Futures (USDT-M) Support
- Client: `binance_futures_client.py` (prod: https://fapi.binance.com, testnet: https://testnet.binancefuture.com)
- .env keys (optional, else falls back to spot keys):
  - BINANCE_FUTURES_API_KEY=...
  - BINANCE_FUTURES_API_SECRET=...
  - BINANCE_FUTURES_TESTNET=true
  - BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com

Arbitrage Runner (Spot–Futures Cash-and-Carry)
- File: `arb_runner.py`
- Example (testnet, dry run):
  - python arb_runner.py --env .env --testnet --futures-testnet --dry-run --notional 50 --entry-bps 2.0 --exit-bps 0.2 --isolated
- Live testnet (be careful):
  - python arb_runner.py --env .env --testnet --futures-testnet --notional 50 --entry-bps 2.0 --exit-bps 0.2 --isolated
- Flags:
  - --symbol BTCUSDT
  - --notional 50           (USDT notional for sizing)
  - --entry-bps 2.0         (enter if (mark-spot)/spot*10000 > 2.0)
  - --exit-bps 0.2          (exit if basis < 0.2 bps)
  - --interval 2            (polling seconds)
  - --leverage 2            (futures leverage)
  - --isolated              (use isolated margin)
  - --dry-run               (no orders; logs only)

Notes
- This strategy is market-neutral, not risk-free. Funding changes, fees, slippage, API failures, and liquidation risks remain.
- Test thoroughly on testnet. Start with small notionals.
- State is persisted in `arb_state.json`.

Real-time Basis Plot (GUI)
- File: `arb_plot.py`
- Shows live basis (bps) between Spot price and Futures Mark price in a window.
- Example (testnet):
  - python arb_plot.py --env .env --testnet --futures-testnet --symbol BTCUSDT --interval 1.5 --history 300 --auto-scale --entry-bps 0.5 --exit-bps 0.2
- Options:
  - --interval: polling seconds (default 1.5)
  - --history: number of recent points kept (default 300)
  - --auto-scale: enable Y-axis autoscaling (else use --y-min/--y-max)
  - --entry-bps/--exit-bps: draw threshold lines
  - --theme: dark|light
