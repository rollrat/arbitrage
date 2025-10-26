import os
import time
import json
import argparse
from dataclasses import dataclass

from binance_client import BinanceClient, BinanceAPIError
from binance_futures_client import BinanceFuturesClient, BinanceFuturesAPIError


# --- 간단 .env 로더 ---
def load_env_file(path: str | None) -> None:
    if not path:
        return
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ[k.strip()] = v.strip().strip('"').strip("'")


# --- 구성 헬퍼 ---
def truthy(s: str | None) -> bool:
    return bool(s) and s.strip().lower() in {"1", "true", "yes", "on", "y"}


def spot_base_url(args) -> str:
    if args.base_url:
        return args.base_url
    if os.getenv("BINANCE_BASE_URL"):
        return os.getenv("BINANCE_BASE_URL")
    return (
        "https://testnet.binance.vision"
        if args.testnet or truthy(os.getenv("BINANCE_TESTNET"))
        else "https://api.binance.com"
    )


def futures_base_url(args) -> str:
    if args.futures_base_url:
        return args.futures_base_url
    if os.getenv("BINANCE_FUTURES_BASE_URL"):
        return os.getenv("BINANCE_FUTURES_BASE_URL")
    return (
        "https://testnet.binancefuture.com"
        if args.futures_testnet or truthy(os.getenv("BINANCE_FUTURES_TESTNET"))
        else "https://fapi.binance.com"
    )


def build_spot(args) -> BinanceClient:
    api_key = os.getenv("BINANCE_API_KEY", "")
    api_secret = os.getenv("BINANCE_API_SECRET", "")
    return BinanceClient(
        api_key=api_key, api_secret=api_secret, base_url=spot_base_url(args)
    )


def build_futures(args) -> BinanceFuturesClient:
    f_key = os.getenv("BINANCE_FUTURES_API_KEY") or os.getenv("BINANCE_API_KEY", "")
    f_sec = os.getenv("BINANCE_FUTURES_API_SECRET") or os.getenv(
        "BINANCE_API_SECRET", ""
    )
    return BinanceFuturesClient(
        api_key=f_key, api_secret=f_sec, base_url=futures_base_url(args)
    )


@dataclass
class Params:
    symbol: str
    notional: float
    entry_bps: float
    exit_bps: float
    interval: float
    leverage: int
    isolated: bool
    dry_run: bool


STATE_FILE = "arb_state.json"


def read_state() -> dict:
    if not os.path.exists(STATE_FILE):
        return {}
    with open(STATE_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except Exception:
            return {}


def write_state(d: dict) -> None:
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2)


# --- 핵심 로직 ---
def ensure_futures_setup(
    fut: BinanceFuturesClient, symbol: str, leverage: int, isolated: bool
):
    try:
        fut.set_margin_type(symbol, isolated=isolated)
    except BinanceFuturesAPIError as e:
        print(f"warn: margin type set failed: {e}")
    try:
        fut.set_leverage(symbol, leverage)
    except BinanceFuturesAPIError as e:
        print(f"warn: leverage set failed: {e}")


def compute_basis_bps(spot_price: float, futures_mark: float) -> float:
    if spot_price <= 0:
        return 0.0
    return (futures_mark - spot_price) / spot_price * 10000.0


def size_from_notional(
    spot: BinanceClient, symbol: str, notional: float, spot_price: float
) -> float:
    qty = notional / spot_price
    qty = spot.clamp_quantity(symbol, qty)
    return qty


def open_pair(
    spot: BinanceClient,
    fut: BinanceFuturesClient,
    symbol: str,
    qty: float,
    dry_run: bool = False,
) -> dict:
    # 스팟/선물 양쪽 스텝(stepSize)에 맞춰 보정하고, 더 엄격한 수량 사용
    spot_qty = spot.clamp_quantity(symbol, qty)
    fut_qty = fut.clamp_quantity(symbol, qty)
    use_qty = min(spot_qty, fut_qty)

    actions = {"spot_buy": None, "futures_short": None}
    if dry_run:
        print(f"DRY: spot BUY {symbol} qty={use_qty}")
        print(f"DRY: futures SELL(short) {symbol} qty={use_qty}")
        return actions

    if use_qty <= 0:
        # Provide guidance on minimal quantity based on futures LOT_SIZE
        try:
            f = fut.get_symbol_filters(symbol).get("LOT_SIZE", {})
            min_qty = float(f.get("minQty", 0))
            step_size = float(f.get("stepSize", 0))
            print(
                f"skip: clamped qty is 0; increase notional. futures.minQty={min_qty}, stepSize={step_size}"
            )
        except Exception:
            print("skip: clamped qty is 0; increase notional.")
        return actions

    actions["spot_buy"] = spot.place_order(
        symbol=symbol, side="BUY", type="MARKET", quantity=use_qty, test=False
    )
    actions["futures_short"] = fut.place_order(
        symbol=symbol, side="SELL", type="MARKET", quantity=use_qty
    )
    return actions


def close_pair(
    spot: BinanceClient,
    fut: BinanceFuturesClient,
    symbol: str,
    qty: float,
    dry_run: bool = False,
) -> dict:
    actions = {"futures_close": None, "spot_sell": None}
    if dry_run:
        print(f"DRY: futures BUY(reduceOnly) {symbol} qty={qty}")
        print(f"DRY: spot SELL {symbol} qty={qty}")
        return actions
    actions["futures_close"] = fut.place_order(
        symbol=symbol, side="BUY", type="MARKET", quantity=qty, reduce_only=True
    )
    actions["spot_sell"] = spot.place_order(
        symbol=symbol, side="SELL", type="MARKET", quantity=qty, test=False
    )
    return actions


def base_asset_from_symbol(symbol: str) -> str:
    if symbol.endswith("USDT"):
        return symbol[:-4]
    return symbol[:3]


def open_pair_reverse(
    spot: BinanceClient,
    fut: BinanceFuturesClient,
    symbol: str,
    qty: float,
    dry_run: bool = False,
) -> dict:
    # 스팟/선물 양쪽 스텝(stepSize)에 맞춰 보정하고, 더 엄격한 수량 사용
    spot_qty = spot.clamp_quantity(symbol, qty)
    fut_qty = fut.clamp_quantity(symbol, qty)
    use_qty = min(spot_qty, fut_qty)

    actions = {"spot_sell": None, "futures_long": None}
    if dry_run:
        print(f"DRY: spot SELL {symbol} qty={use_qty}")
        print(f"DRY: futures BUY(long) {symbol} qty={use_qty}")
        return actions

    if use_qty <= 0:
        try:
            f = fut.get_symbol_filters(symbol).get("LOT_SIZE", {})
            min_qty = float(f.get("minQty", 0))
            step_size = float(f.get("stepSize", 0))
            print(
                f"skip: clamped qty is 0; increase notional. futures.minQty={min_qty}, stepSize={step_size}"
            )
        except Exception:
            print("skip: clamped qty is 0; increase notional.")
        return actions

    actions["spot_sell"] = spot.place_order(
        symbol=symbol, side="SELL", type="MARKET", quantity=use_qty, test=False
    )
    actions["futures_long"] = fut.place_order(
        symbol=symbol, side="BUY", type="MARKET", quantity=use_qty
    )
    return actions


def close_pair_reverse(
    spot: BinanceClient,
    fut: BinanceFuturesClient,
    symbol: str,
    qty: float,
    dry_run: bool = False,
) -> dict:
    actions = {"futures_close": None, "spot_buy": None}
    if dry_run:
        print(f"DRY: futures SELL(reduceOnly) {symbol} qty={qty}")
        print(f"DRY: spot BUY {symbol} qty={qty}")
        return actions
    actions["futures_close"] = fut.place_order(
        symbol=symbol, side="SELL", type="MARKET", quantity=qty, reduce_only=True
    )
    actions["spot_buy"] = spot.place_order(
        symbol=symbol, side="BUY", type="MARKET", quantity=qty, test=False
    )
    return actions


def run_loop(args, p: Params):
    spot = build_spot(args)
    fut = build_futures(args)
    ensure_futures_setup(fut, p.symbol, p.leverage, p.isolated)

    state = read_state()
    open_flag = bool(state.get("open", False))
    open_qty = float(state.get("qty", 0.0))

    while True:
        try:
            s_price = spot.get_price(p.symbol)
            f_mark = fut.get_mark_price(p.symbol)
        except (BinanceAPIError, BinanceFuturesAPIError) as e:
            print(f"data error: {e}")
            time.sleep(max(1.0, p.interval * 2))
            continue

        basis_bps = compute_basis_bps(s_price, f_mark)
        print(
            f"spot={s_price:.2f} mark={f_mark:.2f} basis_bps={basis_bps:.2f} open={open_flag} qty={open_qty}"
        )

        mode = getattr(args, "mode", "carry")

        if not open_flag:
            if mode in ("carry", "auto") and basis_bps > p.entry_bps:
                qty = size_from_notional(spot, p.symbol, p.notional, s_price)
                try:
                    acts = open_pair(spot, fut, p.symbol, qty, dry_run=p.dry_run)
                    open_flag = True
                    open_qty = qty
                    state.update(
                        {
                            "open": True,
                            "dir": "carry",
                            "qty": qty,
                            "symbol": p.symbol,
                            "last_open_basis_bps": basis_bps,
                            "actions": acts,
                        }
                    )
                    write_state(state)
                    print(f"OPENED carry qty={qty}")
                except (BinanceAPIError, BinanceFuturesAPIError) as e:
                    print(f"open error: {e}")
            elif mode in ("reverse", "auto") and basis_bps < -p.entry_bps:
                qty = size_from_notional(spot, p.symbol, p.notional, s_price)
                base = base_asset_from_symbol(p.symbol)
                free, _ = spot.get_balance(base)
                qty = min(qty, free)
                qty = spot.clamp_quantity(p.symbol, qty)
                if qty <= 0:
                    print("skip reverse open: insufficient spot inventory to sell")
                else:
                    try:
                        acts = open_pair_reverse(
                            spot, fut, p.symbol, qty, dry_run=p.dry_run
                        )
                        open_flag = True
                        open_qty = qty
                        state.update(
                            {
                                "open": True,
                                "dir": "reverse",
                                "qty": qty,
                                "symbol": p.symbol,
                                "last_open_basis_bps": basis_bps,
                                "actions": acts,
                            }
                        )
                        write_state(state)
                        print(f"OPENED reverse qty={qty}")
                    except (BinanceAPIError, BinanceFuturesAPIError) as e:
                        print(f"open error: {e}")
        else:
            direction = state.get("dir", "carry")
            if direction == "carry" and basis_bps < p.exit_bps:
                try:
                    acts = close_pair(spot, fut, p.symbol, open_qty, dry_run=p.dry_run)
                    open_flag = False
                    state.update(
                        {
                            "open": False,
                            "last_close_basis_bps": basis_bps,
                            "actions": acts,
                        }
                    )
                    write_state(state)
                    print("CLOSED carry")
                except (BinanceAPIError, BinanceFuturesAPIError) as e:
                    print(f"close error: {e}")
            elif direction == "reverse" and basis_bps > -p.exit_bps:
                try:
                    acts = close_pair_reverse(
                        spot, fut, p.symbol, open_qty, dry_run=p.dry_run
                    )
                    open_flag = False
                    state.update(
                        {
                            "open": False,
                            "last_close_basis_bps": basis_bps,
                            "actions": acts,
                        }
                    )
                    write_state(state)
                    print("CLOSED reverse")
                except (BinanceAPIError, BinanceFuturesAPIError) as e:
                    print(f"close error: {e}")

        time.sleep(p.interval)


def main():
    ap = argparse.ArgumentParser(
        description="간단한 현·선물 아비트라지 러너 (캐시앤캐리 + 리버스)"
    )
    ap.add_argument("--env", help=".env/.env.testnet 파일 경로")
    ap.add_argument("--testnet", action="store_true", help="스팟 테스트넷 사용")
    ap.add_argument("--base-url", help="스팟 베이스 URL 수동 지정")
    ap.add_argument(
        "--futures-testnet", action="store_true", help="선물 테스트넷 사용"
    )
    ap.add_argument("--futures-base-url", help="선물 베이스 URL 수동 지정")

    ap.add_argument("--symbol", default="BTCUSDT")
    ap.add_argument(
        "--notional", type=float, default=50.0, help="스팟 측 USDT 명목가(수량 산출용)"
    )
    ap.add_argument(
        "--entry-bps",
        type=float,
        default=2.0,
        help="진입 임계값(bps). 모드에 따라 부호 적용",
    )
    ap.add_argument(
        "--exit-bps",
        type=float,
        default=0.2,
        help="청산 임계값(bps). 모드에 따라 부호 적용",
    )
    ap.add_argument(
        "--interval", type=float, default=2.0, help="폴링 간격(초)"
    )
    ap.add_argument("--leverage", type=int, default=2)
    ap.add_argument(
        "--isolated", action="store_true", help="선물 격리 마진 사용"
    )
    ap.add_argument("--dry-run", action="store_true", help="주문 미발송(시뮬레이션)")
    ap.add_argument(
        "--mode",
        choices=["carry", "reverse", "auto"],
        default="carry",
        help="전략 모드: carry(스팟 매수+선물 숏), reverse(스팟 매도+선물 롱; 보유분만), auto(자동)",
    )

    args = ap.parse_args()

    if args.env:
        load_env_file(args.env)
    else:
        if os.path.exists(".env"):
            load_env_file(".env")

    params = Params(
        symbol=args.symbol,
        notional=args.notional,
        entry_bps=args.entry_bps,
        exit_bps=args.exit_bps,
        interval=args.interval,
        leverage=args.leverage,
        isolated=args.isolated,
        dry_run=args.dry_run,
    )

    run_loop(args, params)


if __name__ == "__main__":
    main()

