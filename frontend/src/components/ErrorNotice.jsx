import React from "react";
import { AlertCircle, X } from "lucide-react";
export default function ErrorNotice({ error, onRetry, onClose }) {
  return error ? (
    <div className="error-notice" role="alert">
      <AlertCircle size={18} />
      <div>
        <strong>{error.message}</strong>
        {error.details?.retryAfter && (
          <p>{error.details.retryAfter}초 후 다시 시도해 주세요.</p>
        )}
        <span className="error-code">{error.code ?? "ERROR"}</span>
      </div>
      {onRetry && <button onClick={onRetry}>기록 새로고침</button>}
      <button
        className="icon-button"
        aria-label="오류 안내 닫기"
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
  ) : null;
}
