import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import {
  Plus,
  MessageCircle,
  Compass,
  GitBranch,
  ArrowUpRight,
  PanelLeftClose,
  PanelLeft,
  Trash2,
  BookOpen,
  X,
  Leaf,
  LockKeyhole,
  Settings2,
  Sparkles,
} from "lucide-react";
import { api } from "./api.js";
import Dialogue from "./features/dialogue/Dialogue.jsx";
const Research = lazy(() => import("./features/research/Research.jsx"));
const ThoughtMap = lazy(() => import("./features/graph/ThoughtMap.jsx"));

import ErrorNotice from "./components/ErrorNotice.jsx";
import UsageNotice from "./components/UsageNotice.jsx";
import ConfirmDialog from "./components/ConfirmDialog.jsx";
import MarkdownMessage from "./components/MarkdownMessage.jsx";
const tabs = [
  { id: "dialogue", label: "문답", Icon: MessageCircle },
  { id: "research", label: "탐색", Icon: Compass },
  { id: "graph", label: "사고 지도", Icon: GitBranch },
];
export default function App() {
  const [sessions, setSessions] = useState([]),
    [session, setSession] = useState(null),
    [messages, setMessages] = useState([]),
    [tab, setTab] = useState("dialogue"),
    [sidebar, setSidebar] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [config, setConfig] = useState(null),
    [usage, setUsage] = useState(null),
    [confirm, setConfirm] = useState(null),
    [review, setReview] = useState(false),
    [settings, setSettings] = useState(false),
    [loading, setLoading] = useState(true);
  const selected = useRef(null),
    actionLock = useRef(false),
    selectionEpoch = useRef(0);
  function apply(snapshot) {
    if (selected.current !== snapshot.session.id) return;
    setSession(snapshot.session);
    setMessages(snapshot.messages);
  }
  async function refreshList() {
    const list = await api("/sessions");
    setSessions(list);
    return list;
  }
  async function refresh(id = selected.current) {
    if (!id) return;
    const data = await api(`/sessions/${id}`);
    apply(data);
    return data.session;
  }
  async function select(id) {
    const epoch = ++selectionEpoch.current;
    selected.current = id;
    setSession(null);
    setMessages([]);
    setLoading(true);
    setError(null);
    setSidebar(false);
    localStorage.setItem("socratic-session", id);
    try {
      const data = await api(`/sessions/${id}`);
      if (selectionEpoch.current === epoch) apply(data);
    } catch (e) {
      setError(e);
    } finally {
      if (selectionEpoch.current === epoch) setLoading(false);
    }
  }
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, list] = await Promise.all([api("/config"), api("/sessions")]);
        if (!alive) return;
        setConfig(c);
        setSessions(list);
        if (list.length) {
          const saved = localStorage.getItem("socratic-session");
          await select(list.some((s) => s.id === saved) ? saved : list[0].id);
        }
        setUsage(await api("/usage"));
      } catch (e) {
        if (alive) setError(e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  async function action(fn) {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refreshList();
      return true;
    } catch (e) {
      setError(e);
      try {
        await refresh();
        await refreshList();
      } catch {}
      return false;
    } finally {
      actionLock.current = false;
      setBusy(false);
      api("/usage")
        .then(setUsage)
        .catch(() => {});
    }
  }
  async function ensureSession() {
    if (session) return session;
    const s = await api("/sessions", "POST", {});
    selected.current = s.id;
    setSession(s);
    setMessages([]);
    localStorage.setItem("socratic-session", s.id);
    await refreshList();
    return s;
  }
  async function openTab(id) {
    if (id === "research" && !session) {
      await action(async () => {
        await ensureSession();
        setTab(id);
      });
    } else setTab(id);
  }
  const send = (content) =>
    action(async () => {
      const s = await ensureSession();
      apply(
        await api(`/sessions/${s.id}/messages`, "POST", {
          content,
          expectedRevision: s.revision,
        }),
      );
    });
  async function newSession() {
    await action(async () => {
      const s = await api("/sessions", "POST", {});
      await select(s.id);
      setTab("dialogue");
    });
  }
  async function edit(m, content) {
    try {
      const impact = await api(
        `/sessions/${session.id}/messages/${m.id}/impact`,
      );
      setConfirm({
        title: "이 발언부터 다시 이어갈까요?",
        description: `이후 메시지 ${impact.affected.messages}개와 관련 탐색 ${impact.affected.research}개가 삭제됩니다. 수정된 발언의 관계도 다시 검토하게 됩니다.`,
        execute: () =>
          action(async () =>
            apply(
              await api(`/sessions/${session.id}/messages/${m.id}`, "PATCH", {
                content,
                expectedRevision: impact.revision,
              }),
            ),
          ),
      });
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  }
  async function regenerate(m) {
    const execute = () =>
      action(async () =>
        apply(
          await api(
            `/sessions/${session.id}/messages/${m.id}/regenerate`,
            "POST",
            { expectedRevision: session.revision },
          ),
        ),
      );
    const suffix = messages.filter((x) => x.position > m.position);
    if (suffix.length) {
      const impact = await api(
        `/sessions/${session.id}/messages/${m.id}/impact`,
      );
      setConfirm({
        title: "이 질문부터 다시 이어갈까요?",
        description: `성공하면 이후 메시지 ${suffix.length}개와 관련 탐색 ${impact.affected.research}개가 삭제됩니다. 실패하면 기존 질문과 기록은 유지됩니다.`,
        execute,
      });
    } else await execute();
  }
  function askDelete(s) {
    setConfirm({
      title: "이 대화를 삭제할까요?",
      description:
        "이 대화의 모든 발언, 탐색 결과, 사고 지도가 함께 삭제됩니다. 되돌릴 수 없습니다.",
      execute: () =>
        action(async () => {
          const current = await api(`/sessions/${s.id}`);
          await api(`/sessions/${s.id}`, "DELETE", {
            expectedRevision: current.session.revision,
          });
          if (selected.current === s.id) {
            selected.current = null;
            setSession(null);
            setMessages([]);
            localStorage.removeItem("socratic-session");
          }
          await refreshList();
        }),
    });
  }
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (sidebar ? "open" : "")}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setTab("dialogue");
          }}
        >
          <div className="brand-symbol">
            <span />
            <span />
            <span />
          </div>
          <div>
            Socratic<span>EXPLORER</span>
          </div>
        </a>
        <button
          className="new-conversation"
          disabled={busy}
          onClick={newSession}
        >
          <Plus size={17} />
          새로운 생각 시작하기<span>↗</span>
        </button>
        <div className="sidebar-label">
          나의 생각들 <span>{sessions.length.toString().padStart(2, "0")}</span>
        </div>
        <nav className="session-list" aria-label="이전 대화">
          {sessions.length ? (
            sessions.map((s) => (
              <div
                className={
                  "session-item " + (session?.id === s.id ? "selected" : "")
                }
                key={s.id}
              >
                <button disabled={busy} onClick={() => select(s.id)}>
                  <MessageCircle size={15} />
                  <span>{s.title}</span>
                </button>
                <button
                  className="delete-session"
                  aria-label={`${s.title} 대화 삭제`}
                  disabled={busy}
                  onClick={() => askDelete(s)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          ) : (
            <p className="no-history">
              아직 기록된 생각이 없어요.
              <br />첫 이야기를 시작해 보세요.
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-quote">
            <span>“</span>
            <p>
              성찰하지 않는 삶은
              <br />살 가치가 없다.
            </p>
            <small>— 소크라테스</small>
          </div>
          <div className="sidebar-divider" />
          <UsageNotice usage={usage} model={config?.model} />
          <button className="settings-link" onClick={() => setSettings(true)}>
            <Settings2 size={15} />
            연결 및 개인정보<span>↗</span>
          </button>
        </div>
      </aside>
      {sidebar && (
        <button
          aria-label="메뉴 닫기"
          className="sidebar-overlay"
          onClick={() => setSidebar(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-toggle"
              aria-label="대화 목록 열기"
              onClick={() => setSidebar(!sidebar)}
            >
              <PanelLeft size={19} />
            </button>
            <Leaf size={15} />
            <span>나의 사유 공간</span>
            <span className="breadcrumb-separator">/</span>
            <strong>{session?.title ?? "새로운 생각"}</strong>
          </div>
          <div className="private-badge">
            <LockKeyhole size={12} />
            <span>나만의 공간</span>
          </div>
        </header>
        <div className="workspace-nav">
          <div className="tab-group" role="navigation" aria-label="작업 화면">
            {tabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                disabled={busy || loading}
                onClick={() => openTab(id)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          <span className="nav-note">
            {tab === "dialogue"
              ? "답보다 질문에 가까운 시간"
              : tab === "research"
                ? "궁금함에서 근거까지"
                : "내 생각을 연결하는 시간"}
          </span>
        </div>
        <main>
          <Suspense
            fallback={
              <div className="loading-state">화면을 불러오고 있어요…</div>
            }
          >
            <ErrorNotice
              error={error}
              onClose={() => setError(null)}
              onRetry={() => action(() => refresh())}
            />
            {(session?.busy || session?.graphBusy) && !busy && (
              <div className="inline-notice">
                완료되지 않은 응답이 있습니다. 진행 중인 요청이 없다면 취소한 뒤
                다시 시도하세요.
                <button
                  className="text-link"
                  onClick={() =>
                    action(async () =>
                      apply(
                        await api(`/sessions/${session.id}/cancel`, "POST", {
                          expectedRevision: session.revision,
                        }),
                      ),
                    )
                  }
                >
                  기존 생성 취소
                </button>
              </div>
            )}
            {loading ? (
              <div className="loading-state">
                <span className="status-dot" /> 생각을 불러오고 있어요…
              </div>
            ) : tab === "dialogue" ? (
              <Dialogue
                session={session}
                messages={messages}
                busy={busy}
                onSend={send}
                onEdit={edit}
                onRegenerate={(m) => regenerate(m).catch(setError)}
                onStatus={(status) =>
                  action(async () =>
                    apply(
                      await api(`/sessions/${session.id}/status`, "POST", {
                        status,
                        expectedRevision: session.revision,
                      }),
                    ),
                  )
                }
                onReview={() => setReview(true)}
                onResearch={() => openTab("research")}
                onRetry={() =>
                  action(async () =>
                    apply(
                      await api(`/sessions/${session.id}/answer`, "POST", {
                        expectedRevision: session.revision,
                      }),
                    ),
                  )
                }
              />
            ) : tab === "research" ? (
              <Research
                key={session?.id ?? "new"}
                session={session}
                ensureSession={ensureSession}
                onSessionRefresh={refresh}
                onError={setError}
                onBack={() => setTab("dialogue")}
                messages={messages}
                config={config}
              />
            ) : (
              <ThoughtMap
                session={session}
                onError={setError}
                onSessionRefresh={refresh}
              />
            )}
          </Suspense>
        </main>
        <footer className="app-footer">
          <span>Socratic Explorer</span>
          <span>결론을 내리지 않아도, 생각은 앞으로 갑니다.</span>
          <span>나를 이해하는 작은 질문들</span>
        </footer>
      </div>
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const fn = confirm.execute;
            setConfirm(null);
            fn();
          }}
        >
          <p>{confirm.description}</p>
        </ConfirmDialog>
      )}
      {review && (
        <ConfirmDialog
          title="내 발언 돌아보기"
          onCancel={() => setReview(false)}
          onConfirm={() => setReview(false)}
        >
          <div className="review-list">
            {messages
              .filter((m) => m.role === "user" && m.mode === "dialogue")
              .map((m, i) => (
                <article key={m.id}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <MarkdownMessage content={m.content} />
                </article>
              ))}
          </div>
          <button className="text-link" onClick={() => setReview(false)}>
            닫기
          </button>
        </ConfirmDialog>
      )}
      {settings && (
        <ConfirmDialog
          title="연결 및 개인정보"
          onCancel={() => setSettings(false)}
          onConfirm={() => setSettings(false)}
        >
          <div className="settings-body">
            <p>
              대화와 탐색 기록은 나의 데이터베이스에 저장됩니다. 대화를 삭제하면
              관련 기록도 삭제됩니다.
            </p>
            <p>
              응답을 만들 때 대화가 OpenRouter와 선택한 모델 제공업체에
              전달됩니다. 제공업체의 무료 모델 데이터 정책을 확인해 주세요.
              이름·연락처 같은 민감한 정보는 입력하지 마세요.
            </p>
            <p>
              모델: <strong>{config?.model ?? "서버 설정 필요"}</strong>
              <br />
              검색:{" "}
              {config?.searchEnabled ? "허용됨 · 추가 비용 가능" : "사용 안 함"}
              <br />
              API 연결:{" "}
              {config?.keyConfigured
                ? "키 설정됨 · 실제 연결은 호출 시 확인"
                : "키 설정 필요"}
            </p>
            <p>
              앱의 호출 시도 수는 다른 앱의 사용을 포함하지 않으며 정확한 일일
              잔여량이 아닙니다. 10달러 충전만으로 사용 가능 횟수를 보장하지
              않습니다.
            </p>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
