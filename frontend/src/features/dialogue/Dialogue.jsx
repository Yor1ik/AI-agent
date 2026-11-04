import React, { useState, useRef, useEffect } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Sparkles,
  RotateCcw,
  Pencil,
  MessageCircle,
  Compass,
  Pause,
  Play,
  BookOpen,
  Check,
  X,
} from "lucide-react";
import MarkdownMessage from "../../components/MarkdownMessage.jsx";
const suggestions = [
  "요즘 진로에 대해 고민하고 있어요",
  "내가 중요하게 생각하는 건 뭘까요?",
  "어떤 선택을 해야 할지 모르겠어요",
];
export default function Dialogue({
  session,
  messages,
  busy,
  onSend,
  onEdit,
  onRegenerate,
  onStatus,
  onReview,
  onResearch,
  onRetry,
}) {
  const [input, setInput] = useState(""),
    [editing, setEditing] = useState(null),
    [draft, setDraft] = useState("");
  const bottom = useRef();
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);
  useEffect(() => {
    setInput("");
    setEditing(null);
  }, [session?.id]);
  async function submit(e) {
    e.preventDefault();
    if (!input.trim() || busy || session?.busy || session?.status === "paused")
      return;
    const ok = await onSend(input.trim());
    if (ok) setInput("");
  }
  const conversation = messages.filter((m) => m.mode === "dialogue");
  return (
    <div
      className={
        "dialogue-page " + (!conversation.length ? "empty-dialogue" : "")
      }
    >
      {conversation.length > 0 && (
        <div className="conversation-toolbar">
          <span>
            <span className="status-dot" />{" "}
            {session?.status === "paused"
              ? "잠시 멈춘 문답"
              : "천천히, 당신의 속도로"}
          </span>
          <div>
            <button onClick={onReview}>
              <BookOpen size={14} />내 발언
            </button>
            <button
              onClick={() =>
                onStatus(session.status === "paused" ? "active" : "paused")
              }
              disabled={busy}
            >
              {session?.status === "paused" ? (
                <Play size={14} />
              ) : (
                <Pause size={14} />
              )}
              <span>
                {session?.status === "paused" ? "문답 재개" : "잠시 멈추기"}
              </span>
            </button>
          </div>
        </div>
      )}
      {!conversation.length ? (
        <div className="welcome">
          <div className="welcome-mark">
            <Sparkles size={29} strokeWidth={1.2} />
          </div>
          <div className="eyebrow">A SPACE FOR YOUR THOUGHTS</div>
          <h1>
            생각의 시작은,
            <br />
            <em>작은 질문 하나.</em>
          </h1>
          <p>
            답을 서두르지 않아도 괜찮아요.
            <br />
            질문을 따라, 내 생각을 조금 더 선명하게 만나 보세요.
          </p>
          <div className="intro-rule">
            <span /> 생각하는 사람은 언제나 당신입니다 <span />
          </div>
          <div className="suggestions">
            {suggestions.map((s, i) => (
              <button key={s} onClick={() => setInput(s)}>
                <span className="suggestion-icon">
                  {i === 0 ? (
                    <Compass size={18} />
                  ) : i === 1 ? (
                    <Sparkles size={18} />
                  ) : (
                    <MessageCircle size={18} />
                  )}
                </span>
                <span>{s}</span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="message-list">
          {conversation.map((m) => (
            <article className={"message " + m.role} key={m.id}>
              <div className="message-avatar">
                {m.role === "user" ? "나" : <Sparkles size={19} />}
              </div>
              <div className="message-body">
                <div className="message-name">
                  {m.role === "user" ? "나의 생각" : "Socratic Explorer"}
                  {m.role === "assistant" && <span>생각을 여는 질문</span>}
                </div>
                {editing === m.id ? (
                  <div className="edit-box">
                    <textarea
                      aria-label="발언 수정 내용"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <button
                      className="secondary"
                      onClick={() => setEditing(null)}
                    >
                      수정 취소
                    </button>
                    <button
                      className="primary"
                      disabled={!draft.trim() || busy}
                      onClick={async () => {
                        const accepted = await onEdit(m, draft);
                        if (accepted) setEditing(null);
                      }}
                    >
                      수정 적용
                    </button>
                  </div>
                ) : (
                  <MarkdownMessage content={m.content} />
                )}
                <div className="message-actions">
                  {m.role === "user" ? (
                    <button
                      aria-label="발언 수정"
                      disabled={busy}
                      onClick={() => {
                        setEditing(m.id);
                        setDraft(m.content);
                      }}
                    >
                      <Pencil size={13} />
                      수정
                    </button>
                  ) : (
                    <button
                      aria-label="질문 다시 생성"
                      disabled={busy}
                      onClick={() => onRegenerate(m)}
                    >
                      <RotateCcw size={13} />
                      다시 질문받기
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
          {busy && (
            <div className="thinking">
              <span />
              <span />
              <span /> 질문을 다듬고 있어요
            </div>
          )}
          {!busy && conversation.at(-1)?.role === "user" && !session?.busy && (
            <button className="secondary retry-question" onClick={onRetry}>
              <RotateCcw size={14} />
              질문 다시 시도
            </button>
          )}
          <div ref={bottom} />
        </div>
      )}
      <div className="composer-wrap">
        <form className="composer" onSubmit={submit}>
          <textarea
            aria-label="내 생각 입력"
            placeholder={
              session?.status === "paused"
                ? "문답을 재개하면 이어 쓸 수 있어요"
                : "지금 머릿속에 있는 생각을 편하게 적어 주세요…"
            }
            value={input}
            disabled={busy || session?.status === "paused" || session?.busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit(e);
              }
            }}
          />
          <div className="composer-bottom">
            <span>
              <span className="status-dot" /> 소크라테스식 문답
            </span>
            <div>
              <kbd>Enter</kbd>
              <span>전송</span>
              <button
                type="submit"
                aria-label="생각 보내기"
                disabled={
                  !input.trim() ||
                  busy ||
                  session?.busy ||
                  session?.status === "paused"
                }
              >
                <ArrowUp size={20} />
              </button>
            </div>
          </div>
        </form>
        <div className="composer-note">
          <span>AI는 답을 정하지 않고, 생각을 살펴볼 질문을 건넵니다.</span>
          <button onClick={onResearch}>
            직접 알아보고 싶은 게 있나요? <ArrowUpRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
