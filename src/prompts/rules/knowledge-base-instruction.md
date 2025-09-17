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
- ksadd_atom: Add single atom with auto-embedding
- ksadd_atoms: Bulk add atoms with batch embedding
- kssearch_text: Semantic search with prefiltering
- ksquery: Read-only SQL SELECT queries
- ksreembed_atom: Regenerate embedding for specific atom
- ksreembed_all: Re-embed all atoms matching filter

Task tools (no prefix):
- create_task, get_open_tasks, get_task, complete_task, update_progress

**Tagging System**
Tags are stored in separate atom_tags table with AND logic (atoms must have ALL specified tags when filtering). Use tags parameter in ksadd_atom/ksadd_atoms to add tags automatically.

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