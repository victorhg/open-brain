import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Helpers ---

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: texts }),
  });
  const data = await res.json();
  return data.data.map((d: any) => d.embedding);
}

async function extractMetadata(text: string) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
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
        { role: "user", content: text },
      ],
      temperature: 0,
    }),
  });
  const data = await res.json();
  try {
    const raw = data.choices[0].message.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(raw);
  } catch {
    return { type: "note", category: "uncategorized", people: [], topics: [], action_items: [] };
  }
}

function formatThought(t: any): string {
  const lines = [t.content];
  const meta = [];
  if (t.type) meta.push(`Type: ${t.type}`);
  if (t.category) meta.push(`Category: ${t.category}`);
  if (t.source) meta.push(`Source: ${t.source}`);
  if (t.people?.length) meta.push(`People: ${t.people.join(", ")}`);
  if (t.topics?.length) meta.push(`Topics: ${t.topics.join(", ")}`);
  if (t.action_items?.length) meta.push(`Action items: ${t.action_items.join("; ")}`);
  if (t.similarity !== undefined) meta.push(`Relevance: ${(t.similarity * 100).toFixed(0)}%`);
  meta.push(`Captured: ${new Date(t.created_at).toLocaleDateString()}`);
  meta.push(`ID: ${t.id}`);
  if (meta.length) lines.push(`[${meta.join(" | ")}]`);
  return lines.join("\n");
}

function chunkText(text: string, maxChunkSize = 800, overlap = 100): string[] {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
  const chunks: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    if (para.length > maxChunkSize) {
      if (current.length > 0) {
        chunks.push(current.trim());
        current = "";
      }
      const sentences = para.split(/(?<=[.!?。])\s+/);
      let sentenceChunk = "";
      for (const sentence of sentences) {
        if ((sentenceChunk + " " + sentence).length > maxChunkSize && sentenceChunk.length > 0) {
          chunks.push(sentenceChunk.trim());
          const words = sentenceChunk.split(/\s+/);
          const overlapWords = words.slice(-Math.ceil(overlap / 5));
          sentenceChunk = overlapWords.join(" ") + " " + sentence;
        } else {
          sentenceChunk = sentenceChunk ? sentenceChunk + " " + sentence : sentence;
        }
      }
      if (sentenceChunk.length > 0) current = sentenceChunk;
      continue;
    }
    if ((current + "\n\n" + para).length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      const words = current.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(overlap / 5));
      current = overlapWords.join(" ") + "\n\n" + para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }
  if (chunks.length === 0 && text.trim().length > 0) {
    chunks.push(text.trim());
  }
  return chunks;
}

const TOOLS = [
  {
    name: "search_thoughts",
    description: "Search your personal memories/thoughts/captures by meaning.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you're looking for — natural language" },
        threshold: { type: "number", description: "Minimum similarity 0-1. Default 0.3" },
        limit: { type: "number", description: "Max results. Default 10" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_thoughts",
    description: "List recent thoughts.",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "thought_stats",
    description: "Overview of your brain stats.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "capture_thought",
    description: "Save a thought.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The thought to capture" },
      },
      required: ["content"],
    },
  },
];

async function handleTool(name: string, args: any): Promise<string> {
  switch (name) {
    case "search_thoughts": {
      const embedding = await generateEmbedding(args.query);
      const { data, error } = await supabase.rpc("match_thoughts_v2", {
        query_embedding: embedding,
        match_threshold: args.threshold ?? 0.3,
        match_count: args.limit ?? 10,
      });
      if (error) return `Error: ${error.message}`;
      if (!data?.length) return "No matching thoughts found.";
      return `Found ${data.length} thought(s):\n\n` + data.map((t: any, i: number) => `${i + 1}. ${formatThought(t)}`).join("\n\n");
    }
    case "list_thoughts": {
      const { data, error } = await supabase
        .from("thoughts")
        .select("id, content, type, category, source, created_at")
        .order("created_at", { ascending: false })
        .limit(args.limit ?? 20);
      if (error) return `Error: ${error.message}`;
      if (!data?.length) return "No thoughts found.";
      return `${data.length} recent thought(s):\n\n` + data.map((t: any, i: number) => `${i + 1}. ${formatThought(t)}`).join("\n\n");
    }
    case "thought_stats": {
        const { count } = await supabase.from("thoughts").select("*", { count: "exact", head: true });
        return `Total thoughts captured: ${count}`;
    }
    case "capture_thought": {
      const [embedding, meta] = await Promise.all([generateEmbedding(args.content), extractMetadata(args.content)]);
      const { data, error } = await supabase.from("thoughts").insert({
        content: args.content, embedding, metadata: {
          type: meta.type,
          category: meta.category,
          source: "mcp",
          people: meta.people,
          action_items: meta.action_items,
          topics: meta.topics
        },
      }).select("id").single();
      if (error) return `Error saving: ${error.message}`;
      return `Captured thought successfully. ID: ${data.id}`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

async function handleMcpRequest(body: any) {
  const { method, id, params } = body;
  switch (method) {
    case "initialize":
      return { jsonrpc: "2.0", id, result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "open-brain", version: "2.0.0" },
      }};
    case "notifications/initialized":
      return null;
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const { name, arguments: args } = params;
      try {
        const text = await handleTool(name, args || {});
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
      } catch (err: any) {
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true } };
      }
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-brain-key");
  if (key !== MCP_ACCESS_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  if (req.method === "GET") {
    const sessionId = crypto.randomUUID();
    const postUrl = `${url.pathname}?key=${MCP_ACCESS_KEY}&sessionId=${sessionId}`;
    const body = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(`event: endpoint\ndata: ${postUrl}\n\n`));
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const result = await handleMcpRequest(body);
    if (result === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  }

  return new Response("Method not allowed", { status: 405 });
});
