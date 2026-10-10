"use client";

import { useEffect, useRef } from "react";
import styles from "./YuJinTradersModal.module.css";

const ORIGIN = "https://black.taild4819c.ts.net";
const URLS = {
  spot: `${ORIGIN}:8444/?embed=control-room&v=2.0.0`,
  futures: `${ORIGIN}:8445/?embed=control-room&v=2.0.0`,
} as const;

type TerminalKind = keyof typeof URLS | null;

export function BinanceTerminalModal({ kind, onClose }: { kind: TerminalKind; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!kind) {
      element?.close();
      return;
    }
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!element?.open) element?.showModal();
    return () => { document.body.style.overflow = priorOverflow; };
  }, [kind]);

  if (!kind) return null;
  const label = kind === "spot" ? "바이낸스 · 현물" : "바이낸스 · USDⓈ-M 선물";
  const detail = kind === "spot" ? "로컬 분석 · 모의·실전 전환 주문 터미널" : "로컬 분석 · 모의·실전 전환 선물 터미널";

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="binance-terminal-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className={styles.layout}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <strong id="binance-terminal-title">{label}</strong>
            <span>{detail}</span>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="바이낸스 화면 닫기">✕ 닫기</button>
        </header>
        <div className={styles.content}>
          <iframe className={styles.frame} src={URLS[kind]} title={`${label} 로컬 거래 터미널`} />
        </div>
      </div>
    </dialog>
  );
}
