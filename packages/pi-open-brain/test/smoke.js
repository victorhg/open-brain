#!/usr/bin/env node
/**
 * smoke.js — Layer 1 HTTP smoke test for pi-open-brain
 *
 * Tests the HTTP client layer independently of pi. Calls the edge function
 * directly using the same env vars the extension uses (BRAIN_MCP_URL,
 * BRAIN_ACCESS_KEY). No pi installation required.
 *
 * Usage:
 *   node packages/pi-open-brain/test/smoke.js           # read-only
 *   node packages/pi-open-brain/test/smoke.js --write   # also tests capture_thought
 *   node packages/pi-open-brain/test/smoke.js --json    # machine-readable output
 *
 * Env vars:
 *   BRAIN_MCP_URL      Full URL to the edge function (required)
 *   BRAIN_ACCESS_KEY   MCP access key (required)
 *   -- or --
 *   SUPABASE_URL + MCP_ACCESS_KEY   (legacy; auto-derives BRAIN_MCP_URL)
 *
 * Exit codes:
 *   0  all pass (or all pass/skip)
 *   1  at least one check failed
 *   2  setup error (missing required env, etc.)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const FLAG_WRITE = args.includes("--write");
const FLAG_JSON  = args.includes("--json");

// ---------------------------------------------------------------------------
// Env loading — walks up from test/ to find .env
// ---------------------------------------------------------------------------

function parseEnvFile(envPath) {
  const vars = {};
  if (!fs.existsSync(envPath)) return vars;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
    }
  }
  return vars;
}

// Walk up from the script directory to find the nearest .env
function findEnv() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    const parsed = parseEnvFile(candidate);
    if (Object.keys(parsed).length > 0) return parsed;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}

const envFile = findEnv();
const env = (key) => process.env[key] || envFile[key] || "";

// Resolve BRAIN_MCP_URL — explicit or derived from SUPABASE_URL
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/+$/, "");
const BRAIN_MCP_URL = env("BRAIN_MCP_URL").replace(/\/+$/, "")
  || (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/open-brain-mcp` : "");

// Resolve BRAIN_ACCESS_KEY — explicit or fallback to MCP_ACCESS_KEY
const BRAIN_ACCESS_KEY = env("BRAIN_ACCESS_KEY") || env("MCP_ACCESS_KEY");

if (!BRAIN_MCP_URL || !BRAIN_ACCESS_KEY) {
  process.stderr.write(
    "ERROR: BRAIN_MCP_URL and BRAIN_ACCESS_KEY (or SUPABASE_URL + MCP_ACCESS_KEY) must be set.\n"
  );
  process.exit(2);
}

const HEADERS = {
  "Content-Type": "application/json",
  "x-brain-key": BRAIN_ACCESS_KEY,
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

class SkipError extends Error {
  constructor(msg) { super(msg); this.name = "SkipError"; }
}

async function runCheck(fn, { timeout = 12_000 } = {}) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const out = await fn(ctrl.signal);
    return { status: "pass", message: String(out ?? "ok"), ms: Date.now() - t0 };
  } catch (err) {
    const ms = Date.now() - t0;
    if (err instanceof SkipError) return { status: "skip", message: err.message, ms };
    const raw = err.name === "AbortError"
      ? `timeout after ${timeout}ms`
      : String(err.message || err);
    return { status: "fail", message: raw.slice(0, 240), ms };
  } finally {
    clearTimeout(timer);
  }
}

async function mcpPost(body, signal) {
  const res = await fetch(BRAIN_MCP_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function toolText(body) {
  const text = body?.result?.content?.[0]?.text;
  if (!text) throw new Error("missing result.content[0].text in response");
  return text;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const checks = [
  // ── Connectivity ──────────────────────────────────────────────────────────
  {
    name: "endpoint reachable",
    fn: async (s) => {
      const res = await fetch(BRAIN_MCP_URL, { method: "OPTIONS", signal: s });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return `HTTP ${res.status}`;
    },
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  {
    name: "missing key → 401",
    fn: async (s) => {
      const res = await fetch(BRAIN_MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // no x-brain-key
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        signal: s,
      });
      if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
      return "401 as expected";
    },
  },
  {
    name: "wrong key → 401",
    fn: async (s) => {
      const res = await fetch(BRAIN_MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-brain-key": "wrong-key-abc" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        signal: s,
      });
      if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
      return "401 as expected";
    },
  },
  {
    name: "query param key → 401 (security regression)",
    fn: async (s) => {
      const url = `${BRAIN_MCP_URL}?key=${encodeURIComponent(BRAIN_ACCESS_KEY)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // key only in query, not header
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        signal: s,
      });
      if (res.status !== 401) throw new Error(`expected 401 (query-param auth disabled), got ${res.status}`);
      return "401 as expected — query-param auth correctly rejected";
    },
  },

  // ── thought_stats (safest: read-only, no params) ─────────────────────────
  {
    name: "thought_stats returns count",
    fn: async (s) => {
      const { status, body } = await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "thought_stats", arguments: {} },
      }, s);
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const text = toolText(body);
      if (!/\d+/.test(text)) throw new Error(`unexpected response: ${text}`);
      return text.slice(0, 80);
    },
  },

  // ── search_thoughts ───────────────────────────────────────────────────────
  {
    name: "search_thoughts returns array shape",
    fn: async (s) => {
      const { status, body } = await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "search_thoughts", arguments: { query: "obsidian notes", limit: 3 } },
      }, s);
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const text = toolText(body);
      // Either "Found N thought(s):" or "No matching thoughts found."
      if (!/found|no matching/i.test(text)) throw new Error(`unexpected response: ${text.slice(0, 120)}`);
      return text.split("\n")[0]; // first line summary
    },
  },

  // ── list_thoughts ─────────────────────────────────────────────────────────
  {
    name: "list_thoughts returns array shape",
    fn: async (s) => {
      const { status, body } = await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "list_thoughts", arguments: { limit: 2 } },
      }, s);
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const text = toolText(body);
      if (!/thought|no thoughts/i.test(text)) throw new Error(`unexpected response: ${text.slice(0, 120)}`);
      return text.split("\n")[0];
    },
  },

  // ── capture_thought (write — opt-in via --write) ──────────────────────────
  {
    name: "capture_thought saves and deduplicates",
    fn: async (s) => {
      if (!FLAG_WRITE) throw new SkipError("write tests skipped (pass --write to enable)");
      const content = `pi-open-brain smoke test ${Date.now()}`;
      // First insert
      const { status: s1, body: b1 } = await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "capture_thought", arguments: { content } },
      }, s);
      if (s1 !== 200) throw new Error(`HTTP ${s1}`);
      const t1 = toolText(b1);
      if (!/captured|saved/i.test(t1)) throw new Error(`unexpected response: ${t1}`);
      // Dedup: same content → same ID
      const { body: b2 } = await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "capture_thought", arguments: { content } },
      }, s);
      const t2 = toolText(b2);
      const id1 = (t1.match(/ID: ([\w-]+)/) ?? [])[1];
      const id2 = (t2.match(/ID: ([\w-]+)/) ?? [])[1];
      if (id1 && id2 && id1 !== id2) throw new Error(`dedup failed: got ${id1} then ${id2}`);
      return `saved id=${id1 ?? "unknown"}, dedup ok`;
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  const results = [];
  for (const check of checks) {
    const outcome = await runCheck(check.fn);
    results.push({ name: check.name, ...outcome });
  }

  const totals = results.reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; },
    { pass: 0, skip: 0, fail: 0 }
  );
  const allPass = totals.fail === 0;

  if (FLAG_JSON) {
    process.stdout.write(JSON.stringify({ ok: allPass, totals, results }, null, 2) + "\n");
  } else {
    process.stdout.write(`\nOpen Brain — pi-open-brain HTTP smoke test\nTarget: ${BRAIN_MCP_URL}\n\n`);
    for (const r of results) {
      const icon = r.status === "pass" ? "✓" : r.status === "skip" ? "⚠" : "✗";
      const name = r.name.padEnd(52);
      const ms   = `${r.ms}ms`.padStart(7);
      const detail = r.message ? ` — ${r.message}` : "";
      process.stdout.write(`  ${icon} ${name} ${ms}${detail}\n`);
    }
    process.stdout.write(
      `\nSummary: ${totals.pass} pass, ${totals.skip} skip, ${totals.fail} fail\n`
    );
    process.stdout.write(allPass ? "Result: OK\n\n" : "Result: FAIL\n\n");
  }

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.stack ?? err}\n`);
  process.exit(1);
});
