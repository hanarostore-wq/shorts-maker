#!/usr/bin/env python3
"""Upbit 공개 1분 캔들로 현물 단타용 기본 지표를 계산한다.
주문 권한과 API secret을 사용하지 않는 읽기 전용 코드다.
"""
import argparse
import json
import urllib.parse
import urllib.request


def sma(values, period):
    return sum(values[-period:]) / period if len(values) >= period else None


def rsi(values, period=14):
    if len(values) <= period:
        return None
    changes = [b - a for a, b in zip(values, values[1:])][-period:]
    gains = sum(x for x in changes if x > 0) / period
    losses = sum(abs(x) for x in changes if x < 0) / period
    return 100.0 if losses == 0 else 100 - (100 / (1 + gains / losses))


def fetch_candles(market):
    query = urllib.parse.urlencode({"market": market, "count": 200})
    request = urllib.request.Request(f"https://api.upbit.com/v1/candles/minutes/1?{query}")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.load(response)
    except Exception as exc:
        raise RuntimeError(f"업비트 공개 시세 연결 오류: {exc}") from exc
    if not isinstance(payload, list):
        raise RuntimeError(f"업비트 공개 시세 API 오류: {payload}")
    return list(reversed([float(item["trade_price"]) for item in payload]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", default="KRW-BTC", help="예: KRW-BTC")
    args = parser.parse_args()
    if not args.market.startswith("KRW-"):
        raise SystemExit("시세 조회 오류: KRW 마켓만 지원합니다")
    closes = fetch_candles(args.market)
    print(json.dumps({"market": args.market, "price": closes[-1], "sma5": sma(closes, 5), "sma20": sma(closes, 20), "rsi14": rsi(closes), "candles": len(closes)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit(str(exc))
