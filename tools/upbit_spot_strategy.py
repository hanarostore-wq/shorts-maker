#!/usr/bin/env python3
"""업비트 현물 전용 RSI + SMA 교차 신호 연구/모의판정기.
실제 주문은 실행하지 않고 신호와 차단 사유만 출력한다.
"""
import argparse
import json
from upbit_spot_indicators import fetch_candles, rsi, sma


def signal(closes):
    fast = sma(closes, 5)
    slow = sma(closes, 20)
    previous_fast = sum(closes[-6:-1]) / 5 if len(closes) >= 21 else None
    previous_slow = sum(closes[-21:-1]) / 20 if len(closes) >= 21 else None
    current_rsi = rsi(closes)
    if None in (fast, slow, previous_fast, previous_slow, current_rsi):
        return "WAIT", "지표 계산에 필요한 캔들이 부족합니다"
    if previous_fast <= previous_slow and fast > slow and current_rsi < 70:
        return "BUY_CANDIDATE", "SMA5 골든크로스 + RSI 과열 아님"
    if previous_fast >= previous_slow and fast < slow:
        return "SELL_CANDIDATE", "SMA5 데드크로스"
    if current_rsi >= 70:
        return "WAIT", "RSI 과열 구간이라 신규 매수를 차단합니다"
    if current_rsi <= 30:
        return "WATCH", "RSI 과매도 구간이지만 교차 확인 전입니다"
    return "WAIT", "진입 조건이 동시에 충족되지 않았습니다"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", default="KRW-BTC")
    args = parser.parse_args()
    closes = fetch_candles(args.market)
    action, reason = signal(closes)
    print(json.dumps({"market": args.market, "action": action, "reason": reason, "price": closes[-1], "rsi14": rsi(closes), "sma5": sma(closes, 5), "sma20": sma(closes, 20), "execution": "paper_only"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
