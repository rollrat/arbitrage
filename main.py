import os
import argparse
from pprint import pprint

from binance_client import BinanceClient, BinanceAPIError


def load_env_file(path: str | None) -> None:
    """Load key=value lines from a .env file into environment variables.
    Overrides existing env vars to honor the file as the source of truth.
    Lines starting with '#' are ignored.
    """
    if not path:
        return
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key:
                os.environ[key] = val


def truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on", "y"}


def resolve_base_url(args) -> str:
    if getattr(args, "base_url", None):
        return args.base_url
    env_base = os.getenv("BINANCE_BASE_URL")
    if env_base:
        return env_base
    use_testnet = getattr(args, "testnet", False) or truthy(
        os.getenv("BINANCE_TESTNET")
    )
    return (
        "https://testnet.binance.vision" if use_testnet else "https://api.binance.com"
    )


def explain_api_error(e: BinanceAPIError, args) -> None:
    code = getattr(e, "code", None)
    base_url = resolve_base_url(args)
    api_key = os.getenv("BINANCE_API_KEY", "")
    api_secret = os.getenv("BINANCE_API_SECRET", "")
    have_key = bool(api_key)
    have_secret = bool(api_secret)

    print(str(e))
    if str(code) == "-2015":
        print("Hint: -2015 means Invalid API key, IP, or permissions.")
        print(
            "- Ensure you are using TESTNET keys when using --testnet or testnet base URL."
        )
        print("- On (testnet) API key settings, enable 'Spot Trading' permissions.")
        print(
            "- If IP whitelist is enabled, add your current IP or disable restriction."
        )
        print(f"- Using base URL: {base_url}")
        print(
            f"- API key loaded: {'yes' if have_key else 'no'}, secret loaded: {'yes' if have_secret else 'no'}"
        )


def build_client(args) -> BinanceClient:
    # Load .env before reading variables
    env_path = getattr(args, "env", None)
    if env_path:
        load_env_file(env_path)
    else:
        # Load default .env if present
        default_env = ".env"
        if os.path.exists(default_env):
            load_env_file(default_env)

    api_key = os.getenv("BINANCE_API_KEY", "")
    api_secret = os.getenv("BINANCE_API_SECRET", "")
    base_url = resolve_base_url(args)
    return BinanceClient(api_key=api_key, api_secret=api_secret, base_url=base_url)


def cmd_price(args):
    client = build_client(args)
    try:
        price = client.get_price(args.symbol)
    except BinanceAPIError as e:
        explain_api_error(e, args)
        raise SystemExit(1)
    print(f"{args.symbol} price: {price}")


def cmd_orderbook(args):
    client = build_client(args)
    try:
        ob = client.get_order_book(args.symbol, args.limit)
    except BinanceAPIError as e:
        explain_api_error(e, args)
        raise SystemExit(1)
    print(f"Order book {args.symbol} (top {args.limit})")
    print("BIDS:")
    for p, q in ob.get("bids", [])[: args.limit]:
        print(f"  {p} x {q}")
    print("ASKS:")
    for p, q in ob.get("asks", [])[: args.limit]:
        print(f"  {p} x {q}")


def cmd_balances(args):
    client = build_client(args)
    try:
        for asset in ("USDT", "BTC"):
            free, locked = client.get_balance(asset)
            print(f"{asset}: free={free}, locked={locked}")
    except BinanceAPIError as e:
        explain_api_error(e, args)
        raise SystemExit(1)


def _place(args, side: str, test: bool):
    client = build_client(args)
    symbol = args.symbol

    quantity = args.qty
    quote_order_qty = args.quote

    if quantity is None and quote_order_qty is None:
        if side == "BUY":
            raise SystemExit("For BUY, provide --quote (USDT to spend) or --qty")
        else:
            raise SystemExit("For SELL, provide --qty (asset amount)")

    if quantity is not None:
        quantity = client.clamp_quantity(symbol, float(quantity))

    try:
        order = client.place_order(
            symbol=symbol,
            side=side,
            type="MARKET",
            quantity=quantity,
            quote_order_qty=quote_order_qty,
            test=test,
        )
    except BinanceAPIError as e:
        explain_api_error(e, args)
        raise SystemExit(1)

    if test:
        print("Test order OK (validated by Binance). No trade executed.")
    else:
        print("Order response:")
        pprint(order)


def cmd_buy(args):
    _place(args, "BUY", test=False)


def cmd_sell(args):
    _place(args, "SELL", test=False)


def cmd_test_buy(args):
    _place(args, "BUY", test=True)


def cmd_test_sell(args):
    _place(args, "SELL", test=True)


def cmd_config(args):
    _ = build_client(args)
    base_url = resolve_base_url(args)
    api_key = os.getenv("BINANCE_API_KEY", "")
    api_secret = os.getenv("BINANCE_API_SECRET", "")
    key_prefix = (api_key[:8] + "…") if api_key else ""
    print("Config:")
    print(f"  base_url: {base_url}")
    print(f"  testnet: {'yes' if ('testnet' in base_url) else 'no'}")
    print(f"  api_key_loaded: {'yes' if api_key else 'no'}")
    print(f"  api_secret_loaded: {'yes' if api_secret else 'no'}")
    if key_prefix:
        print(f"  api_key_prefix: {key_prefix}")


def main():
    parser = argparse.ArgumentParser(
        description="Minimal Binance Spot Bot (price/orderbook/balances/buy/sell)"
    )
    # Global options (apply to all subcommands)
    parser.add_argument("--env", help="Path to .env file (default: ./.env if exists)")
    parser.add_argument(
        "--testnet",
        action="store_true",
        help="Use Binance Spot testnet (https://testnet.binance.vision)",
    )
    parser.add_argument(
        "--base-url",
        help="Override Binance API base URL (takes precedence over --testnet)",
    )

    sub = parser.add_subparsers(dest="cmd", required=True)

    # config
    cfg = sub.add_parser("config", help="Show resolved base URL and key presence")
    cfg.set_defaults(func=cmd_config)

    # price
    p = sub.add_parser("price", help="Show latest price for symbol")
    p.add_argument("--symbol", default="BTCUSDT")
    p.set_defaults(func=cmd_price)

    # orderbook
    ob = sub.add_parser("orderbook", help="Show order book for symbol")
    ob.add_argument("--symbol", default="BTCUSDT")
    ob.add_argument("--limit", type=int, default=10)
    ob.set_defaults(func=cmd_orderbook)

    # balances
    b = sub.add_parser("balances", help="Show balances for BTC and USDT")
    b.set_defaults(func=cmd_balances)

    # buy/sell (market)
    for name, handler in [
        ("buy", cmd_buy),
        ("sell", cmd_sell),
        ("test-buy", cmd_test_buy),
        ("test-sell", cmd_test_sell),
    ]:
        sp = sub.add_parser(name, help=f"{name.replace('-', ' ')} 시장가 주문")
        sp.add_argument("--symbol", default="BTCUSDT")
        sp.add_argument("--qty", type=float, help="Base asset quantity (e.g., BTC)")
        sp.add_argument(
            "--quote",
            type=float,
            help="Quote amount to spend (e.g., USDT for market BUY)",
        )
        sp.set_defaults(func=handler)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

