# Agent Prompts

## Zero-Hallucination Protocol (src/prompts/rules/zero-halluciation.md)
Zero‑Hallucination Protocol for Knowledge Tools

Purpose
- Eliminate unsupported claims by enforcing cite‑on‑claim, provenance, and clarification loops when context is incomplete or ambiguous.
- Guide agents to enrich context, clarify assumptions, and follow up systematically using the available knowledge tools.

Core Principles
- Cite‑on‑claim: every nontrivial statement must trace back to atoms with provenance (source + locator).
- No fabrication: if the KB lacks evidence, explicitly state unknowns and open a clarification loop instead of guessing.
- Smallest sufficient scope: prefer precise queries (type/tags/source) before broad semantic search.
- Update the record: when a clarification resolves an unknown, add atoms with tags and provenance so future queries succeed.

Note: Atom types, tag conventions, and relation predicates are defined in knowledge_instruction.md. Do not duplicate them here.

Rule of Thumb: SQL vs Semantic Search
- Use SQL (ks_query) when you know the shape (precision, speed):
  - Exact path/scope: source LIKE 'src/api/%', or scope tags (scope:repo:…, scope:service:…).
  - Known categories: cat:coding-standard, cat:security-policy, cat:runbook.
  - Structural slices: type='Entity' with tags (domain, layer, kind); Relations by predicate='calls', 'imports', etc.
  - Audits/coverage: counts, specific lists, or joins (e.g., “all endpoints without docs”).
- Use semantic (ks_search_text) when you need recall/discovery:
  - Conceptual questions with varied wording (e.g., “authz boundaries”, “rate limit policy”).
  - Weak or unknown tags/structure; need “nearby” material.
  - First‑pass exploration—then verify via SQL + provenance.
- Hybrid pattern (best of both):
  - Start with SQL prefilter (type/tags/source), then semantic re‑rank via ks_search_text with the same prefilter.
  - If strict inclusion is required (e.g., under a path), keep the sourceLike filter in semantic search.

Operational Loop
1) Clarify Scope (minimize ambiguity)
- Identify target domain/layer/kind and any key entities or files.
- Run a focused SELECT to see what exists:
  - ks_query → filter by type + tags + source path.
  - If the set is empty or too small, add a broader prefilter then widen.
- Check for existing atoms before insertion to prevent duplicates.

2) Enrich Context (semantic first, then verify)
- ks_search_text with prefilter { type, tags, sourceLike } to find candidates.
- Parse results, fetch atoms by id (via ks_query) to read provenance and text_or_payload.
- If text_or_payload is low quality, add an Insight with better summary and evidence links.

3) Clarify Assumptions (never guess)
- When making a claim that is not directly supported:
  - Create an Insight with status:assumption and evidence links if partial support exists; otherwise, open a follow‑up (Decision) to gather missing evidence.
  - Prefer adding a Relation predicate=refutes for contradictions instead of a freeform note.

4) Follow‑ups (close the loop)
- If an assumption blocks progress, record a Decision describing the evidence needed and where to look (domain/layer/kind/source).
- When resolved, convert status:assumption Insight → supported Insight or Fact, and add refutes Relations if prior claims were wrong.

5) Re‑embedding Hygiene
- Re‑embed atoms whose text_or_payload changed meaningfully.
- Use ks_reembed_atom for single updates; ks_reembed_all with filters for large edits (e.g., domain‑wide).

Query Strategy (SELECT before Search)
- Step A (precise slice): ks_query with WHERE clauses for type, tags, source LIKE. This is the fastest way to understand coverage.
- Step B (semantic expansion): ks_search_text for “nearby” material; always post‑filter by tags/type for precision.
- Step C (verification): For every claim you plan to use, ensure at least one supporting Fact/Quote/Entity with provenance.

Contradiction Handling
- Prefer explicit Relations with predicate=refutes (subject refutes object) for contradictory claims.
- Keep both sides until resolved; add Insights to explain uncertainty and Decisions to plan verification.

Stop / Ask Conditions
- If SELECT returns no rows in a narrowed scope, widen tags or use semantic search; if still empty, stop and ask for missing sources/scope.
- If semantic search returns low‑confidence candidates, stop and ask for disambiguation (which domain/layer/kind?).
- If a critical claim has no evidence, stop and ask for sources or approval to inspect code/docs in a specific path.

Performance & Safety
- Batch adds (ks_add_atoms) to reduce embedding overhead.
- Use prefilters in ks_search_text to reduce candidate set.
- Use only SELECT in ks_query (enforced); never attempt writes via SQL.

Minimal Checklists
- For every claim in output: has supporting atom id(s) with provenance?
- Are domain/layer/kind tags present and correct?
- Did we log contradictions as refutes Relations when discovered?
- Did we re‑embed after updating important summaries?

## Knowledge Base Instruction (src/prompts/rules/knowledge-base-instruction.md)
Here’s a focused guide for using the Knowledge tools effectively and consistently.

- No examples or I/O schemas included (tools list already covers that)
- Use this as your shared playbook when creating and querying knowledge

**Database Schema**
The atoms table has the following columns:
- id: unique identifier (TEXT PRIMARY KEY)
- type: atom type (TEXT NOT NULL) - Entity, Relation, Fact, Metric, Quote, Event, Insight, Decision
- text_or_payload: main content/summary (TEXT)
- source: file path or URL (TEXT)
- locator: line numbers, sections, or specific location within source (TEXT)
- timestamp: when the atom was created/observed (TEXT)
- confidence: 0-1 confidence score (REAL DEFAULT 1.0)
- origin: project/system scope (TEXT) - e.g., "coc-foreign-exchange-dis"
- target: additional scoping or categorization (TEXT)
- subject_atom_id: for Relations - the subject atom (TEXT)
- predicate: for Relations - the relationship type (TEXT)
- object_atom_id: for Relations - the object atom (TEXT)
- evidence_json: JSON array of supporting evidence atom IDs (TEXT)
- refutes_atom_id: atom ID that this atom contradicts (TEXT)
- created_at, updated_at: system timestamps (TEXT NOT NULL)

Supporting tables:
- atom_tags: separate table for tags (atom_id TEXT, tag TEXT, PRIMARY KEY(atom_id, tag))
- embeddings: vector storage (subject_id TEXT, model TEXT, dim INTEGER, vector BLOB, norm REAL, content_hash TEXT, created_at TEXT)
- tasks: task management (id, job, type, target, fingerprint, description, status, current_cursor, result_json, created_at, updated_at)
- task_notes: task annotations (id, task_id, note, created_at)

**MCP Tool Interface**
All knowledge tools are prefixed with "ks" and available via MCP:
- ks_add_atom: Add single atom with auto-embedding
- ks_add_atoms: Bulk add atoms with batch embedding
- kssearch_text: Semantic search with prefiltering
- ksquery: Read-only SQL SELECT queries
- ksreembed_atom: Regenerate embedding for specific atom
- ksreembed_all: Re-embed all atoms matching filter

Task tools (no prefix):
- create_task, get_open_tasks, get_task, complete_task, update_progress

**Tagging System**
Tags are stored in separate atom_tags table with AND logic (atoms must have ALL specified tags when filtering). Use tags parameter in ks_add_atom/ks_add_atoms to add tags automatically.

**Atom Types**
- Entity: stable, nameable things or symbols. Use for files, modules, classes, functions, endpoints, DB tables, ENV vars, concepts, standards. Prefer fully qualified names for code (e.g., src/api/user.ts:getUsers).
- Relation: edges between atoms (subject —predicate→ object). Use for structure/behavior:
  - defines, defined_in, exports, imports, calls, reads, writes, depends_on, handles_route, implements, inherits, refutes.
- Fact: verifiable claims with citation/provenance. Use for “what is true” in docs/code (e.g., “GET /users exists”).
- Metric: numeric measurement with units/time. Use for LOC, complexity, build size, response time, counts.
- Quote: short quoted text or snippet. Use for exact lines/snippets with locator; keep it brief.
- Event: time-stamped occurrence. Use for releases/commits/changes relevant to knowledge.
- Insight: derived interpretation or synthesis. Use for observations not directly present but supported by evidence (link supporting atoms via evidence IDs).
- Decision: recommendation or action with rationale. Use for guidance with links to supporting evidence.

**When To Use Which**
- Code knowledge:
  - Entities for symbols/files; Relations for structure (defines/imports/calls); Facts for routes/config; Metrics for code stats; Quotes for key snippets; Insights for architecture findings; Decisions for refactors.
- Product/docs knowledge:
  - Entities for concepts/standards; Facts for requirements; Quotes for authoritative lines; Events for release notes; Insights/Decisions for synthesized guidance.
- Contradictions:
  - Prefer Relation predicate=refutes (subject refutes object). Avoid storing contradictions only as notes; make them queryable.

**Provenance & Text**
- Provenance: always set source (path/URL) and locator (line span/section) where possible.
- Text quality: text_or_payload should be a concise, self-contained summary (what it is and why it matters). Better summaries → better embeddings.
- Origin/Target: use origin and target fields for scoping atoms to specific contexts or systems.
- Refutation: use refutes_atom_id field for direct contradictions, or Relation predicate=refutes for structural refutations.

**Standard Tags**
- domain: domain:payments, domain:users, domain:auth
- layer: layer:api, layer:service, layer:db, layer:ui, layer:infra
- lang: lang:ts, lang:js, lang:py, lang:go, lang:md
- kind: kind:file, kind:module, kind:class, kind:function, kind:endpoint, kind:env, kind:config, kind:doc
- cat: cat:coding-standard, cat:security-policy, cat:runbook, cat:design
- framework/tooling: framework:express, framework:django, build:vite, build:webpack
- status: status:generated, status:deprecated, status:assumption (for weak insights pending evidence)
- source type: src:code, src:doc, src:web, src:api
- scope (optional helpers): scope:repo:<name>, scope:service:<name>
- note: tags use AND logic (atoms must have ALL specified tags when filtering); tags are flat strings; prefer stable, low-cardinality labels for consistent filtering

**Relation Predicates (Recommended Set)**
- Structure: defines, defined_in, exports, imports
- Behavior: calls, reads, writes, queries, handles_route
- Types/contracts: implements, inherits, returns_type, param_type, throws
- Infra/config: uses_env, reads_secret, feature_flag
- Dependency: depends_on
- Evidence/logic: supports, refutes (use Relation for refutes; use evidence links for supports on Insight/Decision)

**Consistency Rules**
- Always include tags that answer “where does this belong?” (domain, layer) and “what is this?” (kind).
- Prefer Entities + Relations for structure; Facts for claims; Insights/Decisions for interpretation/action.
- For ambiguous cases, store as Fact with clear text + tags; upgrade to Insight/Decision only when adding reasoning or recommendation.
- Keep Quotes short with precise locators; long content should be summarized in Entity/Fact and chunked elsewhere if needed.

**Retrieval Guidance**
- Broad discovery: use ks_search_text with prefilter (type/tags/sourceLike/origin/target) to constrain the space; semantic first, then verify via source/locator.
- Precise slicing: use ks_query with tags/type/source filters for exact sets (e.g., all Entities in domain:payments). Only SELECT statements allowed.
- All knowledge tools are prefixed with ks_ (ks_add_atom, ks_search_text, ks_query, ks_reembed_atom, ks_reembed_all).
- Keep tagging disciplined; consistent tags make both semantic and SQL far more effective.

**Re‑Embedding Guidance**
- Auto-embedding is enabled by default when adding atoms.
- Re-embed when text_or_payload changes or tags significantly alter meaning.
- For localized changes, use ks_reembed_atom; for wide changes (e.g., domain-wide edits), use ks_reembed_all with filters.
- Content hashing prevents unnecessary re-embedding of unchanged text.
- Strive for stable summaries to minimize churn; prefer updating a Fact/Entity’s text_or_payload only when meaning changes.

**Deduplication Protocol**
- Before adding atoms, query existing atoms by source + locator or canonical name to avoid duplicates.
- For Entities: check by canonical name and aliases; update existing rather than create new.
- For Facts/Relations: verify by subject + predicate + object combination.
- For source-based atoms: query by source path + locator range before insertion.
- Use ks_query with precise filters (source LIKE, tags, type) to check existence efficiently.

## Complete Task Framework (src/prompts/rules/task-framework.md)

# Complete Task Framework

Single-day jobs using MCP tools: `create_job`, `create_task`, `get_open_tasks`, `get_task`, `complete_task`, `update_progress` + Knowledge Repo.

## Job Management Protocol

**Job Lifecycle:**
1. `create_job` with unique ID: `JOB:<purpose>@<scope>@<date>`
2. `get_job` to verify job exists before task operations
3. `update_job` to track overall job status and progress
4. `list_jobs` to discover existing jobs by status

**Job Status Values**: `PENDING`, `RUNNING`, `PAUSED`, `SUCCEEDED`, `FAILED`, `CANCELLED`

**Job Creation Template:**
```
ID: JOB:<purpose>@<scope>@<date>
TITLE: <descriptive title>
INSTRUCTIONS: <job requirements and success criteria>
STATUS: PENDING
```

## Execution Loop
1. `get_job` to verify job exists and status
2. `get_open_tasks` for JOB → if none, create Bootstrap only
3. Pick ONE by priority: **Repair > Bootstrap > Atomize > Synthesize > QA > Publish**
4. `get_task` → execute with progress tracking → `complete_task`
5. `update_job` status when job phase changes (Bootstrap→Atomize→Synthesize→QA→Publish)
6. Repeat until job done

**Rules**: 
- Verify job exists before any task operations
- Complete current task entirely before checking for others
- Update job status at major phase transitions
- Bootstrap creates first seeding batch within context limits
- When no tasks available: verify coverage and seed next batch if needed
- Subsequent agents find appropriate tasks or trigger next seeding

## Task Naming & Deduplication
- **JOB**: `JOB:<purpose>@<scope>@<date>` (e.g., `JOB:code-analysis@coc-fx@2025-01-15`)
- **Task**: `[JOB:...] [TYPE:Bootstrap] [TARGET:scope] [FP:hash]`
- **Check duplicates**: Always `get_open_tasks` before `create_task`
- **Job verification**: Always `get_job` to ensure job exists before creating tasks

## Task Seeding Protocol

**Incremental Seeding Strategy:**
- Bootstrap creates first seeding batch within context limits
- When no tasks available: verify coverage against Bootstrap result
- If incomplete coverage: create next seeding batch
- If complete coverage: create final pipeline (Synthesize → QA → Publish)

**Seeding Task Types:**
1. **Seed-Atomize**: Creates multiple Atomize tasks (5-10 per batch)
2. **Seed-Pipeline**: Creates Synthesize + QA + Publish when Atomize complete

**Coverage Verification Protocol:**
```
When get_open_tasks returns empty:
1. Query completed Atomize tasks vs Bootstrap inventory
2. If coverage < 100%: create Seed-Atomize for remaining batches
3. If coverage = 100%: create Seed-Pipeline for final tasks
```

**Benefits:**
- Respects context size limits
- Ensures complete coverage verification
- Enables parallel execution within batches
- Prevents over-seeding and under-seeding

## Progress Tracking Protocol

**Every task step MUST:**
1. `update_progress` with status before starting step
2. Execute step using appropriate MCP tools
3. `update_progress` with results after step completion
4. Store intermediate results in knowledge repo for traceability

**Progress status values**: `starting`, `in_progress`, `completed`, `blocked`, `failed`

## Task Self-Sufficiency Requirements

Every task MUST contain complete context for independent execution:

### Task Description Template (5 parts)
```
OUTCOME: Clear deliverable tied to original JOB purpose
INPUTS: Explicit resources + Bootstrap reference + related atoms
CONTEXT: Why this task exists, what to focus on, success criteria  
STEPS: 3-5 actionable steps with MCP tool usage and progress tracking
AC: Testable completion conditions with coverage metrics
```

## Context Assembly Protocol

**Before executing any task, use available MCP tools to gather context:**

1. **Bootstrap Context**: `ksquery` SELECT result_json FROM tasks WHERE type='Bootstrap' AND job='{current_job}'
2. **Spine Atoms**: `ksquery` SELECT * FROM atoms WHERE tags LIKE '%job:{current_job}%' AND type IN ('Entity','Fact') 
3. **Related Work**: `kssearch_text` with prefilter {origin: job_id, tags: [batch_id]} for previous batch atoms
4. **Source Verification**: Use any available MCP tools (filesystem, repository, API, database, etc.) to validate unit accessibility and gather source content
5. **Context Prioritization**: Primary Sources > Verified Atoms > Existing Views (per Zero-Hallucination Protocol)

**MCP Tool Selection**: Use whatever MCP tools and servers are available in the current environment - filesystem tools, repository tools, API tools, database tools, documentation tools, etc. Adapt the context assembly to available capabilities.

**Context size management (80k tokens):**
- Bootstrap result_json: always include (essential)
- Spine atoms: always include (direction) 
- Related atoms: filter by semantic relevance to current focus
- Source files: include only current batch units

## Task Types & Dependencies

### Bootstrap (no deps)
```
OUTCOME: Complete unit enumeration + ALL task seeding for [original JOB purpose]
INPUTS: Project root, inclusion criteria, original requirements
CONTEXT: Establish foundation for comprehensive [domain] analysis covering [specific aspects]
STEPS:
1. update_progress(status='starting', note='Creating Spine questions from requirements')
   → Create questions addressing original requirements (quantity based on scope complexity)
   → update_progress(status='completed', note='Created N questions: [list]')
2. update_progress(status='starting', note='Executing systematic discovery')
   → Execute discovery using available MCP tools (filesystem, repository, API, database tools, etc.) for comprehensive enumeration
   → update_progress(status='completed', note='Discovered X units across Y categories')
3. update_progress(status='starting', note='Categorizing units by focus areas')
   → Enumerate ALL units with categorization by domain/layer/functionality
   → update_progress(status='completed', note='Categorized into Z focus areas')
4. update_progress(status='starting', note='Designing batch strategy')
   → Design batch strategy ensuring 100% coverage within token limits
   → update_progress(status='completed', note='Created B batches of 5-10 units each')
5. update_progress(status='starting', note='Storing seeding plan and creating first batch')
   → Store complete seeding plan in result_json + create Spine atoms with ks_add_atoms
   → Create first Seed-Atomize task for initial batches within context limits
   → update_progress(status='completed', note='First seeding batch created, remaining batches tracked in Bootstrap result')
AC: All requirements mapped to questions, complete unit inventory, seeding plan covers 100% scope, Spine atoms created, first seeding batch created
```

### Atomize (needs Bootstrap complete)
```
OUTCOME: Extract atoms from [focus_area] units supporting Bootstrap questions
INPUTS: 
- Unit list: [file1.java, file2.java, file3.java, file4.java, file5.java]
- Bootstrap task: [task_id] 
- Focus: [specific focus area from Bootstrap]
CONTEXT: This batch addresses [focus_area] to answer Bootstrap questions. Look for [expected patterns/entities]. Success = atoms supporting questions with full provenance per Zero-Hallucination Protocol.
STEPS:
1. update_progress(status='starting', note='Assembling context per Context Assembly Protocol')
   → Execute Context Assembly Protocol using available MCP tools (ksquery, kssearch_text, filesystem, repository, API tools, etc.)
   → update_progress(status='completed', note='Context assembled: Bootstrap + N Spine atoms + M related atoms')
2. update_progress(status='starting', note='Processing unit batch')
   → Read units using available MCP tools with error handling, focus on [focus_area] patterns
   → update_progress(status='in_progress', note='Processed X/Y units')
3. update_progress(status='starting', note='Extracting atoms with provenance')
   → Extract atoms following Knowledge Instruction guidelines (Entity/Relation/Fact/Quote/Insight/Decision)
   → Ensure every atom has source + locator per Zero-Hallucination Protocol
   → update_progress(status='completed', note='Extracted Z atoms with full provenance')
4. update_progress(status='starting', note='Linking to Spine questions')
   → Link atoms to relevant Bootstrap questions via evidence_json
   → Use ks_add_atoms for batch insertion with proper tags
   → update_progress(status='completed', note='Atoms linked to questions and stored')
5. update_progress(status='starting', note='Verifying coverage')
   → Verify coverage against Bootstrap expectations using ksquery
   → update_progress(status='completed', note='Coverage verified: X/Y units processed')
AC: All units processed, atoms linked to Spine questions, focus area coverage documented, no unsupported claims
```

### Seed-Atomize (needs Bootstrap complete)
```
OUTCOME: Create next batch of Atomize tasks within context limits
INPUTS: Bootstrap result_json, completed task coverage
CONTEXT: Verify coverage and seed remaining Atomize tasks for uncovered batches
STEPS:
1. update_progress(status='starting', note='Verifying current coverage')
   → Query completed Atomize tasks vs Bootstrap inventory using ksquery
   → update_progress(status='completed', note='Coverage: X/Y batches completed')
2. update_progress(status='starting', note='Creating remaining Atomize tasks')
   → Create Atomize tasks for uncovered batches within context limits
   → If remaining batches exceed limits, create next Seed-Atomize task
   → update_progress(status='completed', note='Created Z Atomize tasks + next seeding if needed')
AC: All feasible Atomize tasks created, next seeding queued if needed
```

### Seed-Pipeline (needs all Atomize complete)
```
OUTCOME: Create final pipeline tasks (Synthesize + QA + Publish)
INPUTS: Bootstrap result_json, complete Atomize coverage
CONTEXT: All Atomize tasks complete, create final processing pipeline
STEPS:
1. update_progress(status='starting', note='Verifying Atomize completion')
   → Confirm 100% Atomize coverage using ksquery
   → update_progress(status='completed', note='All Atomize tasks verified complete')
2. update_progress(status='starting', note='Creating pipeline tasks')
   → Create Synthesize task using create_task
   → Create QA task using create_task
   → Create Publish task using create_task
   → update_progress(status='completed', note='Pipeline tasks created: Synthesize + QA + Publish')
AC: Final pipeline tasks created and ready for execution
```

## Knowledge Repo Integration (per Knowledge Instruction)

### Required Atom Fields
- `type`, `text_or_payload`, `source`, `locator`, `confidence`, `tags[]`
- **Bootstrap traceability**: `origin` = JOB identifier
- **Question linkage**: `evidence_json` = [spine_atom_ids] for relevant questions

### Atom Types & Usage (per Knowledge Instruction)
- **Entity**: Components, classes, endpoints with canonical names + aliases
- **Relation**: Dependencies, calls, implements (subject→predicate→object)  
- **Fact**: Verifiable claims with citations
- **Quote**: Key code snippets with exact locators
- **Insight**: Analysis linking multiple atoms with evidence_json
- **Decision**: Recommendations with rationale + evidence_json

### Tags for Traceability (per Knowledge Instruction)
- `job:[job_id]`, `batch:[batch_id]`, `focus:[area]`, `question:[qid]`
- Standard tags: `domain:*`, `layer:*`, `kind:*`, `lang:*`

## Zero-Hallucination Protocol Compliance

**Every task execution MUST:**
1. **Cite-on-claim**: Every statement traces to atoms with provenance
2. **No fabrication**: Use ksquery/kssearch_text to verify before claiming
3. **Smallest sufficient scope**: Prefer precise ksquery before broad kssearch_text
4. **Update the record**: Add atoms when clarification resolves unknowns

**Query Strategy:**
- Step A: `ksquery` with WHERE clauses for type, tags, source
- Step B: `kssearch_text` with prefilter for semantic expansion  
- Step C: Verify every claim has supporting atom with provenance

## Quality Assurance

### Coverage Verification
- **Unit coverage**: processed_units / Bootstrap.total_units = 100%
- **Question coverage**: Each Spine question has supporting atoms via ksquery
- **Focus coverage**: Each Bootstrap focus area has representative atoms

### Cross-Task Validation
- Atomize tasks reference Bootstrap via ksquery
- Synthesize verifies against all Spine questions using kssearch_text
- QA checks traceability: Requirements → Questions → Atoms → Claims

## Error Handling & Recovery
- **Job not found**: `create_job` if missing, then proceed with Bootstrap
- **Job status conflicts**: Check `get_job` status before task operations
- **Missing Bootstrap context**: `update_progress(status='blocked')`, require Bootstrap completion
- **Inaccessible units**: Document via ks_add_atom, update Bootstrap inventory
- **Context overflow**: Prioritize Bootstrap + Spine, defer related atoms
- **Broken traceability**: Create Repair task, `update_progress` with issue details
- **Job failure**: `update_job(status='FAILED')` with failure reason

## Critical Success Factors
1. **Bootstrap completeness**: Every requirement mapped to discoverable units
2. **Task self-sufficiency**: Each task executable with Context Assembly Protocol
3. **Traceability chain**: Requirements → Questions → Units → Atoms → Claims
4. **Progress transparency**: Every step tracked via update_progress
5. **Protocol compliance**: Zero-Hallucination + Knowledge Instruction adherence
6. **Cross-agent compatibility**: Any agent can execute with MCP tools + context assembly

## Entity Relationship Diagram (src/prompts/rules/erd.md)

# Entity Relationship Diagram

## Core Tables

### jobs
- **id** (TEXT, PK) - Job identifier
- **title** (TEXT) - Job title
- **instructions** (TEXT) - Job instructions
- **params_json** (TEXT) - Job parameters as JSON
- **status** (TEXT) - PENDING|RUNNING|PAUSED|SUCCEEDED|FAILED|CANCELLED
- **created_at** (TEXT)
- **updated_at** (TEXT)

### tasks
- **id** (TEXT, PK) - Task identifier
- **job** (TEXT, FK → jobs.id) - Parent job
- **type** (TEXT) - Bootstrap|Atomize|Analyze|Synthesize|QA|Publish|Repair
- **target** (TEXT) - Task target scope
- **fingerprint** (TEXT) - Deduplication key
- **description** (TEXT) - Task description
- **status** (TEXT) - PENDING|RUNNING|BLOCKED|SUCCEEDED
- **current_cursor** (TEXT) - Resume position
- **result_json** (TEXT) - Task results as JSON
- **created_at** (TEXT)
- **updated_at** (TEXT)

### task_notes
- **id** (TEXT, PK) - Note identifier
- **task_id** (TEXT, FK → tasks.id) - Parent task
- **note** (TEXT) - Note content
- **created_at** (TEXT)

### atoms
- **id** (TEXT, PK) - Atom identifier
- **type** (TEXT) - Entity|Relation|Fact|Metric|Quote|Event|Insight|Decision
- **text_or_payload** (TEXT) - Main content
- **source** (TEXT) - File path or URL
- **locator** (TEXT) - Line numbers or location
- **timestamp** (TEXT) - When observed
- **confidence** (REAL) - 0-1 confidence score
- **origin** (TEXT) - Project/system scope
- **target** (TEXT) - Additional categorization
- **subject_atom_id** (TEXT, FK → atoms.id) - For Relations
- **predicate** (TEXT) - Relationship type
- **object_atom_id** (TEXT, FK → atoms.id) - For Relations
- **evidence_json** (TEXT) - Supporting evidence atom IDs
- **refutes_atom_id** (TEXT, FK → atoms.id) - Contradicted atom
- **created_at** (TEXT)
- **updated_at** (TEXT)

### atom_tags
- **atom_id** (TEXT, FK → atoms.id) - Tagged atom
- **tag** (TEXT) - Tag value
- **PRIMARY KEY** (atom_id, tag)

### embeddings
- **subject_id** (TEXT, FK → atoms.id) - Embedded atom
- **model** (TEXT) - Embedding model
- **dim** (INTEGER) - Vector dimensions
- **vector** (BLOB) - Vector data
- **norm** (REAL) - Vector norm
- **content_hash** (TEXT) - Content hash for dedup
- **created_at** (TEXT)

## Relationships

```
jobs 1:N tasks
tasks 1:N task_notes
atoms 1:N atom_tags
atoms 1:N embeddings
atoms N:1 atoms (subject_atom_id)
atoms N:1 atoms (object_atom_id)
atoms N:1 atoms (refutes_atom_id)
```
