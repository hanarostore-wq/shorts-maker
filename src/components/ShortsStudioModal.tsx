"use client";

import { useEffect, useRef } from "react";
import styles from "./ShortsStudioModal.module.css";

interface ShortsStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialStep?: string;
  targetAgentName?: string | null;
  targetAgentTask?: string | null;
}

export function ShortsStudioModal({
  isOpen,
  onClose,
  initialStep = "search",
  targetAgentName,
  targetAgentTask,
}: ShortsStudioModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      dialog.showModal();

      // iframe이 이미 로드되어 있다면 postMessage로 단계 즉시 전환
      if (frameRef.current?.contentWindow) {
        frameRef.current.contentWindow.postMessage(
          { type: "navigate-step", step: initialStep },
          "*"
        );
      }

      return () => {
        document.body.style.overflow = prevOverflow;
      };
    } else {
      dialog.close();
    }
  }, [isOpen, initialStep]);

  // Handle postMessage events from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "close-shorts-modal") {
        onClose();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onClose]);

  if (!isOpen) return null;

  const frameSrc = `/shorts/index.html?step=${encodeURIComponent(initialStep)}`;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="shorts-studio-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className={styles.layout}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <strong id="shorts-studio-title" className={styles.title}>
              <span>🎬</span> 쇼츠부서 · 남다른AI Shorts 분석기
            </strong>
            <span className={styles.badge}>메뉴 연동</span>
            {targetAgentName && (
              <span className={styles.status} style={{ color: "#A5B4FC", fontWeight: 700 }}>
                담당 직원: {targetAgentName}
              </span>
            )}
            {targetAgentTask && (
              <span className={styles.status} style={{ opacity: 0.75 }}>
                ({targetAgentTask})
              </span>
            )}
          </div>

          <div className={styles.actions}>
            <a
              href={frameSrc}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.actionBtn}
              title="새 탭에서 전체 화면으로 열기"
            >
              <span>↗</span> 새 창 열기
            </a>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="쇼츠 분석기 닫기"
            >
              ✕ 닫기
            </button>
          </div>
        </header>

        <div className={styles.content}>
          <iframe
            ref={frameRef}
            className={styles.frame}
            title="남다른AI Shorts 분석기"
            src={frameSrc}
          />
        </div>
      </div>
    </dialog>
  );
}
