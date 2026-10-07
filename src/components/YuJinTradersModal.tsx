"use client";

import { useEffect, useRef } from "react";
import styles from "./YuJinTradersModal.module.css";

const YUJIN_TRADERS_URL = "https://yujintrade-lfpspwta.manus.space/?embed=control-room&v=1.10.52";

export function YuJinTradersModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

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
          {isOpen && <iframe className={styles.frame} src={YUJIN_TRADERS_URL} title="YuJin Traders 업비트 자동매매 화면" />}
        </div>
      </div>
    </dialog>
  );
}
