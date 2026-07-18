/**
 * open-brain-mcp — Supabase Edge Function
 *
 * MCP (Model Context Protocol) server for Open Brain. Exposes four tools:
 *   search_thoughts   — semantic search via pgvector (read-only)
 *   list_thoughts     — recent thoughts (read-only)
 *   thought_stats     — total count (read-only)
 *   capture_thought   — insert a new thought (write, gated by CAPTURE_ENABLED)
 *
 * ── Embedding consistency ───────────────────────────────────────────────────
 * All embedding calls use LOCAL_LLM_BASE_URL / LOCAL_EMBEDDING_MODEL so that
 * vectors are always at EMBEDDING_DIMENSIONS. This matches the Node.js CLI
 * path (lib/context-assembler.js) and the Obsidian watcher. Mixing models
 * creates incommensurable populations that will never match in cosine search.
 * There is NO OpenRouter fallback — if the local LLM is unreachable the call
 * fails loudly rather than silently producing the wrong vector.
 *
 * ── Deployment note ─────────────────────────────────────────────────────────
 * Supabase Edge Functions run in Deno on Supabase's cloud. They cannot reach
 * http://127.0.0.1. LOCAL_LLM_BASE_URL must point to a publicly accessible
 * endpoint (e.g. a Cloudflare Tunnel, Tailscale Funnel, or ngrok URL) when
 * deployed to production. For local development with `supabase functions serve`
 * the localhost URL works fine.
 *
 * ── Required Supabase secrets ───────────────────────────────────────────────
 * supabase secrets set \
 *   LOCAL_LLM_BASE_URL=https://your-tunnel.example.com/v1 \
 *   LOCAL_EMBEDDING_MODEL=Qwen3-Embedding-4B-4bit-DWQ \
 *   LOCAL_CHAT_MODEL=your-chat-model \
 *   EMBEDDING_DIMENSIONS=2560 \
 *   MCP_ACCESS_KEY=your-secret-key \
 *   CAPTURE_ENABLED=true \
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
 *
 * Optional:
 *   LOCAL_LLM_API=bearer-token-if-your-local-server-requires-it
 *
 * ── Security model ──────────────────────────────────────────────────────────
 * Primary gate:   MCP_ACCESS_KEY (checked on every request before any DB op)
 * Rate limit:     30 req/min per key (in-memory sliding window; resets on
 *                 cold start — sufficient for a personal tool)
 * Write kill-switch: CAPTURE_ENABLED=false disables capture_thought instantly
 *                 without redeploying; flip the secret to re-enable.
 * Service role:   Required for pgvector RPC calls (match_thoughts, upsert_thought)
 *                 and for bypassing RLS. Columns are always explicitly selected.
 *                 Never SELECT *.
 * Input caps:     capture_thought: content ≤ 20 000 chars; no nested objects.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

// ---------------------------------------------------------------------------
// Config — all values come from Supabase secrets; no hardcoded credentials
// ---------------------------------------------------------------------------

const SUPABASE_URL             = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY           = Deno.env.get("MCP_ACCESS_KEY")!;

const LOCAL_LLM_BASE_URL       = Deno.env.get("LOCAL_LLM_BASE_URL") ?? "";
const LOCAL_EMBEDDING_MODEL    = Deno.env.get("LOCAL_EMBEDDING_MODEL") ?? "";
const LOCAL_CHAT_MODEL         = Deno.env.get("LOCAL_CHAT_MODEL") ?? "";
const LOCAL_LLM_API            = Deno.env.get("LOCAL_LLM_API") ?? "";
const EMBEDDING_DIMENSIONS     = parseInt(Deno.env.get("EMBEDDING_DIMENSIONS") ?? "2560", 10);

// Write kill-switch: set to "false" in Supabase secrets to disable capture_thought
const CAPTURE_ENABLED = (Deno.env.get("CAPTURE_ENABLED") ?? "true").toLowerCase() !== "false";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MCP_ACCESS_KEY) {
  throw new Error(
    "[open-brain-mcp] SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and MCP_ACCESS_KEY must be set as Supabase secrets."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Rate limiter — sliding window, in-memory per cold start
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS  = 60_000; // 1 minute
const RATE_MAX_REQ    = 30;     // 30 requests per window per key

const _rateStore = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (_rateStore.get(key) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_REQ) return true;
  hits.push(now);
  _rateStore.set(key, hits);
  return false;
}

// ---------------------------------------------------------------------------
// Local LLM helpers — fail loudly, no cloud fallback
// ---------------------------------------------------------------------------

function llmHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (LOCAL_LLM_API) h["Authorization"] = `Bearer ${LOCAL_LLM_API}`;
  return h;
}

function assertLlmConfig(need: "embed" | "chat") {
  if (!LOCAL_LLM_BASE_URL) {
    throw new Error(
      "[open-brain-mcp] LOCAL_LLM_BASE_URL is not set. " +
      "Set it as a Supabase secret pointing to a publicly accessible LLM endpoint."
    );
  }
  if (need === "embed" && !LOCAL_EMBEDDING_MODEL) {
    throw new Error("[open-brain-mcp] LOCAL_EMBEDDING_MODEL is not set as a Supabase secret.");
  }
  if (need === "chat" && !LOCAL_CHAT_MODEL) {
    throw new Error("[open-brain-mcp] LOCAL_CHAT_MODEL is not set as a Supabase secret.");
  }
}

/**
 * Generate a single embedding vector via the local LLM.
 * Validates that the returned dimension matches EMBEDDING_DIMENSIONS so a
 * mis-configured model is caught immediately rather than corrupting the corpus.
 */
async function generateEmbedding(text: string): Promise<number[]> {
  assertLlmConfig("embed");
  const base = LOCAL_LLM_BASE_URL.replace(/\/+$/, "");
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: llmHeaders(),
    body: JSON.stringify({ model: LOCAL_EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) {
    throw new Error(
      `[open-brain-mcp] Embedding request failed: HTTP ${res.status} ${res.statusText}`
    );
  }
  const data = await res.json();
  const embedding: number[] = data.data[0].embedding;

  // Dimension guard — surfaces model/config mismatch before bad vectors enter the DB
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `[open-brain-mcp] Dimension mismatch: model '${LOCAL_EMBEDDING_MODEL}' returned ` +
      `${embedding.length} dims but EMBEDDING_DIMENSIONS=${EMBEDDING_DIMENSIONS}. ` +
      `Update the EMBEDDING_DIMENSIONS secret or switch to a compatible model.`
    );
  }
  return embedding;
}

/**
 * Extract structured metadata from a thought via the local chat LLM.
 * Returns a safe fallback on failure; the call is non-critical for capture.
 */
async function extractMetadata(text: string): Promise<{
  type: string;
  category: string;
  people: string[];
  topics: string[];
  action_items: string[];
}> {
  const fallback = { type: "note", category: "uncategorized", people: [], topics: [], action_items: [] };

  if (!LOCAL_LLM_BASE_URL || !LOCAL_CHAT_MODEL) {
    console.warn("[open-brain-mcp] LOCAL_CHAT_MODEL not set — using metadata fallback.");
    return fallback;
  }

  try {
    const base = LOCAL_LLM_BASE_URL.replace(/\/+$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: llmHeaders(),
      body: JSON.stringify({
        model: LOCAL_CHAT_MODEL,
        messages: [
          {
            role: "system",
            content: `You extract metadata from thoughts/notes. Return ONLY valid JSON, no markdown or backticks.
{
  "type": one of "decision", "person_note", "insight", "meeting_note", "idea", "task", "reference", "note",
  "category": short topic area (e.g. "career", "product", "health", "finance", "relationships"),
  "people": array of names mentioned (empty array if none),
  "topics": array of 1-3 key topics,
  "action_items": array of any action items or next steps (empty array if none)
}`,
          },
          { role: "user", content: text.slice(0, 2_000) }, // cap LLM input for metadata
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const raw = data.choices[0].message.content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[open-brain-mcp] Metadata extraction failed (${err}). Using fallback.`);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatThought(t: {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  similarity?: number;
}): string {
  const lines = [t.content];
  const meta: string[] = [];
  const m = t.metadata ?? {};
  if (m.type)              meta.push(`Type: ${m.type}`);
  if (m.category)          meta.push(`Category: ${m.category}`);
  if (m.source)            meta.push(`Source: ${m.source}`);
  if (Array.isArray(m.people) && (m.people as string[]).length)
    meta.push(`People: ${(m.people as string[]).join(", ")}`);
  if (Array.isArray(m.topics) && (m.topics as string[]).length)
    meta.push(`Topics: ${(m.topics as string[]).join(", ")}`);
  if (Array.isArray(m.action_items) && (m.action_items as string[]).length)
    meta.push(`Action items: ${(m.action_items as string[]).join("; ")}`);
  if (t.similarity !== undefined) meta.push(`Relevance: ${(t.similarity * 100).toFixed(0)}%`);
  meta.push(`Captured: ${new Date(t.created_at).toLocaleDateString()}`);
  meta.push(`ID: ${t.id}`);
  if (meta.length) lines.push(`[${meta.join(" | ")}]`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const MAX_CAPTURE_CONTENT_LEN = 20_000; // chars

function validateCaptureInput(content: unknown): string {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("capture_thought: `content` must be a non-empty string.");
  }
  if (content.length > MAX_CAPTURE_CONTENT_LEN) {
    throw new Error(
      `capture_thought: content exceeds ${MAX_CAPTURE_CONTENT_LEN} character limit ` +
      `(got ${content.length}). Chunk the input before capturing.`
    );
  }
  return content.trim();
}

// ---------------------------------------------------------------------------
// MCP tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "search_thoughts",
    description: "Search your personal memories/thoughts/captures by meaning using semantic (vector) search.",
    inputSchema: {
      type: "object",
      properties: {
        query:     { type: "string",  description: "What you're looking for — natural language." },
        threshold: { type: "number",  description: "Minimum similarity 0–1. Default 0.3." },
        limit:     { type: "number",  description: "Max results. Default 10, max 25." },
      },
      required: ["query"],
    },
  },
  {
    name: "list_thoughts",
    description: "List the most recently captured thoughts.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results. Default 20, max 50." },
      },
    },
  },
  {
    name: "thought_stats",
    description: "Return an overview of Open Brain stats (total thought count).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "capture_thought",
    description: "Save a new thought to Open Brain. Generates a local embedding and deduplicates via fingerprint.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: `The thought to capture. Max ${MAX_CAPTURE_CONTENT_LEN} characters.`,
        },
      },
      required: ["content"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    // ── search_thoughts ────────────────────────────────────────────────────
    case "search_thoughts": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) return "Error: `query` must be a non-empty string.";

      const threshold = typeof args.threshold === "number" ? args.threshold : 0.3;
      const limit     = Math.min(typeof args.limit === "number" ? args.limit : 10, 25);

      const embedding = await generateEmbedding(query);

      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count:     limit,
      });
      if (error) return `Error: ${error.message}`;
      if (!data?.length) return "No matching thoughts found.";

      return (
        `Found ${data.length} thought(s):\n\n` +
        data.map((t: Parameters<typeof formatThought>[0], i: number) =>
          `${i + 1}. ${formatThought(t)}`
        ).join("\n\n")
      );
    }

    // ── list_thoughts ──────────────────────────────────────────────────────
    case "list_thoughts": {
      const limit = Math.min(typeof args.limit === "number" ? args.limit : 20, 50);

      const { data, error } = await supabase
        .from("thoughts")
        .select("id, content, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return `Error: ${error.message}`;
      if (!data?.length) return "No thoughts found.";

      return (
        `${data.length} recent thought(s):\n\n` +
        data.map((t: Parameters<typeof formatThought>[0], i: number) =>
          `${i + 1}. ${formatThought(t)}`
        ).join("\n\n")
      );
    }

    // ── thought_stats ──────────────────────────────────────────────────────
    case "thought_stats": {
      const { count, error } = await supabase
        .from("thoughts")
        .select("id", { count: "exact", head: true });

      if (error) return `Error: ${error.message}`;
      return `Total thoughts captured: ${count ?? "unknown"}`;
    }

    // ── capture_thought ────────────────────────────────────────────────────
    case "capture_thought": {
      if (!CAPTURE_ENABLED) {
        return (
          "capture_thought is disabled (CAPTURE_ENABLED=false). " +
          "Update the Supabase secret to re-enable writes."
        );
      }

      const content = validateCaptureInput(args.content); // throws on bad input

      const meta = await extractMetadata(content);

      // Use upsert_thought RPC — deduplicates via SHA-256 fingerprint, matching
      // the Node.js watcher path. Direct INSERT would bypass deduplication.
      const { data: upsertResult, error: upsertErr } = await supabase.rpc(
        "upsert_thought",
        {
          p_content: content,
          p_payload: {
            metadata: {
              type:         meta.type,
              category:     meta.category,
              source:       "mcp",
              people:       meta.people,
              topics:       meta.topics,
              action_items: meta.action_items,
            },
          },
        }
      );
      if (upsertErr) return `Error saving thought: ${upsertErr.message}`;

      const thoughtId: string = upsertResult.id;

      // Generate embedding and store it — same two-step pattern as the watcher
      const embedding = await generateEmbedding(content);
      const { error: embedErr } = await supabase
        .from("thoughts")
        .update({ embedding })
        .eq("id", thoughtId);

      if (embedErr) {
        console.warn(`[open-brain-mcp] Failed to store embedding for ${thoughtId}: ${embedErr.message}`);
        return (
          `Thought saved (ID: ${thoughtId}) but embedding storage failed: ${embedErr.message}. ` +
          "The thought is searchable by text but not by semantic similarity."
        );
      }

      return `Captured thought successfully. ID: ${thoughtId}`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ---------------------------------------------------------------------------
// MCP protocol dispatcher
// ---------------------------------------------------------------------------

async function handleMcpRequest(body: {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}): Promise<Record<string, unknown> | null> {
  const { method, id, params } = body;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "open-brain", version: "3.0.0" },
        },
      };

    case "notifications/initialized":
      return null;

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

    case "tools/call": {
      const { name, arguments: args } = (params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      if (!name) {
        return {
          jsonrpc: "2.0", id,
          error: { code: -32602, message: "Missing tool name" },
        };
      }
      try {
        const text = await handleTool(name, args ?? {});
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: `Error: ${msg}` }], isError: true },
        };
      }
    }

    case "ping":
      return { jsonrpc: "2.0", id, result: {} };

    default:
      return {
        jsonrpc: "2.0", id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// ---------------------------------------------------------------------------
// HTTP entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // ── Authentication ────────────────────────────────────────────────────────
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? req.headers.get("x-brain-key") ?? "";

  if (!key || key !== MCP_ACCESS_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  if (isRateLimited(key)) {
    return new Response(
      JSON.stringify({ error: `Rate limit exceeded: max ${RATE_MAX_REQ} requests per minute.` }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── SSE endpoint (GET) — client discovery ─────────────────────────────────
  if (req.method === "GET") {
    const sessionId = crypto.randomUUID();
    const postUrl   = `${url.pathname}?key=${encodeURIComponent(MCP_ACCESS_KEY)}&sessionId=${sessionId}`;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(`event: endpoint\ndata: ${postUrl}\n\n`)
        );
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }

  // ── MCP JSON-RPC (POST) ───────────────────────────────────────────────────
  if (req.method === "POST") {
    let body: Parameters<typeof handleMcpRequest>[0];
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await handleMcpRequest(body);
    if (result === null) return new Response(null, { status: 204 });

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
});
