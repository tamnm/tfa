import { z, type ZodRawShape } from "zod";

const knowledgeFilterShape = {
  type: z.string().describe("Filter atoms by type, e.g. 'Note' or 'Relation'.").optional(),
  tags: z.array(z.string().describe("Match atoms tagged with these labels, e.g. 'infra'.")).describe("Restrict atoms to those containing all listed tags.").optional(),
  sourceLike: z.string().describe("SQL LIKE pattern applied to the atom source, e.g. '%codex%'.").optional(),
  origin: z.string().describe("Filter by origin field (producer of the atom), e.g. 'agent'.").optional(),
  target: z.string().describe("Filter by target entity identifier, e.g. 'job-123'.").optional()
} satisfies ZodRawShape;

const knowledgeAtomShape = {
  type: z.string().describe("Atom type label, e.g. 'Note', 'Fact', or 'Relation'."),
  text_or_payload: z.string().describe("Primary textual content for the atom, e.g. 'Restarted the MCP server'.").optional(),
  source: z.string().describe("Human-readable source, e.g. 'deploy-log'.").optional(),
  locator: z.string().describe("Precise location or URI pointing to the source evidence.").optional(),
  timestamp: z.string().describe("ISO-8601 timestamp for when the atom was recorded, e.g. '2025-01-12T09:35:00Z'.").optional(),
  confidence: z.number().describe("Confidence score between 0 and 1, e.g. 0.8.").optional(),
  origin: z.string().describe("Producer or pipeline that generated the atom, e.g. 'codex'.").optional(),
  target: z.string().describe("Entity this atom attaches to, e.g. 'job-abc'.").optional(),
  subject_atom_id: z.string().describe("Subject atom id for relations.").optional(),
  predicate: z.string().describe("Relationship predicate when type is 'Relation', e.g. 'depends_on'.").optional(),
  object_atom_id: z.string().describe("Object atom id for relations.").optional(),
  evidence_json: z.array(z.string().describe("JSON-encoded evidence identifiers or snippets.")).describe("Evidence payloads supporting the atom.").optional(),
  refutes_atom_id: z.string().describe("Atom id that this atom refutes, if any.").optional(),
  tags: z.array(z.string().describe("Label to support later filtering, e.g. 'urgent'.")).describe("Tags applied to the atom.").optional()
} satisfies ZodRawShape;

export const createTaskInputSchema = {
  job: z.string().describe("Job identifier, e.g. 'job-123'."),
  type: z.string().describe("Task type slug, e.g. 'code-edit'."),
  target: z.string().describe("Optional target entity such as a file path or URL.").optional(),
  fingerprint: z.string().describe("Optional uniqueness fingerprint to avoid duplicate tasks.").optional(),
  description: z.string().describe("Human-readable task description.").optional(),
  dedupe: z.boolean().describe("Set true to skip creation when a matching fingerprint exists.").optional()
} satisfies ZodRawShape;

export const getOpenTasksInputSchema = {
  job: z.string().describe("Restrict open-task listing to a specific job id.").optional()
} satisfies ZodRawShape;

export const getTaskInputSchema = {
  id: z.string().describe("Task identifier to fetch, e.g. 'task-42'.").optional(),
  job: z.string().describe("If id is omitted, pull next open task under this job.").optional()
} satisfies ZodRawShape;

export const completeTaskInputSchema = {
  id: z.string().describe("Task identifier to complete."),
  result: z.unknown().describe("Optional structured result payload returned to the client.").optional()
} satisfies ZodRawShape;

export const updateProgressInputSchema = {
  id: z.string().describe("Task identifier to update."),
  status: z.string().describe("New task status, e.g. 'running'.").optional(),
  cursor: z.unknown().describe("Opaque progress cursor data stored by the client.").optional(),
  note: z.string().describe("Free-form status note exposed to users.").optional()
} satisfies ZodRawShape;

export const createJobInputSchema = {
  id: z.string().describe("Unique job identifier, e.g. 'job-123'."),
  title: z.string().describe("Human-friendly job title.").optional(),
  instructions: z.string().describe("Full job instructions for the agent.").optional(),
  params: z.unknown().describe("Structured parameters consumed by your agent workflow.").optional(),
  status: z.string().describe("Initial job status, defaults to implementation default (e.g. 'open').").optional()
} satisfies ZodRawShape;

export const getJobInputSchema = {
  id: z.string().describe("Job identifier to fetch.")
} satisfies ZodRawShape;

export const updateJobInputSchema = {
  id: z.string().describe("Job identifier to update."),
  title: z.string().describe("Updated job title.").optional(),
  instructions: z.string().describe("Revised instructions payload.").optional(),
  params: z.unknown().describe("Updated structured params.").optional(),
  status: z.string().describe("New job status, e.g. 'running' or 'closed'.").optional()
} satisfies ZodRawShape;

export const listJobsInputSchema = {
  status: z.string().describe("Optional status filter, e.g. 'open'.").optional()
} satisfies ZodRawShape;

export const ksAddAtomInputSchema = knowledgeAtomShape;

export const ksAddAtomsInputSchema = {
  items: z.array(z.object(knowledgeAtomShape).describe("Single atom definition.")).describe("Batch of atoms to insert in a single call.")
} satisfies ZodRawShape;

export const ksSearchTextInputSchema = {
  query: z.string().describe("Natural language or keyword query to embed, e.g. 'open MCP incidents'."),
  topK: z.number().describe("Maximum number of hits to return (default 20).").optional(),
} satisfies ZodRawShape;

export const ksQueryInputSchema = {
  sql: z.string().describe("SQL SELECT statement over the knowledge tables."),
  params: z.object({}).passthrough().describe("Named parameters referenced in the SQL statement.").optional()
} satisfies ZodRawShape;

export const ksReembedAtomInputSchema = {
  id: z.string().describe("Atom identifier to re-embed."),
  text: z.string().describe("Optional override text to embed instead of stored content.").optional()
} satisfies ZodRawShape;

export const ksReembedAllInputSchema = {
  filter: z.object(knowledgeFilterShape).describe("Limit re-embedding to atoms that satisfy these filters.").optional()
} satisfies ZodRawShape;
