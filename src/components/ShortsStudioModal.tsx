"use client";

import { useCallback, useEffect, useRef } from "react";
import styles from "./ShortsStudioModal.module.css";

interface ShortsStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialStep?: string;
  targetAgentId?: string | null;
  targetAgentName?: string | null;
  targetAgentTask?: string | null;
}

export function ShortsStudioModal({
  isOpen,
  onClose,
  initialStep = "search",
  targetAgentId,
  targetAgentName,
  targetAgentTask,
}: ShortsStudioModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const lastNavigationKeyRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const navigateFrame = useCallback((step: string) => {
    frameRef.current?.contentWindow?.postMessage({ type: "navigate-step", step }, window.location.origin);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      if (!dialog.open) dialog.showModal();

      // 같은 직원을 다시 열 때는 iframe의 현재 단계·입력·검색 결과를 유지한다.
      // 직원이 바뀐 경우에만 해당 직원의 첫 단계로 이동한다.
      const navigationKey = `${targetAgentId || "unknown"}:${initialStep}`;
      if (lastNavigationKeyRef.current !== navigationKey) {
        navigateFrame(initialStep);
        lastNavigationKeyRef.current = navigationKey;
      }

      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }

    if (dialog.open) dialog.close();
  }, [initialStep, isOpen, navigateFrame, targetAgentId]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "close-shorts-modal") onCloseRef.current();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="shorts-studio-title"
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
    >
      <div className={styles.layout}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <strong id="shorts-studio-title" className={styles.title}>
              <span>🎬</span> 쇼츠부서 · 남다른AI Shorts 분석기
            </strong>
            <span className={styles.badge}>메뉴 연동</span>
            {targetAgentName && <span className={styles.status} style={{ color: "#A5B4FC", fontWeight: 700 }}>담당 직원: {targetAgentName}</span>}
            {targetAgentTask && <span className={styles.status} style={{ opacity: 0.75 }}>({targetAgentTask})</span>}
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.closeBtn} onClick={() => onCloseRef.current()} aria-label="쇼츠 분석기 닫기">✕ 닫기</button>
          </div>
        </header>
        <div className={styles.content}>
          <iframe
            ref={frameRef}
            className={styles.frame}
            title="남다른AI Shorts 분석기"
            src={`/shorts/index.html?step=${encodeURIComponent(initialStep)}`}
            onLoad={() => navigateFrame(initialStep)}
          />
        </div>
      </div>
    </dialog>
  );
}
