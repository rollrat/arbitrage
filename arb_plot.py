import os
import time
import argparse
import tkinter as tk
from typing import List, Tuple

from binance_client import BinanceClient, BinanceAPIError
from binance_futures_client import BinanceFuturesClient, BinanceFuturesAPIError


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


def truthy(s: str | None) -> bool:
    return bool(s) and s.strip().lower() in {"1", "true", "yes", "on", "y"}


def spot_base_url(args) -> str:
    if args.base_url:
        return args.base_url
    if os.getenv("BINANCE_BASE_URL"):
        return os.getenv("BINANCE_BASE_URL")
    return "https://testnet.binance.vision" if args.testnet or truthy(os.getenv("BINANCE_TESTNET")) else "https://api.binance.com"


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
    return BinanceClient(api_key=api_key, api_secret=api_secret, base_url=spot_base_url(args))


def build_futures(args) -> BinanceFuturesClient:
    f_key = os.getenv("BINANCE_FUTURES_API_KEY") or os.getenv("BINANCE_API_KEY", "")
    f_sec = os.getenv("BINANCE_FUTURES_API_SECRET") or os.getenv("BINANCE_API_SECRET", "")
    return BinanceFuturesClient(api_key=f_key, api_secret=f_sec, base_url=futures_base_url(args))


def compute_basis_bps(spot_price: float, futures_mark: float) -> float:
    if spot_price <= 0:
        return 0.0
    return (futures_mark - spot_price) / spot_price * 10000.0


class BasisPlot:
    def __init__(self, args):
        self.args = args
        self.symbol = args.symbol
        self.interval_ms = int(args.interval * 1000)
        self.history = int(args.history)
        self.ymin = args.y_min
        self.ymax = args.y_max
        self.auto_scale = args.auto_scale
        self.entry_bps = args.entry_bps
        self.exit_bps = args.exit_bps

        # Build clients
        self.spot = build_spot(args)
        self.fut = build_futures(args)

        # Data buffers
        self.values: List[float] = []
        self.last_spot = 0.0
        self.last_mark = 0.0

        # UI setup
        self.root = tk.Tk()
        self.root.title(f"Basis {self.symbol} (spot vs perp mark)")
        w, h = args.width, args.height
        bg = "#111" if args.theme == "dark" else "#fff"
        fg = "#eee" if args.theme == "dark" else "#111"
        gridc = "#2a2a2a" if args.theme == "dark" else "#ddd"

        self.canvas = tk.Canvas(self.root, width=w, height=h, bg=bg, highlightthickness=0)
        self.canvas.pack(fill=tk.BOTH, expand=True)
        self.fg = fg
        self.gridc = gridc
        self.bg = bg

        # Info label
        self.info = tk.Label(self.root, text="", fg=fg, bg=bg, anchor="w", font=("Consolas", 10))
        self.info.pack(fill=tk.X)

        # Start loop
        self.schedule_update()
        self.root.mainloop()

    def schedule_update(self):
        self.root.after(self.interval_ms, self.update_once)

    def update_once(self):
        try:
            s = self.spot.get_price(self.symbol)
            m = self.fut.get_mark_price(self.symbol)
            b = compute_basis_bps(s, m)
            self.last_spot, self.last_mark = s, m
            self.values.append(b)
            if len(self.values) > self.history:
                self.values = self.values[-self.history:]
        except (BinanceAPIError, BinanceFuturesAPIError) as e:
            self.info.configure(text=f"에러: {e}")
        except Exception as e:
            self.info.configure(text=f"예상치 못한 에러: {e}")

        self.draw()
        self.schedule_update()

    def _y_bounds(self) -> Tuple[float, float]:
        if not self.values:
            return (self.ymin, self.ymax) if not self.auto_scale else (-5, 5)
        if self.auto_scale:
            lo = min(self.values)
            hi = max(self.values)
            if lo == hi:
                lo -= 1
                hi += 1
            pad = max(0.5, (hi - lo) * 0.2)
            return (lo - pad, hi + pad)
        return (self.ymin, self.ymax)

    def draw(self):
        w = int(self.canvas.winfo_width())
        h = int(self.canvas.winfo_height())
        self.canvas.delete("all")

        # Axes and grid
        margin = 30
        x0, y0 = margin, margin
        x1, y1 = w - margin, h - margin
        self.canvas.create_rectangle(x0, y0, x1, y1, outline=self.gridc)

        # Grid lines
        y_min, y_max = self._y_bounds()
        for frac in [0.0, 0.25, 0.5, 0.75, 1.0]:
            y = y1 - (y1 - y0) * frac
            self.canvas.create_line(x0, y, x1, y, fill=self.gridc)
            val = y_min + (y_max - y_min) * frac
            self.canvas.create_text(x0 + 5, y, text=f"{val:.2f}", fill=self.fg, anchor="w", font=("Consolas", 9))

        # Threshold lines
        if self.entry_bps is not None:
            yy = self._map_y(self.entry_bps, y_min, y_max, y0, y1)
            self.canvas.create_line(x0, yy, x1, yy, fill="#2ecc71")
        if self.exit_bps is not None:
            yy = self._map_y(self.exit_bps, y_min, y_max, y0, y1)
            self.canvas.create_line(x0, yy, x1, yy, fill="#e67e22")

        # Plot line
        if self.values:
            # 2개 이상일 때만 선을 그림. 1개일 때는 점만 표시.
            if len(self.values) >= 2:
                coords = []
                denom = max(1, len(self.values) - 1)
                for i, v in enumerate(self.values):
                    x = x0 + (x1 - x0) * (i / denom)
                    y = self._map_y(v, y_min, y_max, y0, y1)
                    coords.extend([x, y])
                try:
                    (self.canvas.create_line(*coords, fill="#3498db", width=2) if len(coords) >= 4 else None)
                except Exception:
                    pass
            else:
                # 단일 포인트는 작은 원으로 표시
                x = x0 + (x1 - x0) * 1.0
                y = self._map_y(self.values[-1], y_min, y_max, y0, y1)
                r = 2
                self.canvas.create_oval(x-r, y-r, x+r, y+r, fill="#3498db", outline="")
        # Info text
        self.info.configure(text=f"{self.symbol}  spot={self.last_spot:.2f}  mark={self.last_mark:.2f}  basis={self.values[-1]:.2f} bps" if self.values else f"{self.symbol} 데이터 로드 중…")

    @staticmethod
    def _map_y(val: float, lo: float, hi: float, y0: int, y1: int) -> float:
        if hi == lo:
            return (y0 + y1) / 2
        return y1 - (val - lo) / (hi - lo) * (y1 - y0)


def main():
    ap = argparse.ArgumentParser(description="실시간 스팟-선물(마크) 베이시스 그래프")
    ap.add_argument("--env", help=".env 파일 경로(기본: ./ .env 자동 로드)")
    ap.add_argument("--testnet", action="store_true", help="스팟 테스트넷 사용")
    ap.add_argument("--base-url", help="스팟 베이스 URL 수동 지정")
    ap.add_argument("--futures-testnet", action="store_true", help="선물 테스트넷 사용")
    ap.add_argument("--futures-base-url", help="선물 베이스 URL 수동 지정")

    ap.add_argument("--symbol", default="BTCUSDT", help="대상 심볼")
    ap.add_argument("--interval", type=float, default=1.5, help="폴링 간격(초)")
    ap.add_argument("--history", type=int, default=300, help="표시할 최근 포인트 수")
    ap.add_argument("--entry-bps", type=float, help="진입 기준선(bps) 수평선 표시")
    ap.add_argument("--exit-bps", type=float, help="청산 기준선(bps) 수평선 표시")

    ap.add_argument("--width", type=int, default=900, help="창 가로 픽셀")
    ap.add_argument("--height", type=int, default=420, help="창 세로 픽셀")
    ap.add_argument("--theme", choices=["dark", "light"], default="dark", help="테마")

    ap.add_argument("--auto-scale", action="store_true", help="Y축 자동 스케일")
    ap.add_argument("--y-min", type=float, default=-10.0, help="Y축 최소(bps) - auto-scale 미사용 시")
    ap.add_argument("--y-max", type=float, default=10.0, help="Y축 최대(bps) - auto-scale 미사용 시")

    args = ap.parse_args()

    if args.env:
        load_env_file(args.env)
    else:
        if os.path.exists(".env"):
            load_env_file(".env")

    BasisPlot(args)


if __name__ == "__main__":
    main()



