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
- Use SQL (ks:query) when you know the shape (precision, speed):
  - Exact path/scope: source LIKE 'src/api/%', or scope tags (scope:repo:…, scope:service:…).
  - Known categories: cat:coding-standard, cat:security-policy, cat:runbook.
  - Structural slices: type='Entity' with tags (domain, layer, kind); Relations by predicate='calls', 'imports', etc.
  - Audits/coverage: counts, specific lists, or joins (e.g., “all endpoints without docs”).
- Use semantic (ks:search_text) when you need recall/discovery:
  - Conceptual questions with varied wording (e.g., “authz boundaries”, “rate limit policy”).
  - Weak or unknown tags/structure; need “nearby” material.
  - First‑pass exploration—then verify via SQL + provenance.
- Hybrid pattern (best of both):
  - Start with SQL prefilter (type/tags/source), then semantic re‑rank via ks:search_text with the same prefilter.
  - If strict inclusion is required (e.g., under a path), keep the sourceLike filter in semantic search.

Operational Loop
1) Clarify Scope (minimize ambiguity)
- Identify target domain/layer/kind and any key entities or files.
- Run a focused SELECT to see what exists:
  - ks:query → filter by type + tags + source path.
  - If the set is empty or too small, add a broader prefilter then widen.

2) Enrich Context (semantic first, then verify)
- ks:search_text with prefilter { type, tags, sourceLike } to find candidates.
- Parse results, fetch atoms by id (via ks:query) to read provenance and text_or_payload.
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
- Use ks:reembed_atom for single updates; ks:reembed_all with filters for large edits (e.g., domain‑wide).

Query Strategy (SELECT before Search)
- Step A (precise slice): ks:query with WHERE clauses for type, tags, source LIKE. This is the fastest way to understand coverage.
- Step B (semantic expansion): ks:search_text for “nearby” material; always post‑filter by tags/type for precision.
- Step C (verification): For every claim you plan to use, ensure at least one supporting Fact/Quote/Entity with provenance.

Contradiction Handling
- Prefer explicit Relations with predicate=refutes (subject refutes object) for contradictory claims.
- Keep both sides until resolved; add Insights to explain uncertainty and Decisions to plan verification.

Stop / Ask Conditions
- If SELECT returns no rows in a narrowed scope, widen tags or use semantic search; if still empty, stop and ask for missing sources/scope.
- If semantic search returns low‑confidence candidates, stop and ask for disambiguation (which domain/layer/kind?).
- If a critical claim has no evidence, stop and ask for sources or approval to inspect code/docs in a specific path.

Performance & Safety
- Batch adds (ks:add_atoms) to reduce embedding overhead.
- Use prefilters in ks:search_text to reduce candidate set.
- Use only SELECT in ks:query (enforced); never attempt writes via SQL.

Minimal Checklists
- For every claim in output: has supporting atom id(s) with provenance?
- Are domain/layer/kind tags present and correct?
- Did we log contradictions as refutes Relations when discovered?
- Did we re‑embed after updating important summaries?
