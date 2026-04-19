import { z } from 'zod';

const packedSymbolSchema = z.object({
  symbol_key: z.string().length(64).regex(/^[0-9a-f]+$/),
  parent_key: z.string().nullable(),
  file_path: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  signature: z.string().nullable(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  modifiers: z.array(z.string()),
  annotations: z.array(z.string()),
});

const packedOccurrenceSchema = z.object({
  caller_key: z.string().nullable(),
  callee_name: z.string().min(1),
  kind: z.enum(['call', 'field_access', 'type_reference', 'annotation']),
  file_path: z.string().min(1),
  line: z.number().int().positive(),
});

export const packedIndexSchema = z.object({
  schema_version: z.literal(1),
  repo_name: z.string().min(1),
  commit_sha: z.string().min(1),
  branch: z.string().nullable(),
  generated_at: z.number().int(),
  symbols: z.array(packedSymbolSchema),
  occurrences: z.array(packedOccurrenceSchema),
  files: z.array(z.string()),
});

export type PackedIndexPayload = z.infer<typeof packedIndexSchema>;
