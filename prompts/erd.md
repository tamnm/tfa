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