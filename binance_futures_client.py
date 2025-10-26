import time
import hmac
import hashlib
import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


class BinanceFuturesAPIError(Exception):
    def __init__(self, status, code, msg):
        super().__init__(f"HTTP {status} Binance Futures error {code}: {msg}")
        self.status = status
        self.code = code
        self.msg = msg


class BinanceFuturesClient:
    """
    외부 의존성 없이 동작하는 최소한의 바이낸스 USDT-M 선물 클라이언트(REST)입니다.\n    기본 base_url: 프로덕션 https://fapi.binance.com\n    테스트넷: https://testnet.binancefuture.com
    """

    def __init__(
        self,
        api_key=None,
        api_secret=None,
        base_url="https://fapi.binance.com",
        recv_window=5000,
        timeout=10,
    ):
        self.api_key = api_key or ""
        self.api_secret = api_secret or ""
        self.base_url = base_url.rstrip("/")
        self.recv_window = int(recv_window)
        self.timeout = timeout

    # ---------- 저수준 HTTP 헬퍼 ----------
    def _sign(self, params: dict) -> str:
        query = urlencode(params, doseq=True)
        signature = hmac.new(
            self.api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return signature

    def _request(
        self, method: str, path: str, params: dict | None = None, signed: bool = False
    ):
        params = params.copy() if params else {}
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
        }
        if signed:
            if not self.api_key or not self.api_secret:
                raise ValueError("Signed endpoint requires api_key and api_secret")
            headers["X-MBX-APIKEY"] = self.api_key
            params.setdefault("recvWindow", self.recv_window)
            params["timestamp"] = int(time.time() * 1000)
            params["signature"] = self._sign(params)

        url = f"{self.base_url}{path}"
        data_bytes = None
        if method.upper() in ("GET", "DELETE"):
            if params:
                url = f"{url}?{urlencode(params, doseq=True)}"
        else:
            data_bytes = urlencode(params, doseq=True).encode("utf-8")

        req = Request(url=url, data=data_bytes, method=method.upper(), headers=headers)
        try:
            with urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                if not raw:
                    return None
                return json.loads(raw)
        except HTTPError as e:
            try:
                payload = e.read().decode("utf-8")
                data = json.loads(payload) if payload else {}
                code = data.get("code", "unknown")
                msg = data.get("msg", str(e))
            except Exception:
                code = "unknown"
                msg = str(e)
            raise BinanceFuturesAPIError(e.code, code, msg)
        except URLError as e:
            raise ConnectionError(f"Network error: {e}")

    # ---------- 공개 엔드포인트 ----------
    def get_price(self, symbol: str = "BTCUSDT") -> float:
        data = self._request("GET", "/fapi/v1/ticker/price", {"symbol": symbol})
        return float(data["price"])  # type: ignore[index]

    def get_order_book(self, symbol: str = "BTCUSDT", limit: int = 10) -> dict:
        limit = max(5, min(int(limit), 5000))
        return self._request(
            "GET", "/fapi/v1/depth", {"symbol": symbol, "limit": limit}
        )

    def get_mark_price(self, symbol: str = "BTCUSDT") -> float:
        data = self._request("GET", "/fapi/v1/premiumIndex", {"symbol": symbol})
        return float(data.get("markPrice"))

    def get_exchange_info(self, symbol: str | None = None) -> dict:
        params = {"symbol": symbol} if symbol else None
        return self._request("GET", "/fapi/v1/exchangeInfo", params)

    # ---------- 서명(프라이빗) 엔드포인트 ----------
    def get_account(self) -> dict:
        return self._request("GET", "/fapi/v2/account", signed=True)

    def get_balances(self) -> list[dict]:
        return self._request("GET", "/fapi/v2/balance", signed=True)

    def get_balance(self, asset: str) -> tuple[float, float]:
        bals = self.get_balances()
        for b in bals:
            if b.get("asset") == asset:
                return float(b.get("balance", 0)), float(b.get("withdrawAvailable", 0))
        return 0.0, 0.0

    def get_position(self, symbol: str) -> dict:
        acc = self.get_account()
        for p in acc.get("positions", []):
            if p.get("symbol") == symbol:
                return p
        return {}

    def set_margin_type(self, symbol: str, isolated: bool = True):
        mtype = "ISOLATED" if isolated else "CROSSED"
        try:
            return self._request(
                "POST",
                "/fapi/v1/marginType",
                {"symbol": symbol, "marginType": mtype},
                signed=True,
            )
        except BinanceFuturesAPIError as e:  # -4046: 이미 동일한 마진 타입 설정임
            if str(getattr(e, "code", "")) in ("-4046",):
                return None
            raise

    def set_leverage(self, symbol: str, leverage: int = 2):
        leverage = max(1, min(int(leverage), 125))
        return self._request(
            "POST",
            "/fapi/v1/leverage",
            {"symbol": symbol, "leverage": leverage},
            signed=True,
        )

    def place_order(
        self,
        *,
        symbol: str,
        side: str,
        type: str = "MARKET",
        quantity: float | None = None,
        reduce_only: bool = False,
        position_side: str | None = None,
        **extra,
    ) -> dict | None:
        side = side.upper()
        type = type.upper()
        assert side in ("BUY", "SELL")

        payload: dict[str, str | float | int] = {
            "symbol": symbol,
            "side": side,
            "type": type,
        }
        if quantity is not None:
            payload["quantity"] = quantity
        if reduce_only:
            payload["reduceOnly"] = "true"
        if position_side:
            payload["positionSide"] = position_side

        payload.update(extra)
        return self._request("POST", "/fapi/v1/order", payload, signed=True)

    # ---------- helpers ----------
    def get_symbol_filters(self, symbol: str) -> dict:
        info = self.get_exchange_info(symbol)
        symbols = info.get("symbols", [])
        if not symbols:
            return {}
        return {f["filterType"]: f for f in symbols[0].get("filters", [])}

    def clamp_quantity(self, symbol: str, qty: float) -> float:
        filters = self.get_symbol_filters(symbol)
        lot = filters.get("LOT_SIZE") or {}
        step_size = float(lot.get("stepSize", 0))
        min_qty = float(lot.get("minQty", 0))
        max_qty = float(lot.get("maxQty", 0)) or float("inf")
        if step_size > 0:
            s = f"{step_size:.16f}".rstrip("0")
            precision = len(s.split(".")[1]) if "." in s else 0
            factor = 10**precision if precision > 0 else 1
            qty = int(qty * factor) / factor
        qty = max(min_qty, min(qty, max_qty))
        return qty
