import React, { useState, useEffect, useRef } from "react";
import {
  Compass,
  ArrowUpRight,
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  Check,
  LoaderCircle,
  ExternalLink,
  Plus,
  Search,
  AlertCircle,
} from "lucide-react";
import { api } from "../../api.js";
import MarkdownMessage from "../../components/MarkdownMessage.jsx";
const labels = {
  pending: "대기",
  ready: "다음 단계 대기",
  decomposing: "질문을 나누는 중",
  researching: "자료 검색·분석 중",
  synthesizing: "결과를 통합하는 중",
  completed: "완료",
  partial: "일부 완료",
  failed: "실패",
  paused: "일시정지",
};
export default function Research({
  session,
  ensureSession,
  onSessionRefresh,
  onError,
  onBack,
  messages,
  config,
}) {
  const [declaration, setDeclaration] = useState(""),
    [runs, setRuns] = useState([]),
    [run, setRun] = useState(null),
    [busy, setBusy] = useState(false),
    [follow, setFollow] = useState(""),
    [allowSearch, setAllowSearch] = useState(false);
  const drive = useRef(false),
    runRef = useRef(null),
    mounted = useRef(true);
  const setCurrent = (r) => {
    runRef.current = r;
    if (mounted.current) setRun(r);
  };
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    setRun(null);
    setRuns([]);
    if (session?.id)
      api(`/sessions/${session.id}/research`)
        .then(async (list) => {
          if (!alive) return;
          setRuns(list);
          if (list.length) {
            const r = await api(`/research/${list[0].id}`);
            if (alive) setCurrent(r);
          }
        })
        .catch(onError);
    return () => {
      alive = false;
      mounted.current = false;
      drive.current = false;
    };
  }, [session?.id]);
  useEffect(() => {
    if (
      !run ||
      !["decomposing", "researching", "synthesizing"].includes(run.status)
    )
      return;
    const timer = setInterval(async () => {
      if (document.hidden || drive.current) return;
      try {
        setCurrent(await api(`/research/${run.id}`));
      } catch (e) {
        onError(e);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [run?.id, run?.status]);
  async function task(fn) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
      if (runRef.current) {
        try {
          setCurrent(await api(`/research/${runRef.current.id}`));
        } catch {}
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function create() {
    await task(async () => {
      const s = await ensureSession();
      let r = await api(`/sessions/${s.id}/research`, "POST", {
        declaration,
        expectedRevision: s.revision,
      });
      setCurrent(r);
      setRuns((prev) => [r, ...prev]);
      await onSessionRefresh(s.id);
      r = await api(`/research/${r.id}/advance`, "POST", {
        expectedRevision: r.revision,
      });
      setCurrent(r);
    });
  }
  async function execute() {
    await task(async () => {
      drive.current = true;
      let r = runRef.current;
      if (["failed", "paused"].includes(r.status)) {
        r = await api(`/research/${r.id}/resume`, "POST", {
          expectedRevision: r.revision,
        });
        setCurrent(r);
      }
      while (
        drive.current &&
        mounted.current &&
        !document.hidden &&
        ["ready", "pending"].includes(r.status)
      ) {
        r = await api(`/research/${r.id}/advance`, "POST", {
          expectedRevision: r.revision,
        });
        if (!drive.current) break;
        setCurrent(r);
        if (["failed", "partial", "completed", "paused"].includes(r.status))
          break;
      }
      drive.current = false;
    });
  }
  async function pause() {
    drive.current = false;
    try {
      setCurrent(await api(`/research/${run.id}/pause`, "POST", {}));
    } catch (e) {
      onError(e);
    }
  }
  const complete = run && ["completed", "partial"].includes(run.status);
  const followMessages = messages.filter((m) => m.researchRunId === run?.id);
  return (
    <div className="research-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FOLLOW YOUR CURIOSITY</span>
          <h1>궁금함을, 탐색으로.</h1>
          <p>
            알아보고 싶은 대상을 직접 정해 주세요. 자료와 근거를 함께
            살펴봅니다.
          </p>
        </div>
        <div className="section-icon">
          <Compass size={28} />
        </div>
      </div>
      {!config?.searchEnabled && (
        <div className="inline-notice">
          <AlertCircle size={16} />
          검색이 꺼져 있습니다. 서버 설정에서 허용해야 자료를 조사할 수
          있습니다.
        </div>
      )}
      {runs.length > 0 && (
        <div className="run-picker">
          <label>
            이전 탐색
            <select
              aria-label="이전 탐색 선택"
              value={run?.id ?? ""}
              onChange={(e) =>
                task(async () =>
                  setCurrent(await api(`/research/${e.target.value}`)),
                )
              }
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.declaration.slice(0, 40)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              drive.current = false;
              setCurrent(null);
              setDeclaration("");
            }}
          >
            <Plus size={14} />새 탐색
          </button>
        </div>
      )}
      {!run ? (
        <div className="declaration-card">
          <span className="card-number">01 — 나의 탐색 선언</span>
          <h2>무엇을 알아보고 싶나요?</h2>
          <p>AI가 정한 문제가 아닌, 내가 궁금한 내용을 적어 주세요.</p>
          <textarea
            aria-label="탐색할 내용"
            placeholder="예: 게임 개발자가 실제로 어떤 일을 하는지 알아보고 싶어요."
            value={declaration}
            onChange={(e) => setDeclaration(e.target.value)}
          />
          <div className="card-footer">
            <small>검색에는 추가 비용이 발생할 수 있습니다.</small>
            <button
              className="primary"
              disabled={busy || !declaration.trim()}
              onClick={create}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ArrowUpRight size={16} />
              )}
              질문 나누기
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="declaration-summary">
            <span className="eyebrow">내가 정한 탐색 대상 · 원문</span>
            <p>{run.declaration}</p>
            <span className={"pill " + (complete ? "success" : "")}>
              {labels[run.status] ?? run.status}
            </span>
          </div>
          <div className="research-progress">
            <div>
              <strong>탐색 과정</strong>
              <span>
                {run.steps.filter((s) => s.status === "completed").length} /{" "}
                {run.steps.length}개 질문 조사 완료
              </span>
            </div>
            <div className="progress-track">
              <span
                style={{
                  width: run.steps.length
                    ? `${(run.steps.filter((s) => s.status === "completed").length / run.steps.length) * 100}%`
                    : "0%",
                }}
              />
            </div>
          </div>
          {run.error && (
            <div role="alert" className="inline-notice error">
              <AlertCircle size={16} />
              {run.error.message}
            </div>
          )}
          {run.steps.map((step, i) => (
            <details
              className="research-step"
              key={step.id}
              open={step.status === "completed" || step.status === "failed"}
            >
              <summary>
                <span className={"step-number " + step.status}>
                  {step.status === "completed" ? (
                    <Check size={15} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <strong>{step.question}</strong>
                <span className="step-status">
                  {run.activeStepId === step.id
                    ? "검색·분석 중"
                    : (labels[step.status] ?? "대기")}
                </span>
              </summary>
              {step.result && (
                <div className="step-body">
                  <MarkdownMessage content={step.result} />
                  {step.sources.length > 0 && (
                    <div className="sources">
                      <span className="eyebrow">확인한 자료</span>
                      {step.sources.map((s) => (
                        <a
                          key={s.id}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink size={13} />
                          {s.title}
                        </a>
                      ))}
                    </div>
                  )}
                  {step.uncertainties?.map((u, j) => (
                    <p className="uncertainty" key={j}>
                      확인 필요 · {u}
                    </p>
                  ))}
                </div>
              )}
              {step.error && (
                <div className="step-body">
                  <p className="uncertainty">{step.error.message}</p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      task(async () =>
                        setCurrent(
                          await api(
                            `/research/${run.id}/retry/${step.id}`,
                            "POST",
                            { expectedRevision: run.revision },
                          ),
                        ),
                      )
                    }
                  >
                    <RotateCcw size={14} />이 질문 재시도 준비
                  </button>
                </div>
              )}
            </details>
          ))}
          {run.steps.length > 0 && !complete && (
            <p className="budget-note">
              기본 예상 호출: 하위 질문 {run.steps.length}회 + 분해·통합 2회.
              재시도와 추가 검색은 별도입니다.
            </p>
          )}
          {!complete && (
            <div className="research-controls">
              {busy ||
              ["decomposing", "researching", "synthesizing"].includes(
                run.status,
              ) ? (
                <>
                  <span>
                    <LoaderCircle size={16} className="spin" />{" "}
                    {labels[run.status] ?? "처리 중"}
                  </span>
                  <button className="secondary" onClick={pause}>
                    <Pause size={14} />
                    작업 중단
                  </button>
                </>
              ) : (
                <button className="primary" onClick={execute}>
                  <Play size={15} />
                  {run.status === "ready"
                    ? "자료 조사 시작"
                    : run.status === "paused"
                      ? "탐색 재개"
                      : "탐색 다시 시도"}
                </button>
              )}
            </div>
          )}
          {complete && (
            <section className="result-card">
              <div className="eyebrow">WHAT WE FOUND</div>
              <h2>탐색 결과</h2>
              <MarkdownMessage content={run.result?.answer ?? ""} />
              {run.result?.uncertainties?.length > 0 && (
                <div className="remaining">
                  <h3>남아 있는 의문</h3>
                  {run.result.uncertainties.map((u, i) => (
                    <p key={i}>{u}</p>
                  ))}
                </div>
              )}
            </section>
          )}
          {complete && (
            <section className="followup">
              <h3>이 결과에서 더 궁금한 점</h3>
              {followMessages.map((m) => (
                <div className={"follow-message " + m.role} key={m.id}>
                  <small>{m.role === "user" ? "내 질문" : "추가 답변"}</small>
                  <MarkdownMessage content={m.content} />
                </div>
              ))}
              <textarea
                aria-label="탐색 결과 추가 질문"
                value={follow}
                onChange={(e) => setFollow(e.target.value)}
                placeholder="조사 결과에 대해 이어서 질문해 보세요."
              />
              <div className="card-footer">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={allowSearch}
                    onChange={(e) => setAllowSearch(e.target.checked)}
                  />
                  새 자료 검색 허용 (추가 비용)
                </label>
                <button
                  className="primary"
                  disabled={busy || !follow.trim()}
                  onClick={() =>
                    task(async () => {
                      const current = await api(`/sessions/${session.id}`);
                      await api(`/research/${run.id}/followup`, "POST", {
                        content: follow,
                        allowSearch,
                        expectedRevision: current.session.revision,
                      });
                      setFollow("");
                      await onSessionRefresh(session.id);
                    })
                  }
                >
                  추가 질문
                </button>
              </div>
            </section>
          )}
        </>
      )}
      <button className="text-link back-link" onClick={onBack}>
        <ArrowLeft size={14} />
        문답으로 돌아가기
      </button>
      <p className="research-footnote">
        탐색은 이 화면이 열려 있을 때 진행됩니다. 완료된 단계는 저장되며 나중에
        이어갈 수 있습니다.
      </p>
    </div>
  );
}
