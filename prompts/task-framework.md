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
   → Store complete seeding plan in result_json + create Spine atoms with ksadd_atoms
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
   → Use ksadd_atoms for batch insertion with proper tags
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
- **Inaccessible units**: Document via ksadd_atom, update Bootstrap inventory
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