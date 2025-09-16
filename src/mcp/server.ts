#!/usr/bin/env node
// MCP stdio server skeleton for Lean Agent Task Framework
// Uses @modelcontextprotocol/sdk

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// Use SDK's Node stdio transport (path per v1.18+)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Database } from "../db/database.js";
import TaskService from "../services/taskService.js";
import KnowledgeService from "../services/knowledgeService.js";
import { HashEmbedder, TransformersEmbedder } from "../embedding/embeddings.js";
import { initializeRuleDirectory } from "../prompts/ruleInitializer.js";

const NAME = "tfa-mcp";
const VERSION = "0.1.0";

async function start() {
  const mcp = new McpServer({ name: NAME, version: VERSION });

  // Initialize services
  const db = new Database({dbDir: process.env.TFA_DATA_STORE_PATH});
  await db.init();
  const taskSvc = new TaskService(db);
  const embedder = await selectEmbedderFromEnv();
  const ks = new KnowledgeService(db, embedder, { autoEmbed: true });

  await initializeRuleDirectory();

  // Four task-list operations (typed stubs for now)
  mcp.registerTool(
    "create_task",
    {
      description: "Create a task. Returns the created task.",
      inputSchema: {
        job: z.string(),
        type: z.string(),
        target: z.string().optional(),
        fingerprint: z.string().optional(),
        description: z.string().optional(),
        dedupe: z.boolean().optional()
      }
    },
    async (args) => {
      const t = taskSvc.createTask(args as any);
      return { content: [{ type: 'text', text: JSON.stringify(t) }] };
    }
  );

  mcp.registerTool(
    "get_open_tasks",
    {
      description: "List open tasks for a JOB (pending/running).",
      inputSchema: { job: z.string().optional() }
    },
    async ({ job }) => {
      const items = taskSvc.listOpen(job);
      return { content: [{ type: 'text', text: JSON.stringify(items) }] };
    }
  );

  mcp.registerTool(
    "get_task",
    {
      description: "Get a specific task by id or the next open task.",
      inputSchema: { id: z.string().optional(), job: z.string().optional() }
    },
    async ({ id, job }) => {
      const t = taskSvc.getTask({ id, job });
      return { content: [{ type: 'text', text: t ? JSON.stringify(t) : 'no task' }] };
    }
  );

  mcp.registerTool(
    "complete_task",
    {
      description: "Mark a task as completed.",
      inputSchema: { id: z.string(), result: z.unknown().optional() }
    },
    async ({ id, result }) => {
      const t = taskSvc.completeTask(id, result);
      return { content: [{ type: 'text', text: JSON.stringify(t) }] };
    }
  );

  // Update task progress (status/cursor/note)
  mcp.registerTool(
    "update_progress",
    {
      description: "Update task status/cursor/note atomically.",
      inputSchema: { id: z.string(), status: z.string().optional(), cursor: z.unknown().optional(), note: z.string().optional() }
    },
    async ({ id, status, cursor, note }) => {
      const t = taskSvc.updateProgress(id, { status, cursor, note });
      return { content: [{ type: 'text', text: JSON.stringify(t) }] };
    }
  );

  // Job management tools
  mcp.registerTool(
    "create_job",
    {
      description: "Create a new job. Returns the created job.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        instructions: z.string().optional(),
        params: z.unknown().optional(),
        status: z.string().optional()
      }
    },
    async (args) => {
      const job = taskSvc.createJob(args as any);
      return { content: [{ type: 'text', text: JSON.stringify(job) }] };
    }
  );

  mcp.registerTool(
    "get_job",
    {
      description: "Get a job by ID.",
      inputSchema: { id: z.string() }
    },
    async ({ id }) => {
      const job = taskSvc.getJob(id);
      return { content: [{ type: 'text', text: job ? JSON.stringify(job) : 'no job' }] };
    }
  );

  mcp.registerTool(
    "update_job",
    {
      description: "Update an existing job.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        instructions: z.string().optional(),
        params: z.unknown().optional(),
        status: z.string().optional()
      }
    },
    async ({ id, ...updates }) => {
      const job = taskSvc.updateJob(id, updates);
      return { content: [{ type: 'text', text: JSON.stringify(job) }] };
    }
  );

  mcp.registerTool(
    "list_jobs",
    {
      description: "List jobs, optionally filtered by status.",
      inputSchema: { status: z.string().optional() }
    },
    async ({ status }) => {
      const jobs = taskSvc.listJobs(status ? { status } : undefined);
      return { content: [{ type: 'text', text: JSON.stringify(jobs) }] };
    }
  );

  // Knowledge Service tools
  mcp.registerTool(
    "ks:add_atom",
    {
      description: "Add an atom (auto-embeds by default).",
      inputSchema: {
        type: z.string(), text_or_payload: z.string().optional(), source: z.string().optional(), locator: z.string().optional(),
        timestamp: z.string().optional(), confidence: z.number().optional(), origin: z.string().optional(), target: z.string().optional(),
        subject_atom_id: z.string().optional(), predicate: z.string().optional(), object_atom_id: z.string().optional(),
        evidence_json: z.array(z.string()).optional(), refutes_atom_id: z.string().optional(), tags: z.array(z.string()).optional()
      }
    },
    async (args) => {
      try {
        const id = await ks.addAtom(args as any);
        return { content: [{ type: 'text', text: id }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: error.message, isError: true }) }], isError: true };
      }
    }
  );

  mcp.registerTool(
    "ks:add_atoms",
    {
      description: "Bulk add atoms (auto-embeds in batch).",
      inputSchema: {
        items: z.array(z.object({
          type: z.string(), text_or_payload: z.string().optional(), source: z.string().optional(), locator: z.string().optional(),
          timestamp: z.string().optional(), confidence: z.number().optional(), origin: z.string().optional(), target: z.string().optional(),
          subject_atom_id: z.string().optional(), predicate: z.string().optional(), object_atom_id: z.string().optional(),
          evidence_json: z.array(z.string()).optional(), refutes_atom_id: z.string().optional(), tags: z.array(z.string()).optional()
        }))
      }
    },
    async ({ items }) => {
      const ids = await ks.addAtoms(items as any);
      return { content: [{ type: 'text', text: JSON.stringify(ids) }] };
    }
  );

  mcp.registerTool(
    "ks:search_text",
    {
      description: "Semantic search over embedded atoms.",
      inputSchema: {
        query: z.string(), topK: z.number().optional(),
        prefilter: z.object({ type: z.string().optional(), tags: z.array(z.string()).optional(), sourceLike: z.string().optional(), origin: z.string().optional(), target: z.string().optional() }).optional()
      }
    },
    async ({ query, topK, prefilter }) => {
      try {
        const hits = await ks.searchText(query, { topK, prefilter });
        return { content: [{ type: 'text', text: JSON.stringify(hits) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: error.message, isError: true }) }], isError: true };
      }
    }
  );

  mcp.registerTool(
    "ks:query",
    {
      description: "Run a read-only SQL SELECT over knowledge tables.",
      inputSchema: { sql: z.string(), params: z.record(z.any()).optional() }
    },
    async ({ sql, params }) => {
      const trimmed = String(sql).trim().toLowerCase();
      if (!trimmed.startsWith('select')) throw new Error('Only SELECT queries are allowed');
      const rows = ks.query(sql, params);
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    }
  );

  mcp.registerTool(
    "ks:reembed_atom",
    {
      description: "Regenerate embedding for a specific atom.",
      inputSchema: { id: z.string(), text: z.string().optional() }
    },
    async ({ id, text }) => {
      const res = await ks.reembedAtom(id, text);
      return { content: [{ type: 'text', text: JSON.stringify(res) }] };
    }
  );

  mcp.registerTool(
    "ks:reembed_all",
    {
      description: "Re-embed all (optionally filtered) atoms.",
      inputSchema: { filter: z.object({ type: z.string().optional(), tags: z.array(z.string()).optional(), sourceLike: z.string().optional(), origin: z.string().optional(), target: z.string().optional() }).optional() }
    },
    async ({ filter }) => {
      const res = await ks.reembedAll(filter);
      return { content: [{ type: 'text', text: `updated: ${res.length}` }] };
    }
  );

  // Optional utility: ping tool
  // ping tool removed

  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  // Keep process alive on stdio
  setupSignalHandlers();
}

// no-op: all tools are explicitly registered above with typed schemas

function setupSignalHandlers() {
  const shutdown = () => {
    // Allow client to handle disconnect; exit cleanly
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function selectEmbedderFromEnv() {
  const modelId = process.env.TFA_EMBED_MODEL;
  const cacheDir = process.env.TFA_EMBED_CACHE;
  const quantized = parseBoolEnv(process.env.TFA_EMBED_QUANTIZED, true);
  const normalize = parseBoolEnv(process.env.TFA_EMBED_NORMALIZE, true);
  
  if (modelId) {
    try {
      const embedder = new TransformersEmbedder({ modelId, cacheDir, quantized, normalize });
      // Test initialization
      await embedder.embed('test');
      console.log(`✅ Using TransformersEmbedder: ${modelId}`);
      return embedder;
    } catch (error) {
      console.warn(`⚠️  TransformersEmbedder failed (${error.message}), falling back to HashEmbedder`);
    }
  }
  
  console.log('✅ Using HashEmbedder fallback');
  return new HashEmbedder(256);
}

function parseBoolEnv(val: string | undefined, def: boolean): boolean {
  if (val == null) return def;
  const s = String(val).toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return def;
}

start().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
