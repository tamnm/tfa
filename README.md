# TFA MCP Server

Lean Agent Task Framework (TFA) MCP stdio server that exposes task and knowledge-repository tooling over the Model Context Protocol. The server boots a lightweight SQL.js-backed metadata store, manages task lifecycles, and provides embedding-aware knowledge operations for downstream agents.

## Features
- **Task orchestration**: create, list, fetch, update-progress, and complete tasks plus job management utilities (`src/mcp/server.ts`).
- **Knowledge service**: insert atoms with automatic embedding, run semantic search, and refresh embeddings via Transformers or deterministic hash fallback (`src/services/knowledgeService.ts`, `src/embedding/embeddings.ts`).
- **Rule bootstrapping**: optional prompt library initialization driven by `TFA_RULE_DIR` (`src/prompts/ruleInitializer.ts`).
- **Self-contained storage**: SQL.js database persisted to `.tfa/data/db.sqlite` by default (`src/db/database.ts`).

## Requirements
- Node.js >= 18 (`package.json`).
- npm (or another compatible package manager).

## Installation
```bash
npm install
```

## Building
Compilation outputs TypeScript sources to `dist/` and copies prompt assets:
```bash
npm run build
```

## Running the MCP server
Build artifacts first, then launch the stdio server:
```bash
npm run mcp
```
This resolves `dist/mcp/server.js` and starts the tool registry described in `src/mcp/server.ts`.

## Testing
All unit tests run through Node's built-in test runner after building:
```bash
npm run test
```
Tests cover the database layer, knowledge service operations, rule initialization, and embedding strategies (`test/*.mjs`).

## Environment Variables
- `TFA_DATA_STORE_PATH`: override path that stores `.tfa/data/db.sqlite`.
- `TFA_EMBED_MODEL`: Hugging Face model identifier for the Transformers embedder.
- `TFA_EMBED_CACHE`: cache directory for downloaded model artifacts.
- `TFA_EMBED_QUANTIZED`, `TFA_EMBED_NORMALIZE`: toggle quantization/normalization flags (`src/mcp/server.ts`).
- `TFA_RULE_DIR`: destination directory for rule/prompt copies (`src/prompts/ruleInitializer.ts`).

## Project Structure
- `src/mcp/` – MCP server entrypoint and JSON schema definitions.
- `src/services/` – Task and knowledge service abstractions over the database.
- `src/db/` – SQL.js wrapper handling schema migrations, queries, and embedding search.
- `src/embedding/` – Transformer and hash-based embedding providers.
- `src/prompts/` – Rule initializer and agent prompt documentation.
- `test/` – Node test suites for services, database, embeddings, and prompt copying.
- `scripts/` – Build helper that copies prompts into the distribution directory.

## License
MIT License © 2025 Nguyen Manh Tam (`LICENSE`).
