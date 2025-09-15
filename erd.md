```mermaid
erDiagram
  JOBS {
    TEXT id PK              %% e.g., JOB:purpose@scope@date
    TEXT title
    TEXT instructions
    TEXT params_json
    TEXT status             %% PENDING|RUNNING|PAUSED|SUCCEEDED|FAILED|CANCELLED
    TEXT created_at
    TEXT updated_at
  }

  TASKS {
    TEXT id PK
    TEXT job FK             %% -> JOBS.id
    TEXT type
    TEXT target
    TEXT fingerprint
    TEXT description
    TEXT status             %% PENDING|RUNNING|BLOCKED|SUCCEEDED
    TEXT current_cursor     %% resume token (opaque JSON/string)
    TEXT result_json        %% completion result payload
    TEXT created_at
    TEXT updated_at
  }

  TASK_NOTES {
    TEXT id PK
    TEXT task_id FK         %% -> TASKS.id
    TEXT note
    TEXT created_at
  }

  ATOMS {
    TEXT id PK
    TEXT type                 %% Fact|Entity|Relation|Metric|Quote|Event|Insight|Decision
    TEXT text_or_payload
    TEXT source               %% file path or URL
    TEXT locator              %% e.g., L10-L42
    TEXT timestamp            %% capture time
    REAL confidence
    TEXT origin               %% job/session/manual/import
    TEXT target
    TEXT subject_atom_id FK
    TEXT predicate
    TEXT object_atom_id FK
    TEXT evidence_json
    TEXT refutes_atom_id FK
    TEXT created_at
    TEXT updated_at
  }

  ATOM_TAGS {
    TEXT atom_id PK, FK
    TEXT tag PK
  }

  EMBEDDINGS {
    TEXT subject_id PK, FK
    TEXT model PK
    INTEGER dim
    BLOB vector
    REAL norm
    TEXT content_hash
    TEXT created_at
  }

  JOBS ||--o{ TASKS : has_tasks
  TASKS ||--o{ TASK_NOTES : has_notes
  ATOMS ||--o{ ATOM_TAGS : has_tags
  ATOMS ||--o{ EMBEDDINGS : has_embeddings
  ATOMS ||--o{ ATOMS : relation_edges
  ATOMS ||--o{ ATOMS : refutes
```
