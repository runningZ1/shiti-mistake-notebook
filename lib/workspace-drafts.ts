import { z } from "zod";
import { parseMistakePrintOptions, printOptionsParams, type MistakePrintOptions } from "./mistake-print-options";

const id = z.string().min(1).max(128);
const optionsSchema = z.object({
  template: z.enum(["worksheet", "paste"]), fontSize: z.union([z.literal(12), z.literal(14)]),
  reflectionMode: z.enum(["saved-or-blank", "blank", "saved-plus-blank"]),
  includeAnswers: z.boolean(), includeSimilar: z.boolean(), imageWidthMm: z.number().min(60).max(165).refine(value => Number(value.toFixed(1)) === value).optional(),
}).strict().transform(options => parseMistakePrintOptions(printOptionsParams(options)) as MistakePrintOptions);

/** Student text only. These drafts never update saved reflections or AI reports. */
export const workspaceDraftPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  print: z.object({ itemIds: z.array(id).max(500).refine(ids => new Set(ids).size === ids.length), options: optionsSchema }).strict().optional(),
  reflections: z.record(id, z.string().refine(value => [...value].length <= 1000)).refine(values => Object.keys(values).length <= 500).optional(),
}).strict();
export const workspaceDraftWriteSchema = z.object({
  version: z.number().int().min(0).max(2147483646), payload: workspaceDraftPayloadSchema,
}).strict();
export type WorkspaceDraftPayload = z.infer<typeof workspaceDraftPayloadSchema>;
export type WorkspaceDraft = { key: string; profileId: string; version: number; payload: WorkspaceDraftPayload; updatedAt: string };
export function validDraftKey(key: string): boolean { return /^[a-z][a-z0-9-]{0,63}$/.test(key); }
