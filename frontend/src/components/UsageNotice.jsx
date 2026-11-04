import React from "react";
export default function UsageNotice({ usage, model }) {
  return (
    <div className="usage">
      <div className="status-dot" />
      <div>
        <strong>{model ? model.split("/").at(-1) : "모델 설정 필요"}</strong>
        <small>
          {usage?.appAttempts ?? 0}회 시도 (보관 기록 기준) · 계정 잔여 호출 수
          확인 불가
        </small>
        <small>검색은 별도 비용이 발생할 수 있습니다.</small>
      </div>
    </div>
  );
}
