"use client";

import { useEffect, useRef } from "react";
import styles from "./YuJinTradersModal.module.css";

const YUJIN_TRADERS_ORIGIN = "https://yujintrade-lfpspwta.manus.space";
const YUJIN_TRADERS_URL = `${YUJIN_TRADERS_ORIGIN}/?embed=control-room&v=1.10.54`;

export function YuJinTradersModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const receiveEscape = (event: MessageEvent) => {
      if (event.origin !== YUJIN_TRADERS_ORIGIN || event.source !== frame.current?.contentWindow) return;
      if (event.data?.channel === "yujin-control-room" && event.data?.type === "escape-close") onCloseRef.current();
    };
    window.addEventListener("message", receiveEscape);
    return () => window.removeEventListener("message", receiveEscape);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!isOpen) {
      element?.close();
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!element?.open) element?.showModal();
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="yujin-traders-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className={styles.layout}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <strong id="yujin-traders-title">업비트 · YuJin Traders</strong>
            <span>실시간 자동매매 관제 화면</span>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="업비트 화면 닫기">✕ 닫기</button>
        </header>
        <div className={styles.content}>
          {isOpen && <iframe ref={frame} className={styles.frame} src={YUJIN_TRADERS_URL} title="YuJin Traders 업비트 자동매매 화면" />}
        </div>
      </div>
    </dialog>
  );
}
