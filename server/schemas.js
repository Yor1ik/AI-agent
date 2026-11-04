import { z } from "zod";
export const text = z.string().trim().min(1).max(30000);
export const revision = z.number().int().nonnegative();
export const dialogueOutput = z.object({ text: text });
export const decomposition = z.object({ questions: z.array(text).min(1) });
export const researchOutput = z.object({
  answer: text,
  uncertainties: z.array(z.string()).default([]),
});
export const synthesisOutput = z.object({
  answer: text,
  sourceIds: z.array(z.string()),
  uncertainties: z.array(z.string()).default([]),
});
export const edgeType = z.enum([
  "구체화",
  "근거",
  "예시",
  "보완",
  "대조",
  "질문",
]);
export const graphOutput = z.object({
  edges: z.array(
    z.object({ sourceId: z.string(), targetId: z.string(), type: edgeType }),
  ),
});
