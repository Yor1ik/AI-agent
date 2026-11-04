import { z } from "zod";
import { authorize, checkOrigin } from "./auth.js";
import { AppError, publicError } from "./errors.js";
import { body, json } from "./http.js";
import { text, revision, edgeType } from "./schemas.js";
import {
  createSession,
  listSessions,
  getSession,
  previewEdit,
  editMessage,
  deleteSession,
  setSessionStatus,
} from "./sessions.js";
import {
  sendMessage,
  regenerate,
  cancelGeneration,
  continueDialogue,
} from "./dialogue.js";
import {
  createResearch,
  getResearch,
  listResearch,
  advanceResearch,
  pauseResearch,
  resumeResearch,
  retryStep,
  followup,
} from "./research.js";
import { getGraph, refreshGraph, saveEdge, deleteEdge } from "./graph.js";
import { getUsage } from "./llm/client.js";
const parse = (schema, data) => {
  const r = schema.safeParse(data);
  if (!r.success)
    throw new AppError("VALIDATION", "입력 내용과 기록 버전을 확인해 주세요.");
  return r.data;
};
const rev = z.object({ expectedRevision: revision });
const message = z.object({ content: text, expectedRevision: revision });
export async function handleApi(request, env, options = {}) {
  try {
    const auth = await authorize(request, env, options.keyResolver);
    checkOrigin(request);
    const ctx = {
      db: env.DB,
      env,
      ownerId: auth.ownerId,
      fetchImpl: options.fetchImpl ?? fetch,
      now: () => new Date().toISOString(),
    };
    const parts = new URL(request.url).pathname
        .replace(/^\/api\/?/, "")
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent),
      method = request.method;
    if (parts[0] === "config" && method === "GET")
      return json({
        model: env.LLM_MODEL ?? null,
        modelConfigured: !!env.LLM_MODEL,
        keyConfigured: !!env.OPENROUTER_API_KEY,
        searchEnabled: env.SEARCH_ENABLED === "true",
        local: env.ENVIRONMENT === "local",
      });
    if (!ctx.db)
      throw new AppError("DB_CONFIG", "D1 DB 바인딩을 설정해 주세요.", 503);
    const data = ["POST", "PUT", "PATCH", "DELETE"].includes(method)
      ? await body(request)
      : {};
    if (parts[0] === "usage" && method === "GET")
      return json(await getUsage(ctx));
    if (parts[0] === "sessions") {
      const [, sid, action, mid, sub] = parts;
      if (!sid) {
        if (method === "GET") return json(await listSessions(ctx));
        if (method === "POST") return json(await createSession(ctx), 201);
      }
      if (sid && !action) {
        if (method === "GET") return json(await getSession(ctx, sid));
        if (method === "DELETE") {
          await deleteSession(ctx, sid, parse(rev, data).expectedRevision);
          return json({ ok: true });
        }
      }
      if (action === "status" && method === "POST")
        return json(
          await setSessionStatus(
            ctx,
            sid,
            parse(rev.extend({ status: z.enum(["active", "paused"]) }), data),
          ),
        );
      if (action === "answer" && method === "POST")
        return json(await continueDialogue(ctx, sid, parse(rev, data)));
      if (action === "cancel" && method === "POST")
        return json(await cancelGeneration(ctx, sid, parse(rev, data)));
      if (action === "messages") {
        if (!mid && method === "POST")
          return json(await sendMessage(ctx, sid, parse(message, data)));
        if (mid && sub === "impact" && method === "GET")
          return json(await previewEdit(ctx, sid, mid));
        if (mid && !sub && method === "PATCH")
          return json(await editMessage(ctx, sid, mid, parse(message, data)));
        if (mid && sub === "regenerate" && method === "POST")
          return json(
            await regenerate(ctx, sid, { messageId: mid, ...parse(rev, data) }),
          );
      }
      if (action === "research") {
        if (method === "GET") return json(await listResearch(ctx, sid));
        if (method === "POST")
          return json(
            await createResearch(
              ctx,
              sid,
              parse(
                rev.extend({
                  declaration: z
                    .string()
                    .min(1)
                    .max(30000)
                    .refine((x) => !!x.trim()),
                }),
                data,
              ),
            ),
            201,
          );
      }
      if (action === "graph") {
        if (method === "GET") return json(await getGraph(ctx, sid));
        if (mid === "refresh" && method === "POST")
          return json(
            await refreshGraph(
              ctx,
              sid,
              parse(rev.extend({ force: z.boolean().default(false) }), data),
            ),
          );
        if (mid === "edges" && method === "POST")
          return json(
            await saveEdge(
              ctx,
              sid,
              parse(
                z.object({
                  id: z.string().optional(),
                  sourceId: z.string(),
                  targetId: z.string(),
                  type: edgeType,
                  expectedRevision: revision,
                }),
                data,
              ),
            ),
          );
        if (mid === "edges" && sub && method === "DELETE") {
          await deleteEdge(ctx, sid, sub, parse(rev, data));
          return json({ ok: true });
        }
      }
    }
    if (parts[0] === "research") {
      const [, rid, action, stepId] = parts;
      if (!action && method === "GET") return json(await getResearch(ctx, rid));
      if (action === "advance" && method === "POST")
        return json(await advanceResearch(ctx, rid, parse(rev, data)));
      if (action === "pause" && method === "POST")
        return json(await pauseResearch(ctx, rid));
      if (action === "resume" && method === "POST")
        return json(await resumeResearch(ctx, rid, parse(rev, data)));
      if (action === "retry" && stepId && method === "POST")
        return json(await retryStep(ctx, rid, stepId, parse(rev, data)));
      if (action === "followup" && method === "POST")
        return json(
          await followup(
            ctx,
            rid,
            parse(
              message.extend({ allowSearch: z.boolean().default(false) }),
              data,
            ),
          ),
        );
    }
    throw new AppError("NOT_FOUND", "요청한 경로를 찾을 수 없습니다.", 404);
  } catch (error) {
    const response = publicError(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
