import React, { useEffect, useRef } from "react";
export default function ConfirmDialog({
  title = "기록을 변경할까요?",
  children,
  onConfirm,
  onCancel,
}) {
  const ref = useRef();
  useEffect(() => {
    ref.current?.showModal();
    const prior = document.activeElement;
    return () => prior?.focus?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className="modal-content">
        <span className="eyebrow">기록 변경 확인</span>
        <h2>{title}</h2>
        {children}
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel}>
            취소
          </button>
          <button className="primary" onClick={onConfirm}>
            확인하고 진행
          </button>
        </div>
      </div>
    </dialog>
  );
}
