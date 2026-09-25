# COIN-PREDICTIVE-V4 연구 근거와 적용 경계

## 결론

이번 1차 V4 구조는 예측값을 승률로 표시하거나 수익성을 주장하지 않고, **실시간 정보 집합만 사용한 후보 평가 → 거래비용 차감 → SHADOW 기록 → 미래 label 사후 생성** 순서를 강제한다. 기존 V3와 PAPER/LIVE 안전 게이트는 유지하며 V4는 실제 주문을 생성하지 않는다.

## 확인한 자료

| 자료 | 확인한 내용 | V4 적용 |
|---|---|---|
| [Upbit WebSocket Usage and Error Guide](https://global-docs.upbit.com/reference/websocket-guide) | ticker·trade·orderbook·candle은 snapshot 또는 실시간 stream으로 받을 수 있다. 구독 메시지는 ticket와 type/codes를 사용하며, 120초 idle timeout과 PING/PONG 유지가 필요하다. | 차트·후보 snapshot은 WebSocket 중계의 실시간 이벤트를 기준으로 한다. 정기 polling을 신호의 기본 시계로 사용하지 않는다. |
| [Upbit Orderbook Reference](https://global-docs.upbit.com/reference/websocket-orderbook) | orderbook은 `orderbook_units`의 ask/bid price·size와 timestamp·stream_type을 제공한다. unit 수는 1·5·15·30을 지정할 수 있다. | OFI·depth imbalance·spread 계산의 원천 필드를 명시하고, timestamp freshness를 진입 관문으로 둔다. |
| [Vafin, Order-Flow Imbalance and Short-Horizon Return Predictability in Cryptocurrency Markets](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6938742) | OFI가 단기 가격 움직임의 유력한 microstructure 변수라는 문헌을 정리하지만, 실제 신규 추정이 아닌 review/design 논문이며 out-of-sample·현실적 거래비용·data-snooping 통제를 요구한다. | OFI를 단독 매수 근거로 쓰지 않고 opportunity/chase/cost와 함께 평가한다. 문헌 근거를 실현 승률로 표시하지 않는다. |
| [Deep et al., Interpretable Hypothesis-Driven Trading](https://arxiv.org/html/2512.12924v1) | 정보집합 규율, rolling walk-forward, 현실적 commission/slippage/position constraints가 lookahead와 과적합 방지에 중요하다. 보고 결과도 통계적으로 유의하지 않을 수 있음을 명시한다. | 미래 label은 후보 계산 이후에만 생성하고, V3/V4를 분리한 뒤 기간별 out-of-sample 검증을 추가한다. |

## 미확인·제한

자료는 Upbit KRW 현물에서 COIN-PREDICTIVE-V4의 수익성이나 승률을 검증하지 않는다. 특히 현재 구현의 일부 시장 breadth·percentile 값은 실시간 전 시장 집계가 연결되기 전까지 placeholder가 될 수 있으므로, 화면에서 최적 전략 또는 승률로 표시하지 않는다. 충분한 shadow 표본과 walk-forward 결과가 생기기 전까지 PAPER 성과와 LIVE 성과를 약속하지 않는다.
