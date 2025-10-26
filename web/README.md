# Basis Web (NestJS + React)

구성
- Server: NestJS(WS Gateway), TypeScript. `/ws` WebSocket으로 스팟/선물 베이시스 스트리밍
- Client: React + Vite + TS. 브라우저에서 실시간 그래프 렌더링

서버 설정(web/server)
- .env.example 참조하여 `.env` 생성
  - PORT=4000, SYMBOL=BTCUSDT, INTERVAL_MS=1500
  - BINANCE_TESTNET=true/false, BINANCE_BASE_URL
  - BINANCE_FUTURES_TESTNET=true/false, BINANCE_FUTURES_BASE_URL
- 스크립트
  - dev: ts-node-dev로 개발 서버
  - build/start: 컴파일/실행

클라이언트 설정(web/client)
- Vite dev 서버(5173)에서 `/ws`를 4000으로 프록시
- 접속: http://localhost:5173 (서버가 4000에서 WS 제공)

실행 순서
1) 서버 .env 작성: web/server/.env
2) (패키지 설치 필요) 각 폴더에서 `npm i`
3) 서버 실행: `npm run dev` (web/server)
4) 클라 실행: `npm run dev` (web/client)
5) 브라우저에서 http://localhost:5173 접속 → 실시간 basis 시각화

비고
- 기본은 REST 폴링으로 가격을 가져와 서버측에서 basis 계산 후 WS로 브로드캐스트합니다.
- WS 경로: `/ws` (Nest WebSocketGateway)
- Testnet/Prod 전환은 .env로 제어합니다.
