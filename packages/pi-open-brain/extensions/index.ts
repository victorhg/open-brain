/**
 * pi-open-brain — pi extension
 *
 * Registers four native pi tools that call the Open Brain Supabase Edge
 * Function directly over HTTPS. No MCP protocol layer — just JSON-RPC
 * POST requests with x-brain-key header auth.
 *
 * Required env vars (add to shell profile or .env):
 *   BRAIN_MCP_URL      Full URL to the edge function
 *                      e.g. https://<ref>.supabase.co/functions/v1/open-brain-mcp
 *   BRAIN_ACCESS_KEY   The MCP access key (same value as MCP_ACCESS_KEY on the server)
 *
 * Tools registered:
 *   search_thoughts   — semantic search over the Obsidian vault
 *   capture_thought   — save a new thought (gated by CAPTURE_ENABLED on server)
 *   list_thoughts     — list recent captures
 *   thought_stats     — total thought count
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

const EMBED_TIMEOUT_MS = 30_000; // local LLM embedding call
const CALL_TIMEOUT_MS  = 45_000; // edge function HTTP call

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpResponse {
  result?: {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code?: number; message?: string };
}

// ---------------------------------------------------------------------------
// Local embedding — runs on the user's machine, never on Supabase cloud
// ---------------------------------------------------------------------------

/**
 * Generate a single embedding vector by calling the local LLM directly.
 * Returns null (gracefully) if LOCAL_LLM_BASE_URL / LOCAL_EMBEDDING_MODEL are
 * not set, or if the call fails. The caller must handle the null case.
 *
 * This is the critical fix for the 127.0.0.1 blocker: the extension runs on
 * the user's machine where the LLM is reachable, so we embed here and pass
 * the pre-computed vector to the edge function, which then only needs pgvector.
 */
async function generateEmbeddingLocally(text: string): Promise<number[] | null> {
  const base  = process.env.LOCAL_LLM_BASE_URL?.trim().replace(/\/+$/, "");
  const model = process.env.LOCAL_EMBEDDING_MODEL?.trim();
  if (!base || !model) return null;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.LOCAL_LLM_API?.trim();
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, input: text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[open-brain] Local embedding failed: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0]?.embedding ?? null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[open-brain] Local embedding error: ${msg}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// HTTP helper — calls the edge function via JSON-RPC tools/call
// ---------------------------------------------------------------------------

async function mcpCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const url = process.env.BRAIN_MCP_URL?.trim();
  const key = process.env.BRAIN_ACCESS_KEY?.trim();

  if (!url || !key) {
    return (
      "Error: BRAIN_MCP_URL and BRAIN_ACCESS_KEY must be set in your environment.\n" +
      "Add them to your shell profile:\n" +
      "  export BRAIN_MCP_URL=\"https://<ref>.supabase.co/functions/v1/open-brain-mcp\"\n" +
      "  export BRAIN_ACCESS_KEY=\"your-key\""
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-brain-key": key,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: Could not reach Open Brain endpoint — ${msg}`;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) return "Error: Unauthorized — check your BRAIN_ACCESS_KEY.";
  if (res.status === 429) return "Error: Rate limit exceeded — too many requests per minute.";
  if (!res.ok) return `Error: Open Brain returned HTTP ${res.status}.`;

  let data: McpResponse;
  try {
    data = (await res.json()) as McpResponse;
  } catch {
    return "Error: Could not parse response from Open Brain endpoint.";
  }

  if (data.error) return `Error: ${data.error.message ?? "unknown error"}`;
  return data.result?.content?.[0]?.text ?? "No response from Open Brain.";
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // ── Startup check ──────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const url   = process.env.BRAIN_MCP_URL?.trim();
    const key   = process.env.BRAIN_ACCESS_KEY?.trim();
    const llm   = process.env.LOCAL_LLM_BASE_URL?.trim();
    const model = process.env.LOCAL_EMBEDDING_MODEL?.trim();

    if (!url || !key) {
      ctx.ui.notify(
        "open-brain: BRAIN_MCP_URL or BRAIN_ACCESS_KEY not set — knowledge graph tools are loaded but will return errors until env vars are configured.",
        "warning"
      );
    } else if (!llm || !model) {
      ctx.ui.notify(
        "open-brain: LOCAL_LLM_BASE_URL or LOCAL_EMBEDDING_MODEL not set — " +
        "search_thoughts and capture_thought will fail (embedding is generated locally). " +
        "Add both to your shell profile. Also set LOCAL_LLM_API if your server requires a bearer token.",
        "warning"
      );
    }
  });

  // ── search_thoughts ────────────────────────────────────────────────────────
  pi.registerTool({
    name: "search_thoughts",
    label: "Search Knowledge Graph",
    description:
      "Semantic search over the personal Obsidian vault / Open Brain knowledge graph. " +
      "Use this when the user asks about their notes, past decisions, insights, projects, " +
      "people, or anything that might be in their personal second brain.",
    promptSnippet: "Search personal Obsidian vault by meaning",
    promptGuidelines: [
      "Use search_thoughts before answering questions about the user's personal life, projects, decisions, or opinions — their vault likely contains relevant context.",
      "Use search_thoughts when the user asks 'what do my notes say about X', 'do I have anything on Y', or similar knowledge queries.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description: "Natural language query — describe what you are looking for.",
      }),
      limit: Type.Optional(
        Type.Number({ description: "Maximum results to return. Default 10, max 25." })
      ),
      threshold: Type.Optional(
        Type.Number({ description: "Minimum similarity score 0–1. Default 0.3." })
      ),
    }),
    async execute(_id, params) {
      // Generate embedding locally (on the user's machine where the LLM is reachable).
      // Pass the vector to the edge function so it only needs to run pgvector — it never
      // tries to call 127.0.0.1 from Supabase cloud.
      const args: Record<string, unknown> = { ...params };
      const embedding = await generateEmbeddingLocally(params.query);
      if (embedding) {
        args.embedding = embedding;
      }
      const text = await mcpCall("search_thoughts", args);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── capture_thought ────────────────────────────────────────────────────────
  pi.registerTool({
    name: "capture_thought",
    label: "Capture Thought",
    description:
      "Save a new thought, insight, or note to Open Brain. " +
      "Content is embedded and deduplicated automatically via SHA-256 fingerprint.",
    promptSnippet: "Save a new insight or note to the knowledge graph",
    promptGuidelines: [
      "Use capture_thought only when the user explicitly asks to save, capture, remember, or store something. Never capture silently.",
    ],
    parameters: Type.Object({
      content: Type.String({
        description: "The thought or note to capture. Maximum 20,000 characters.",
      }),
    }),
    async execute(_id, params) {
      // Same client-side embedding path as search_thoughts — embed locally, ship
      // the vector to the edge function so it skips its own LLM call.
      const args: Record<string, unknown> = { ...params };
      const embedding = await generateEmbeddingLocally(params.content);
      if (embedding) {
        args.embedding = embedding;
      }
      const text = await mcpCall("capture_thought", args);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── list_thoughts ──────────────────────────────────────────────────────────
  pi.registerTool({
    name: "list_thoughts",
    label: "List Recent Thoughts",
    description: "List the most recently captured thoughts from Open Brain, newest first.",
    promptSnippet: "List recent thoughts from the knowledge graph",
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({ description: "Maximum results. Default 20, max 50." })
      ),
    }),
    async execute(_id, params) {
      const text = await mcpCall("list_thoughts", params as Record<string, unknown>);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ── thought_stats ──────────────────────────────────────────────────────────
  pi.registerTool({
    name: "thought_stats",
    label: "Knowledge Graph Stats",
    description:
      "Return Open Brain statistics — total number of thoughts captured in the knowledge graph.",
    promptSnippet: "Get Open Brain knowledge graph statistics",
    parameters: Type.Object({}),
    async execute(_id, _params) {
      const text = await mcpCall("thought_stats", {});
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
