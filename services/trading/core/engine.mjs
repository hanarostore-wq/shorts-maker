import {tradeContext,marketSample} from '../analytics.mjs';
import {defaultPolicy,evidenceDecision,investmentPlan} from './evidence.mjs';
import { randomUUID, createHash } from "node:crypto";
import {
  defaults,
  validateConfig,
  newLedger,
  D,
  markLedger,
  validateBook,
  riskCheck,
  planFill,
  applyFill,
  decide,
} from "./core.mjs";
import { SafetyEngine } from "./safety.mjs";
import { scanCandidates, strategyDecision } from "./strategy.mjs";
import { features } from "./market.mjs";
import { askJev } from "./jev.mjs";
import { UpbitBroker } from "./broker.mjs";
import { TrackingExecutor, manualBuyingPower } from "./tracking.mjs";
export class Engine {
  constructor(feed, store) {
    this.feed = feed;
    this.store = store;
    const s = store.load() || {};
    this.config = validateConfig(s.config || {});
    this.policy=defaultPolicy();
    this.investment=null;
    if (!s.executionSettingsVersion) {
      // Preserve the saved user interval; new accounts default to 60 seconds.
      if (this.config.cooldownSeconds === 30) this.config.cooldownSeconds = 1;
    }
    if (!s.unlimitedJudgmentVersion) this.config.maxCallsPerDay = 0;
    this.paper = s.paper || null;
    this.live = s.live || null;
    if (this.live && (this.live.pending || D(this.live.quantity).gt(0)))
      feed.symbol = this.live.market;
    else if (this.paper) feed.symbol = this.paper.market;
    this.archives = s.archives || [];
    this.accountHash = s.accountHash || null;
    this.prompt =
      s.prompt ||
      "Assess a KRW spot scalp conservatively. Consider order-book imbalance, aggressive flow, spread, VWAP, momentum and execution quality. When evidence conflicts or is insufficient, prefer neutral.";
    this.calls = {
      day: "",
      count: 0,
      inputTokens: 0,
      outputTokens: 0,
      responses: 0,
      ...(s.calls || {}),
    };
    this.mode = "paper";
    this.armed = false;
    this.running = false;
    this.judgmentRunning = false;
    this.startRequested = false;
    this.startBusy = false;
    this.judgmentEpoch = 0;
    this.askJev = askJev;
    this.generation = 0;
    this.decision = null;
    this.events = [];
    this.jevKey = "";
    this.jevVerified = false;
    this.broker = new UpbitBroker();
    this.liveTest = null;
    this.chance = null;
    this.tracker = new TrackingExecutor(this, s.tracking);
    this.orderBusy = false;
    this.analysisBusy = false;
    this.lastAnalysis = 0;
    this.lastReconcile = 0;
    this.coolUntil = 0;
    this.scanning = false;
    this.lastScan = 0;
    this.candidates = [];
    this.safety = new SafetyEngine(this);
    this.feed.onRiskChange = () => {
      this.monitor().catch(e => this.fail(e));
    };
    this.action = { side: "hold", reason: "연결 설정 후 분석을 시작하세요." };
    this.timer = setInterval(() => this.tick().catch((e) => this.fail(e)), 500);
    this.event("시스템 시작 · 모의 모드 · 자동매매 정지");
  }
  save() {
    this.store.save({
      version: 1,
      executionSettingsVersion: 1,
      unlimitedJudgmentVersion: 1,
      config: this.config,
      paper: this.paper,
      live: this.live,
      archives: this.archives,
      prompt: this.prompt,
      calls: this.calls,
      accountHash: this.accountHash,
      tracking: this.tracker?.state || null,
    });
    this.analytics?.sync(this);
  }
  event(text) {
    this.events.unshift({ at: Date.now(), text });
    this.events = this.events.slice(0, 100);
  }
  fail(e) {
    this.action = { side: "hold", reason: e.message };
    if (this.events[0]?.text !== e.message) this.event(e.message);
  }
  ledger() {
    return this.mode === "paper" ? this.paper : this.live;
  }
  assertIdle() {
    if (
      this.running ||
      this.startRequested ||
      this.tracker?.state?.active ||
      this.tracker?.busy ||
      this.orderBusy ||
      this.scanning ||
      this.safety?.busy ||
      this.paper?.pending ||
      this.live?.pending
    )
      throw Error(
        "자동매매를 정지하고 결과 확인 중인 주문을 확인한 뒤 변경하세요.",
      );
  }
  resetJudgmentSchedule() {
    this.lastAnalysis = 0;
    this.coolUntil = 0;
    this.decision = null;
  }
  invalidate() {
    this.generation++;
    this.decision = null;
    this.armed = false;
    this.liveTest = null;
  }
  createPaper(capital) {
    this.assertIdle();
    const next = newLedger(capital, this.feed.symbol);
    if (this.paper) this.archives.push(this.paper);
    this.paper = next;
    this.mode = "paper";
    this.invalidate();
    this.save();
    this.event(
      "모의계좌 시작금 " +
        capital.toLocaleString("ko-KR") +
        "원 설정 · 이전 계좌 기록 보관",
    );
  }
  async select(symbol) {
    this.assertIdle();
    if (this.live && D(this.live.quantity).gt(0))
      throw Error("실전 봇 보유분을 정리한 뒤 종목을 변경하세요.");
    if (this.paper && D(this.paper.quantity).gt(0))
      throw Error(
        "모의 보유분을 매도하거나 새 모의계좌를 만든 뒤 종목을 변경하세요.",
      );
    this.invalidate();
    await this.feed.select(symbol);
    this.resetJudgmentSchedule();
    this.action = { side: "hold", reason: this.judgmentRunning ? "종목 변경 · 시세 준비 후 첫 판단 바로 실행" : "종목 변경 완료 · 시작하면 첫 판단 바로 실행" };
    if (this.paper) this.paper.market = symbol;
    if (this.live) this.live.market = symbol;
    this.save();
  }
  configure(input, prompt) {
    this.assertIdle();
    const nextConfig = validateConfig(input, this.config);
    if (prompt !== undefined) {
      if (typeof prompt !== "string" || prompt.length > 4000)
        throw Error("프롬프트는 4,000자 이내");
      this.prompt = prompt;
    }
    this.config = nextConfig;
    this.invalidate();
    this.save();
  }
  setMode(mode) {
    if (!["paper", "live"].includes(mode)) throw Error("모드 오류");
    this.assertIdle();
    this.mode = mode;
    this.invalidate();
    this.event(
      mode === "paper" ? "모의 모드 선택" : "실전 모드 선택 · 주문 잠금 상태",
    );
  }
  stop() {
    this.startRequested = false;
    this.running = false;
    this.judgmentRunning = false;
    this.judgmentEpoch++;
    this.armed = false;
    this.generation++;
    this.tracker?.stop("사용자 정지 · 추적 주문 중지");
    this.action = {
      side: "hold",
      reason: "사용자 정지 · 보유자산은 유지됩니다.",
    };
    this.event(this.action.reason);
  }
  async connectJev(key) {
    this.assertIdle();
    if (typeof key !== "string" || !key.trim() || key.length > 2000)
      throw Error("TypeSafe 키를 입력하세요.");
    const gen = this.generation;
    const f = features(this.feed);
    if (!this.dataReady(f)) throw Error("시장 데이터 준비 후 다시 연결하세요.");
    this.reserveCall();
    const l = this.ledger();
    const result = await this.askJev(
      key.trim(),
      this.judgmentState(f, l),
      this.prompt,
    );
    if (gen !== this.generation) throw Error("연결 확인 중 정지/설정 변경");
    this.jevKey = key.trim();
    this.jevVerified = true;
    this.invalidate();
    this.decision = result;
    this.recordDecision(result);
    this.event(
      "TypeSafe 실제 응답 확인 · " +
        result.model +
        " · " +
        result.latencyMs +
        "ms",
    );
  }
  async connectUpbit(access, secret) {
    if (this.running || this.orderBusy) throw Error("정지 후 키를 연결하세요.");
    if (
      !access?.trim() ||
      !secret?.trim() ||
      access.length > 1000 ||
      secret.length > 1000
    )
      throw Error("업비트 Access/Secret 키를 입력하세요.");
    const hash = createHash("sha256").update(access.trim()).digest("hex");
    if (
      this.accountHash &&
      hash !== this.accountHash &&
      (this.live?.pending || D(this.live?.quantity || 0).gt(0))
    )
      throw Error(
        "기존 실전 보유분/결과 확인 중인 주문이 있어 다른 키로 바꿀 수 없습니다.",
      );
    this.chance = await this.broker.verify(
      access.trim(),
      secret.trim(),
      this.feed.symbol,
    );
    if (this.accountHash && hash !== this.accountHash && this.live) {
      this.archives.push(this.live);
      this.live = null;
    }
    this.accountHash = hash;
    this.invalidate();
    this.save();
    this.event("업비트 잔고·주문조회 인증 확인 · 실주문은 잠금");
  }
  async testLive() {
    this.assertIdle();
    if (this.mode !== "live" || !this.broker.verified)
      throw Error("실전 모드에서 업비트 키를 먼저 연결하세요.");
    await this.broker.test(this.feed.symbol, this.config.orderKrw);
    this.liveTest = { at: Date.now(), market: this.feed.symbol };
    this.event("업비트 주문 테스트 통과 · 실제 주문 생성 없음");
  }
  async arm(capital, phrase) {
    this.assertIdle();
    const gen = this.generation;
    if (this.mode !== "live" || phrase !== "실제 원화로 거래합니다")
      throw Error("실전 확인 문구가 일치하지 않습니다.");
    if (
      !this.broker.verified ||
      !this.jevVerified ||
      !this.liveTest ||
      Date.now() - this.liveTest.at > 300000 ||
      this.liveTest.market !== this.feed.symbol
    )
      throw Error("키 검증과 최근 5분 이내 주문 테스트가 필요합니다.");
    const chance = await this.broker.chance(this.feed.symbol);
    if (gen !== this.generation) throw Error("활성화 중 정지/설정 변경");
    this.chance = chance;
    const available = Number(chance.bid_account?.balance);
    if (!Number.isFinite(available)) throw Error("업비트 원화 잔액 확인 실패");
    if (
      !Number.isSafeInteger(capital) ||
      this.config.maxPositionKrw > capital ||
      this.config.dailyLossKrw >= capital
    )
      throw Error("운용금 및 위험 한도를 확인하세요.");
    if (!this.live) {
      const next = newLedger(capital, this.feed.symbol, "live");
      if (capital > available)
        throw Error("배정 금액이 업비트 주문가능 원화를 초과합니다.");
      this.live = next;
    } else if (Number(this.live.initial) !== capital)
      throw Error(
        "기존 실전 운용금은 기록 보호를 위해 이 화면에서 초기화하지 않습니다.",
      );
    if (
      this.config.maxPositionKrw > capital ||
      this.config.dailyLossKrw >= capital
    )
      throw Error("보유 한도와 손실 한도를 운용금 내로 설정하세요.");
    const coinTotal = D(chance.ask_account?.balance).plus(chance.ask_account?.locked || 0);
    if (!coinTotal.isFinite() || coinTotal.lt(this.live.quantity)) throw Error('거래소 잔고와 봇 보유수량 불일치');
    if (this.live.exchangeBaseline === undefined) this.live.exchangeBaseline = coinTotal.minus(this.live.quantity).toString();
    else if (!coinTotal.minus(this.live.quantity).minus(this.live.exchangeBaseline).abs().lte('0.00000001'))
      throw Error('거래소 잔고 변경 감지 · 봇 기록 대조 필요');
    this.armed = true;
    this.save();
    this.event("실전 주문 잠금 해제 · 자동매매 시작은 별도");
  }
  async ensureJev() {
    if (this.jevVerified) return;
    if (!this.jevKey)
      throw Error("저장된 Jev 키가 없습니다. 연결 설정에서 키를 입력하세요.");
    this.action = {
      side: "hold",
      reason: "저장된 Jev 키로 실제 연결 확인 중…",
    };
    await this.connectJev(this.jevKey);
  }
  async setJudgment(enabled) {
    if (typeof enabled !== "boolean") throw Error("판단 ON/OFF 값 오류");
    if (!enabled) {
      this.startRequested = false;
      this.judgmentEpoch++;
      if (this.running) this.stop();
      else {
        this.judgmentRunning = false;
        this.action = { side: "hold", reason: "실시간 판단 OFF · 주문 없음" };
        this.event(this.action.reason);
      }
      return;
    }
    if (this.running || this.judgmentRunning) return;
    this.assertIdle();
    const epoch = this.judgmentEpoch;
    await this.ensureJev();
    if (epoch !== this.judgmentEpoch) throw Error("판단 연결 중 OFF/정지");
    this.judgmentRunning = true;
    this.resetJudgmentSchedule();
    this.action = { side: "hold", reason: "실시간 판단 ON · 자동 주문 OFF" };
    this.event(this.action.reason);
  }
  dataReady(f = features(this.feed)) {
    return !!f?.warm && (!this.config.strategyEnabled || !!f.strategy?.ready);
  }
  dataReadyReason() {
    const f = features(this.feed);
    if (!this.feed.clockVerified) return '거래소 시각 확인 중';
    if (!f || f.bookAgeMs > 3000) return '최신 호가 수신 대기';
    const count = (this.feed.signalCandles || this.feed.candles || []).length;
    if (count < 21) return '1분 봉 준비 ' + count + '/21개';
    if (f.tradeCount60s < 10) return '최근 60초 거래 ' + f.tradeCount60s + '/10건';
    return f.strategy?.reason || '분석 자료 준비 중';
  }
  async startConnected() {
    this.assertIdle();
    if (!this.ledger()) throw Error("시작금을 먼저 설정하세요.");
    if (!this.jevVerified && !this.jevKey) throw Error('저장된 Jev 키가 없습니다. 연결 설정에서 키를 입력하세요.');
    if (this.mode === 'live' && !this.armed) throw Error('실전 주문 잠금 상태');
    if (!this.dataReady()) {
      this.startRequested = true;
      this.action = {side:'hold', reason:'자동매매 시작 대기 · ' + this.dataReadyReason() + ' · 준비되면 자동 시작'};
      this.event(this.action.reason);
      return;
    }
    const epoch = this.judgmentEpoch;
    await this.ensureJev();
    if (epoch !== this.judgmentEpoch) throw Error("시작 중 판단 OFF/정지");
    if (!this.dataReady()) {
      this.startRequested = true;
      this.action = {side:"hold", reason:"자동매매 시작 대기 · " + this.dataReadyReason() + " · 준비되면 자동 시작"};
      this.event(this.action.reason);
      return;
    }
    this.start();
  }
  start() {
    if (this.tracker.state?.active || this.tracker.busy)
      throw Error("추적 주문 중지 후 자동매매를 시작하세요.");
    if (!this.ledger())
      throw Error("모의 시작금 또는 실전 운용금을 설정하세요.");
    if (!this.jevVerified) throw Error("실제 Jev API 연결 검증이 필요합니다.");
    if (this.mode === "live" && !this.armed) throw Error("실전 주문 잠금 상태");
    if (this.ledger().pending) throw Error("결과 확인 중인 주문이 있습니다.");
    if (!this.dataReady()) throw Error("실시간 데이터 준비 중");
    this.resetJudgmentSchedule();
    this.lastScan = 0;
    this.action = { side: "hold", reason: "자동매매 시작 · 첫 판단 바로 실행" };
    this.running = true;
    this.judgmentRunning = true;
    this.generation++;
    this.event(
      this.mode === "paper"
        ? "실시세 기반 모의 자동매매 시작"
        : "실전 자동매매 시작",
    );
  }
  reserveCall() {
    const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    if (this.calls.day !== day) this.calls = { day, count: 0, inputTokens: 0 };
    if (
      this.config.maxCallsPerDay > 0 &&
      this.calls.count >= this.config.maxCallsPerDay
    )
      throw Error("하루 Jev 호출 한도 도달");
    this.calls.count++;
    this.save();
  }
  judgmentState(f, l) {
    return {
      market: f,
      scanner: this.scannerTrace || this.feed.scanner?.context(f.market) || null,
      evidencePolicy: this.policy,
      horizonSeconds: this.config.horizonSeconds,
      strategy: {version:1, mode:this.config.strategyEnabled ? "one-minute-flow" : "legacy", rules:"Combine independent evidence by regime. A high RSI alone is not a veto. Strong flow can remain HOLD above fixed profit targets. Hard risk rules override all AI opinions."},
      botPosition: l
        ? {
            quantity: Number(l.quantity),
            costBasisKrw: Number(l.cost),
            heldSeconds: l.openedAt ? (Date.now() - l.openedAt) / 1000 : 0,
            ...markLedger(l, f.bid, this.config.feePct),
          }
        : { quantity: 0 },
      execution: {
        mode: this.mode,
        pending: !!l?.pending,
        previousLatencyMs: this.decision?.latencyMs ?? null,
        fillCount: l?.history.length || 0,
        lastFill: l?.history.at(-1)
          ? { side: l.history.at(-1).side, price: l.history.at(-1).price }
          : null,
      },
      dataLimitations: [
        "Visible book only, no queue position",
        "No privileged institutional flow",
        "Direction probabilities not calibrated trading win rates",
      ],
    };
  }
  recordDecision(d) {
    this.calls.inputTokens += Number(d.usage?.input_tokens) || 0;
    this.calls.outputTokens =
      (this.calls.outputTokens || 0) + (Number(d.usage?.output_tokens) || 0);
    this.calls.responses = (this.calls.responses || 0) + 1;
    this.store.log({ kind: "jev", mode: this.mode, ...d, scanner:this.scannerTrace||null });
    this.save();
  }
  async analyze() {
    if (this.analysisBusy) throw Error("Jev 분석 진행 중");
    if (!this.jevVerified) throw Error("TypeSafe 키를 먼저 연결하세요.");
    const f = features(this.feed);
    if (!this.dataReady(f)) throw Error("분석 데이터 준비 중 또는 호가 지연");
    const gen = this.generation,
      epoch = this.judgmentEpoch,
      mode = this.mode;
    if(this.feed.scanner)this.scannerTrace={...this.feed.scanner.context(this.feed.symbol),trigger:this.scannerTrace?.trigger||'정기 판단',jevStartedAt:Date.now(),policyRevision:this.policy.revision};
    const decisionInput=marketSample(this.feed);
    this.analysisBusy = true;
    this.lastAnalysis = Date.now();
    try {
      this.reserveCall();
      const d = await this.askJev(
        this.jevKey,
        this.judgmentState(f, this.ledger()),
        this.prompt,
      );
      if(this.scannerTrace)this.scannerTrace.jevCompletedAt=Date.now();
      this.recordDecision(d);
      if (
        gen !== this.generation ||
        epoch !== this.judgmentEpoch ||
        mode !== this.mode
      )
        return;
      const current = features(this.feed);
      if (
        !current ||
        current.bookAgeMs > 3000 ||
        Date.now() - d.stateAsOf > 5000 ||
        Math.abs(current.mid / f.mid - 1) * 10000 > 15
      ) {
        this.decision = { ...d, discarded: true };
        this.action = {
          side: "hold",
          reason: "응답 중 시세 변화/지연 · 판단 폐기",
        };
        return;
      }
      this.decision = d;
      this.decisionInput=decisionInput;
      const l = this.ledger();
      this.action = l
        ? evidenceDecision(this.policy,d.answers,Number(l.quantity)>0,this.config.entryScore,this.config.weaknessExitScore)
        : { side: "hold", reason: "모의 시작금을 설정하세요." };
      if(this.scannerTrace){this.scannerTrace.judgment=this.action.side;this.scannerTrace.orderDecisionAt=Date.now();this.analytics?.recordScanner?.({kind:'jev',market:this.feed.symbol,at:Date.now(),mode:this.mode,...this.scannerTrace});}
      if(this.action.side==='buy'&&this.feed.scanner&&this.config.autoScan){const c=this.feed.scanner.context(this.feed.symbol);if(!c||c.metrics?.lateRisk||c.state!=='ENTRY_READY')this.action={...this.action,side:'hold',reason:'후보 약화/추격 위험 · 매수 보류'};}
      if (this.running && this.action.side === 'sell' && this.config.strategyEnabled) {
        this.safety.request(this.action.reason, "jev");
        await this.safety.tick(current);
      } else if (this.running && this.action.side !== "hold")
        await this.order(
          this.action.side,
          this.config.orderKrw,
          "100",
          this.action.reason,
          true,
          d.id,
        );
    } catch (e) {
      // A failed response from a previous market/run cannot delay the new run.
      if (gen === this.generation && epoch === this.judgmentEpoch && mode === this.mode) {
        this.decision = null;
        this.coolUntil = Date.now() + 15000;
        this.fail(e);
      }
    } finally {
      this.analysisBusy = false;
    }
  }
  async tick() {
    if (this.startRequested && !this.startBusy) {
      if (!this.dataReady()) {
        this.action = {side:'hold', reason:'자동매매 시작 대기 · ' + this.dataReadyReason() + ' · 준비되면 자동 시작'};
      } else {
        this.startRequested = false;
        this.startBusy = true;
        try { await this.startConnected(); } catch (err) { this.fail(err); }
        finally { this.startBusy = false; }
      }
    }
    const active = this.ledger(),
      current = features(this.feed);
    if (
      active &&
      current &&
      active.market === this.feed.symbol &&
      current.bookAgeMs <= 3000
    ) {
      const prev = active.day + "|" + active.highWater;
      markLedger(active, current.bid, this.config.feePct);
      if (prev !== active.day + "|" + active.highWater) this.save();
    }
    if (
      this.live?.pending &&
      !this.tracker.busy &&
      this.broker.verified &&
      !this.orderBusy &&
      Date.now() - this.lastReconcile > 3000
    ) {
      this.lastReconcile = Date.now();
      await this.reconcile();
    }
    if (!this.running && !this.judgmentRunning) return;
    await this.scanMarket();
    const f = features(this.feed),
      l = this.ledger();
    if (!f || f.bookAgeMs > 3000) {
      this.action = { side: "hold", reason: "시세 지연 · 신규 주문 중단" };
      return;
    }
    await this.monitor();
    if (this.scanning || this.safety.busy || (l?.exitIntent && l.exitIntent.phase !== 'complete')) return;
    await this.scanMarket();
    if (this.scanning || this.feed.symbol !== f.market) return;
    if (!this.dataReady(f)) {
      this.action = {side:'hold', reason:'분석 준비 대기 · ' + this.dataReadyReason()};
      return;
    }
    if (
      !this.scanning &&
      !l?.pending &&
      !this.analysisBusy &&
      !this.orderBusy &&
      !this.tracker.busy &&
      (this.feed.scanner && this.config.autoScan && !Number(l?.quantity) || Date.now() - this.lastAnalysis >= this.config.intervalSeconds * 1000) &&
      Date.now() >= this.coolUntil
    )
      await this.analyzeCandidate();
  }
  async analyzeCandidate() {
    const scanner=this.feed.scanner,l=this.ledger();
    if(!scanner||!this.config.autoScan||Number(l?.quantity)>0)return this.analyze();
    const lease=scanner.acquire(this.mode,this.feed.symbol,{periodic:Date.now()-this.lastAnalysis>=this.config.intervalSeconds*1000});
    if(!lease){this.action={side:'hold',reason:'시장 전체 감시 · 후보/재판단 간격 확인 중'};return;}
    this.scannerTrace={...lease.context,trigger:lease.reason,jevStartedAt:Date.now(),policyRevision:this.policy.revision};
    try{await this.analyze();}finally{scanner.release(lease);}
  }
  async monitor() {
    const f=features(this.feed), l=this.ledger();
    await this.safety.tick(f);
    if (!this.policy && this.running && l && f?.warm && !this.config.strategyEnabled && !l.pending) {
      const legacy=decide(null,f,l,this.config);
      if (legacy.side==='sell') {this.safety.request(legacy.reason);await this.safety.tick(f);}
    }
    if (!this.policy && this.running && l && f && f.warm && this.config.strategyEnabled && !l.pending &&
        (!l.exitIntent || l.exitIntent.phase==='complete')) {
      const local=strategyDecision(null,f,l,this.config);
      if (local.side==='sell') {
        this.safety.request(local.reason);
        await this.safety.tick(f);
      }
    }
  }
  async scanMarket() {
    const l=this.ledger();
    if(!this.running||!this.config.autoScan||!l||this.scanning||this.analysisBusy||this.orderBusy||this.tracker.busy||this.tracker.state?.active||this.safety.busy||this.paper?.pending||this.live?.pending||Number(this.paper?.quantity)>0||Number(this.live?.quantity)>0||(l.exitIntent&&l.exitIntent.phase!=='complete')||Date.now()-this.lastScan<2000)return;
    this.candidates=this.feed.scanner?.candidates()||scanCandidates(this.feed);this.lastScan=Date.now();
    const target=this.feed.scanner?this.feed.scanner.pick(this.feed.symbol,this.mode):this.candidates[0];if(!target||target.market===this.feed.symbol)return;
    const epoch=this.judgmentEpoch,mode=this.mode,old=this.feed.symbol;this.scanning=true;this.generation++;this.decision=null;this.investment=null;
    const gen=this.generation;const check=()=>{if(!this.running||epoch!==this.judgmentEpoch||gen!==this.generation||mode!==this.mode)throw Error('종목 전환 중 정지 또는 설정 변경');};
    this.action={side:'hold',reason:'선행 후보로 전환 준비 · '+target.name};
    try{
      let chance;
      if(mode==='live'){
        if(!this.armed||!this.broker.verified)throw Error('실전 종목 전환 인증 필요');
        // Ensure the previous bot position was fully reconciled before changing its baseline.
        const previous=await this.broker.chance(old);check();
        const total=D(previous.ask_account?.balance).plus(previous.ask_account?.locked||0);
        if(l.exchangeBaseline===undefined||!total.minus(l.exchangeBaseline).abs().lte('0.00000001'))throw Error('기존 종목 잔고 불일치 · 전환 보류');
        chance=await this.broker.chance(target.market);check();
        if(chance.market?.state!=='active'||!D(chance.ask_account?.balance).isFinite()||!D(chance.ask_account?.locked||0).isFinite())throw Error('새 종목 거래 가능 상태 확인 실패');
        await this.broker.test(target.market,Math.max(5000,Number(chance.market?.bid?.min_total)||0));check();
      }
      await this.feed.select(target.market);check();
      l.market=this.feed.symbol;l.riskState=null;l.exitIntent=null;
      if(mode==='live'){this.chance=chance;l.exchangeBaseline=D(chance.ask_account.balance).plus(chance.ask_account.locked||0).toString();this.liveTest={at:Date.now(),market:l.market};}
      // Keep lastAnalysis/coolUntil: changing rank never bypasses the paid-call interval.
      this.save();this.event('시장 후보 전환 · '+target.name);this.action={side:'hold',reason:'후보 '+target.name+' · 매수근거 확인 대기'};
    }catch(err){
      // feed.select changes symbol before awaiting history; keep ledger consistent but lock on incomplete transition.
      if(this.feed.symbol!==old){l.market=this.feed.symbol;this.armed=false;this.stop();this.save();}
      throw err;
    }finally{this.scanning=false;}
  }
  async order(
    side,
    amount,
    sellPct = "100",
    reason = "수동 주문",
    automatic = false,
    decisionId = null,
    emergency = false,
  ) {
    if (this.tracker.state?.active || this.tracker.busy)
      throw Error("추적 주문 처리 중");
    if (this.orderBusy) throw Error("주문 처리 중");
    const l = this.ledger();
    if (!l) throw Error("계좌 시작금을 먼저 설정하세요.");
    if (this.scanning) throw Error('종목 전환 중');
    const blockBuy = () => {
      if(automatic&&side==='buy'&&this.feed.scanner&&this.config.autoScan){const c=this.feed.scanner.context(this.feed.symbol);if(!c||Date.now()-c.asOf>2000||c.metrics?.lateRisk||c.state!=='ENTRY_READY')throw Error('주문 직전 후보 신선도/추격 위험 재검사 실패');}
      if (side === 'buy' && l.exitIntent && l.exitIntent.phase !== 'complete') throw Error('청산 진행 중 · 신규 매수 금지');
    };
    blockBuy();
    if(automatic&&side==='buy'&&Number(l.quantity)>0)throw Error('단일 포지션 유지 · 추가 진입 금지');
    if (l.market !== this.feed.symbol) throw Error("계좌 종목 불일치");
    if (this.mode === "live" && !this.armed) throw Error("실전 주문 잠금 상태");
    if (!automatic && this.running)
      throw Error("자동매매 정지 후 수동 주문하세요.");
    if (!["buy", "sell"].includes(side)) throw Error("주문 방향 오류");
    const pct = D(sellPct);
    if (!pct.isFinite() || pct.lte(0) || pct.gt(100))
      throw Error("매도 비율 오류");
    const quantity = D(l.quantity)
      .mul(pct)
      .div(100)
      .toDecimalPlaces(8, 1)
      .toString();
    const gen = this.generation,
      mode = this.mode;
    this.orderBusy = true;
    try {
      let cfg = this.config;
      const sizeBuy=()=>{const f=features(this.feed);if(!f)throw Error("투자비용 계산 시세 없음");f.visibleAskKrw=this.feed.book.orderbook_units.reduce((n,r)=>n+r.ask_price*r.ask_size,0);this.investment=investmentPlan(this.policy,this.action,l,f,cfg,mode==='live'?this.chance:null);amount=this.investment.amount;if(amount<5000)throw Error(this.investment.reason);cfg={...cfg,orderKrw:amount};reason+=' · '+this.investment.reason+' · '+amount.toLocaleString('ko-KR')+'원';};
      if (mode === "live") {
        this.chance = await this.broker.chance(this.feed.symbol);
        const fee = Number(
          side === "buy" ? this.chance.bid_fee : this.chance.ask_fee,
        );
        if (!Number.isFinite(fee) || fee < 0 || fee > 0.01)
          throw Error("업비트 수수료 확인 실패");
        cfg = { ...cfg, feePct: fee * 100 };
        const min = Number(
          (side === "buy" ? this.chance.market?.bid : this.chance.market?.ask)
            ?.min_total,
        );
        if (!Number.isFinite(min)) throw Error("최소 주문금액 확인 실패");
        if(automatic&&side==='buy')sizeBuy();
        if (
          side === "buy" &&
          (amount < min ||
            D(amount)
              .mul(1 + fee)
              .gt(this.chance.bid_account.balance))
        )
          throw Error("업비트 주문가능 금액/최소 금액 위반");
        if (
          side === "sell" &&
          (D(quantity).gt(this.chance.ask_account.balance) ||
            D(quantity)
              .mul(this.feed.book?.orderbook_units?.[0]?.bid_price || 0)
              .lt(min))
        )
          throw Error("업비트 매도 잔액/최소 금액 위반");
        if (this.chance.market?.state && this.chance.market.state !== "active")
          throw Error("거래 중지 마켓");
      }
      if(mode==='paper'&&automatic&&side==='buy')sizeBuy();
      if (
        decisionId &&
        (!this.decision ||
          this.decision.id !== decisionId ||
          Date.now() - this.decision.stateAsOf > 5000)
      )
        throw Error("주문 직전 Jev 판단 만료");
      if (
        gen !== this.generation ||
        mode !== this.mode ||
        (automatic && !this.running)
      )
        throw Error("설정/실행 상태 변경으로 주문 취소");
      blockBuy();
      riskCheck({
        ledger: l,
        book: this.feed.book,
        config: cfg,
        side,
        amount,
        quantity,
        ignoreCooldown: emergency,
      });
      if (mode === "paper") {
        await new Promise((r) => setTimeout(r, 300));
        if (gen !== this.generation || (automatic && !this.running))
          throw Error("주문 대기 중 정지");
        if (decisionId && Date.now() - this.decision.stateAsOf > 5000)
          throw Error("모의 체결 대기 중 Jev 판단 만료");
        riskCheck({
          ledger: l,
          book: this.feed.book,
          config: cfg,
          side,
          amount,
          quantity,
          ignoreCooldown: emergency,
        });
        blockBuy();
        const fillBookTimestamp = this.feed.book.timestamp;
        const fill = planFill({
          side,
          amount,
          quantity,
          book: this.feed.book,
          feePct: cfg.feePct,
          slippageBps: cfg.slippageBps,
          allowPartial: emergency && side === 'sell',
        });
        const context = emergency && l.exitIntent?.analytics ? l.exitIntent.analytics : tradeContext(this,{automatic,reason});
        const before = structuredClone(l);
        try {
          applyFill(l, side, fill, { reason, decisionId, analytics:context });
          this.save();
        } catch (e) {
          Object.assign(l, before);
          throw e;
        }
        this.event(
          "모의 " +
            (side === "buy" ? "매수" : "매도") +
            " 체결 · " +
            Math.round(Number(fill.funds)).toLocaleString() +
            "원",
        );
        return { bookTimestamp: fillBookTimestamp, fill };
      } else {
        const identifier = "jev-" + randomUUID();
        const params = {
          market: this.feed.symbol,
          side: side === "buy" ? "bid" : "ask",
          ord_type: side === "buy" ? "price" : "market",
          ...(side === "buy"
            ? { price: String(amount) }
            : { volume: quantity }),
          identifier,
          smp_type: "cancel_taker",
        };
        l.pending = {
          identifier,
          params,
          side,
          at: Date.now(),
          reason,
          decisionId,
          analytics: emergency && l.exitIntent?.analytics ? l.exitIntent.analytics : tradeContext(this,{automatic,reason}),
          status: "sending",
        };
        this.save();
        try {
          const result = await this.broker.send(params, () => {
            if (
              gen !== this.generation ||
              mode !== this.mode ||
              !this.armed ||
              (automatic && !this.running)
            )
              throw Error("주문 전송 직전 정지");
            blockBuy();
            validateBook(this.feed.book);
            if (decisionId && Date.now() - this.decision.stateAsOf > 5000)
              throw Error("전송 직전 판단 만료");
          });
          l.pending.uuid = result.uuid;
          l.pending.status = "accepted";
          this.save();
        } catch (e) {
          if (e.notSent) {
            l.pending = null;
            this.save();
            throw e;
          }
          l.pending.status = "unknown";
          this.stop();
          this.save();
          throw Error(
            e.message + " · 주문 접수 여부 확인 필요. 재전송하지 않습니다.",
          );
        }
        this.event("실전 주문 접수 · 체결 확인 대기");
      }
    } finally {
      this.orderBusy = false;
    }
  }
  async reconcile() {
    const l = this.live;
    if (!l?.pending) return;
    if (this.orderBusy) throw Error("주문 처리 중");
    this.orderBusy = true;
    const before = structuredClone(l);
    const beforeTracking = structuredClone(this.tracker.state);
    try {
      const order = await this.broker.find(l.pending.identifier);
      if (!["done", "cancel"].includes(order.state)) {
        l.pending.status = order.state;
        this.save();
        return;
      }
      const p = l.pending;
      const q = D(order.executed_volume || 0);
      if (q.gt(0)) {
        if (!Array.isArray(order.trades) || !order.trades.length)
          throw Error("거래된 수량과 가격을 확인할 수 없습니다");
        const qty = order.trades.reduce((a, t) => a.plus(t.volume), D(0));
        if (!qty.eq(q)) throw Error("체결수량 불일치");
        const funds = order.trades.reduce(
          (a, t) => a.plus(t.funds ?? D(t.price).mul(t.volume)),
          D(0),
        );
        const fill = {
          quantity: q.toString(),
          funds: funds.toString(),
          fee: String(order.paid_fee),
          price: funds.div(q).toNumber(),
        };
        this.tracker.record(fill, p.trackingId);
        applyFill(
          l,
          p.side,
          {
            quantity: q.toString(),
            funds: funds.toString(),
            fee: String(order.paid_fee),
            price: funds.div(q).toNumber(),
          },
          { id: p.identifier, reason: p.reason, decisionId: p.decisionId, analytics:p.analytics },
        );
      }
      l.pending = null;
      this.save();
      this.event("실전 주문 체결 확인 완료: " + order.state);
    } catch (e) {
      Object.assign(l, before);
      if (this.tracker.state && beforeTracking)
        Object.assign(this.tracker.state, beforeTracking);
      this.stop();
      this.fail(Error(e.message + " · 결과 확인 중인 주문 유지"));
    } finally {
      this.orderBusy = false;
    }
  }
  async cancelPending() {
    this.stop();
    if (this.live?.pending) {
      await this.broker.cancel(this.live.pending.identifier);
      await this.reconcile();
    }
  }
  snapshot() {
    const f = features(this.feed);
    const l = this.ledger();
    const mark =
      l && f && l.market === this.feed.symbol
        ? markLedger(
            { ...l },
            f.bid,
            this.mode === "live" && this.chance
              ? Number(this.chance.ask_fee) * 100
              : this.config.feePct,
          )
        : null;
    return {
      mode: this.mode,
      running: this.running,
      startRequested: this.startRequested,
      startBusy: this.startBusy,
      judgmentRunning: this.judgmentRunning,
      armed: this.armed,
      orderBusy: this.orderBusy,
      analysisBusy: this.analysisBusy,
      config: this.config,
      evidencePolicy: this.policy,
      investment: this.investment,
      prompt: this.prompt,
      features: f,
      decision: this.decision,
      action: this.action,
      safety: this.safety.snapshot(),
      strategy: {enabled:!!this.config.strategyEnabled, autoScan:!!this.config.autoScan, scanning:this.scanning, candidates:this.feed.scanner?.candidates().slice(0,10)||scanCandidates(this.feed), scanner:this.feed.scanner?{...this.feed.scanner.snapshot(),heldMarket:Number(l?.quantity)>0?l.market:null}:null, lastScan:this.lastScan},
      calls: this.calls,
      usageSummary: {
        balance: null,
        balanceStatus: "공개 잔액 조회 API를 확인하지 못했습니다",
        estimatedUsd: (this.calls.inputTokens * 0.042) / 1000000,
        inputPricePerMillionUsd: 0.042,
        priceCheckedAt: "2026-09-24",
        priceSource: "https://docs.typesafe.ai/models",
        scope: "이 프로그램에서 받은 응답 기준",
        dashboard: "https://console.typesafe.ai/",
      },
      keys: { jev: this.jevVerified, upbit: this.broker.verified },
      liveTest: this.liveTest,
      account: l
        ? { ...l, history: l.history.slice(-100).reverse(), mark }
        : null,
      archives: this.archives.map((x) => ({
        id: x.id,
        mode: x.mode,
        initial: x.initial,
        createdAt: x.createdAt,
        trades: x.history.length,
        market: x.market,
      })),
      events: this.events,
      livePending: this.live?.pending || null,
      tracking: this.tracker.snapshot(),
      manualBuyingPower: manualBuyingPower(
        l,
        this.config,
        this.feed.book,
        this.mode === "live" ? this.chance : null,
      ),
      jevKeyLoaded: !!this.jevKey,
      upbitAccount: this.chance
        ? {
            krwAvailable: this.chance.bid_account?.balance,
            coinAvailable: this.chance.ask_account?.balance,
            bidFee: this.chance.bid_fee,
            askFee: this.chance.ask_fee,
          }
        : null,
    };
  }
}
