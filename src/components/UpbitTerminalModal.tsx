"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./UpbitTerminalModal.module.css";

type Mode = "paper" | "live";
type Status = { mode: Mode; actualMode: Mode; running: boolean; liveLocked: boolean };
const terminalOrigin = "http://127.0.0.1:18770";

export function UpbitTerminalModal({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const closeHandler = useRef(onClose);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => { closeHandler.current = onClose; }, [onClose]);

  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    let lastSeen = Date.now();
    const receive = (event: MessageEvent) => {
      if (event.origin !== terminalOrigin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.protocol !== 1 || data.mode !== mode) return;
      if (data.type === "jev-workspace-close") { closeHandler.current(); return; }
      if (data.type !== "jev-workspace-status" || !["paper", "live"].includes(data.actualMode) ||
          typeof data.running !== "boolean" || typeof data.liveLocked !== "boolean") return;
      lastSeen = Date.now();
      setStatus(data);
      setFailed(false);
    };
    window.addEventListener("message", receive);
    const timer = window.setInterval(() => {
      if (Date.now() - lastSeen > 12000) setFailed(true);
    }, 1000);
    return () => { window.removeEventListener("message", receive); window.clearInterval(timer); };
  }, [attempt, mode]);

  const retry = () => { setFailed(false); setStatus(null); setAttempt(value => value + 1); };
  const title = mode === "paper" ? "모의매매원" : "실전매매원";

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="upbit-workspace-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <strong id="upbit-workspace-title">{title} · 업비트</strong>
          <span className={mode === "paper" ? styles.paper : styles.live}>
            {mode === "paper" ? "가상 자금" : "실제 계좌 · 주문 잠금 확인"}
          </span>
          <span role="status" className={styles.connection}>{failed ? "프로그램 연결 확인 필요" : status ? "내 PC 프로그램 연결됨" : "내 PC 프로그램 연결 중…"}</span>
        </div>
        <button type="button" className={styles.close} onClick={onClose} autoFocus aria-label="매매 화면 닫기">✕ 닫기</button>
      </header>
      <div className={styles.notice}>
        {status?.running ? "자동매매 실행 중 · 화면을 닫아도 계속됩니다. 멈추려면 화면 안의 ‘매매 종료’를 누르세요." : "화면을 여는 것만으로 자동매매가 시작되지는 않습니다."}
        <span>이 PC의 업비트 프로그램과 같은 계좌·설정을 사용합니다.</span>
      </div>
      <div className={styles.content}>
        <iframe key={`${mode}-${attempt}`} ref={frame} title={`${title} 업비트 매매 프로그램`}
          className={styles.frame} src={`${terminalOrigin}/workspace/${mode}/`}
          referrerPolicy="origin" allow="local-network-access; loopback-network"
          onError={() => setFailed(true)} />
        {(!status || failed) && <section className={styles.connectionPanel} aria-live="polite">
          <div className={styles.card}>
            <h2>{failed ? "업비트 프로그램에서 응답을 받지 못했습니다" : "기존 업비트 프로그램을 연결하고 있습니다"}</h2>
            {failed ? <>
              <p>연결 단계: 이 PC의 매매 화면 불러오기. 브라우저 보안 제한으로 프로그램 종료·접근 차단 중 어느 원인인지는 여기서 구분할 수 없습니다.</p>
              <ol>
                <li>이 PC에서 JEV SPOT 업비트 프로그램을 실행해 주세요.</li>
                <li>브라우저가 ‘기기의 앱’ 또는 ‘로컬 네트워크’ 접근을 물으면 이 운영본부 사이트에 허용해 주세요.</li>
                <li>프로그램이 이미 켜져 있다면 업데이트된 프로그램을 다시 실행하고 아래 버튼을 눌러 주세요.</li>
              </ol>
              <p>현재 연결은 이 PC 전용입니다. 휴대폰에서는 PC의 매매 프로그램에 연결되지 않습니다. 별도 주소로 연 운영본부는 프로그램의 허용된 사이트 설정도 확인해야 합니다.</p>
              <button type="button" onClick={retry}>다시 연결</button>
            </> : <p>잠시 기다려 주세요. 연결과 매매 실행 상태를 실제 프로그램에서 확인합니다.</p>}
          </div>
        </section>}
      </div>
    </div>
  </dialog>;
}
