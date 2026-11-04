import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ReactFlow, Background, Controls, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GitBranch, RefreshCw, Plus, Trash2, X } from "lucide-react";
import { api } from "../../api.js";
import MarkdownMessage from "../../components/MarkdownMessage.jsx";
const types = ["구체화", "근거", "예시", "보완", "대조", "질문"];
export default function ThoughtMap({ session, onError, onSessionRefresh }) {
  const [graph, setGraph] = useState({ nodes: [], edges: [] }),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(null),
    [source, setSource] = useState(""),
    [target, setTarget] = useState(""),
    [type, setType] = useState("근거");
  useEffect(() => {
    let alive = true;
    setGraph({ nodes: [], edges: [] });
    setSelected(null);
    if (session?.id) {
      setBusy(true);
      api(`/sessions/${session.id}/graph`)
        .then(async (g) => {
          if (!alive) return;
          setGraph(g);
          if (g.nodes.length >= 2) {
            const r = await api(
              `/sessions/${session.id}/graph/refresh`,
              "POST",
              { expectedRevision: session.revision },
            );
            if (alive) setGraph(r);
          }
        })
        .catch((e) => {
          if (alive) onError(e);
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }
    return () => {
      alive = false;
    };
  }, [session?.id]);
  async function action(fn) {
    if (busy || !session) return;
    setBusy(true);
    try {
      await fn();
      setGraph(await api(`/sessions/${session.id}/graph`));
      await onSessionRefresh(session.id);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const nodes = useMemo(
    () =>
      graph.nodes.map((n, i) => ({
        id: n.id,
        position: { x: (i % 2) * 300, y: Math.floor(i / 2) * 170 },
        data: {
          label: (
            <>
              <span className="node-index">
                생각 {String(i + 1).padStart(2, "0")}
              </span>
              <span>
                {n.content.length > 90
                  ? n.content.slice(0, 90) + "…"
                  : n.content}
              </span>
            </>
          ),
        },
        style: { width: 250 },
      })),
    [graph.nodes],
  );
  const edges = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        label: e.type,
        style: { stroke: e.userEdited ? "#24664e" : "#a5b7ac" },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#709780" },
      })),
    [graph.edges],
  );
  return (
    <div className="graph-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SEE YOUR THINKING</span>
          <h1>생각과 생각 사이.</h1>
          <p>
            내가 남긴 발언을 연결해 봅니다. AI의 관계는 수정 가능한 제안입니다.
          </p>
        </div>
        <button
          className="secondary"
          disabled={busy || graph.nodes.length < 2}
          onClick={() =>
            action(async () => {
              const current = await api(`/sessions/${session.id}`);
              setGraph(
                await api(`/sessions/${session.id}/graph/refresh`, "POST", {
                  expectedRevision: current.session.revision,
                  force: true,
                }),
              );
            })
          }
        >
          <RefreshCw size={14} className={busy ? "spin" : ""} />
          관계 갱신
        </button>
      </div>
      {!graph.nodes.length ? (
        <div className="map-empty">
          <GitBranch size={40} strokeWidth={1} />
          <h2>발언이 쌓이면 관계가 보입니다.</h2>
          <p>문답에서 나눈 내 생각들이 이곳에 모입니다.</p>
        </div>
      ) : (
        <>
          <div className="map-canvas">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              nodesDraggable={false}
              onNodeClick={(_, n) =>
                setSelected(graph.nodes.find((m) => m.id === n.id))
              }
              onConnect={(c) =>
                action(() =>
                  api(`/sessions/${session.id}/graph/edges`, "POST", {
                    sourceId: c.source,
                    targetId: c.target,
                    type,
                  }),
                )
              }
            >
              <Background color="#cbd3c9" gap={24} />
              <Controls showInteractive={false} />
            </ReactFlow>
            <div className="map-legend">
              <span className="status-dot" />내 발언 · 노드를 누르면 원문이
              보여요
            </div>
          </div>
          <div className="relation-editor">
            <h3>관계 직접 연결하기</h3>
            <div className="relation-form">
              <select
                aria-label="시작 발언"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">시작 발언</option>
                {graph.nodes.map((n, i) => (
                  <option value={n.id} key={n.id}>
                    {i + 1}. {n.content.slice(0, 25)}
                  </option>
                ))}
              </select>
              <select
                aria-label="관계 유형"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {types.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <select
                aria-label="도착 발언"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">도착 발언</option>
                {graph.nodes.map((n, i) => (
                  <option value={n.id} key={n.id}>
                    {i + 1}. {n.content.slice(0, 25)}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                disabled={busy || !source || !target || source === target}
                onClick={() =>
                  action(() =>
                    api(`/sessions/${session.id}/graph/edges`, "POST", {
                      sourceId: source,
                      targetId: target,
                      type,
                    }),
                  )
                }
              >
                <Plus size={14} />
                추가
              </button>
            </div>
            {graph.edges.map((e) => (
              <div className="relation-row" key={e.id}>
                <span>
                  {graph.nodes
                    .find((n) => n.id === e.sourceId)
                    ?.content.slice(0, 20)}{" "}
                  →{" "}
                  {graph.nodes
                    .find((n) => n.id === e.targetId)
                    ?.content.slice(0, 20)}
                </span>
                <select
                  aria-label="저장된 관계 유형"
                  value={e.type}
                  disabled={busy}
                  onChange={(event) =>
                    action(() =>
                      api(`/sessions/${session.id}/graph/edges`, "POST", {
                        ...e,
                        type: event.target.value,
                      }),
                    )
                  }
                >
                  {types.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <small>{e.userEdited ? "내가 정한 관계" : "AI 제안"}</small>
                <button
                  className="icon-button"
                  aria-label="관계 삭제"
                  disabled={busy}
                  onClick={() =>
                    action(() =>
                      api(
                        `/sessions/${session.id}/graph/edges/${e.id}`,
                        "DELETE",
                        {},
                      ),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {selected && (
        <div className="node-detail">
          <button
            className="icon-button"
            aria-label="발언 원문 닫기"
            onClick={() => setSelected(null)}
          >
            <X size={16} />
          </button>
          <span className="eyebrow">내 발언 원문</span>
          <MarkdownMessage content={selected.content} />
        </div>
      )}
    </div>
  );
}
