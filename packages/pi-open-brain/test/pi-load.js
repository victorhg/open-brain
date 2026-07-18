#!/usr/bin/env node
/**
 * pi-load.js — Layer 2 pi integration test for pi-open-brain
 *
 * Uses the pi SDK to load the extension and verify tool/skill registration
 * WITHOUT making any LLM calls. Dynamically resolves @earendil-works/pi-coding-agent
 * from the global npm installation.
 *
 * What it checks:
 *   - All 4 tools registered: search_thoughts, capture_thought,
 *     list_thoughts, thought_stats
 *   - All 3 package skills loaded: open-brain, auto-capture, panning-for-gold
 *   - Zero extension load errors
 *   - Zero skill diagnostics warnings
 *
 * Usage:
 *   node packages/pi-open-brain/test/pi-load.js
 *
 * Exit codes:
 *   0  all checks pass
 *   1  one or more checks failed
 *   2  pi SDK not found (skip — not a failure)
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR   = path.resolve(__dirname, "..");
const REPO_DIR  = path.resolve(PKG_DIR, "../..");

// ---------------------------------------------------------------------------
// Resolve pi SDK from global npm
// ---------------------------------------------------------------------------

let piSdk;
try {
  const npmRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
  const sdkEntry = path.join(npmRoot, "@earendil-works", "pi-coding-agent", "dist", "index.js");
  piSdk = await import(sdkEntry);
} catch {
  process.stderr.write(
    "SKIP: @earendil-works/pi-coding-agent not found in global npm — " +
    "install pi globally to run this test.\n"
  );
  process.exit(2);
}

const { createAgentSession, DefaultResourceLoader, SessionManager, getAgentDir } = piSdk;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const REQUIRED_TOOLS  = ["search_thoughts", "capture_thought", "list_thoughts", "thought_stats"];
const REQUIRED_SKILLS = ["open-brain", "auto-capture", "panning-for-gold"];

let passed = 0;
let failed = 0;

function pass(label, detail = "") {
  const suffix = detail ? ` — ${detail}` : "";
  process.stdout.write(`  ✓ ${label}${suffix}\n`);
  passed++;
}

function fail(label, detail = "") {
  const suffix = detail ? ` — ${detail}` : "";
  process.stdout.write(`  ✗ ${label}${suffix}\n`);
  failed++;
}

// ---------------------------------------------------------------------------
// Load extension via SDK (no LLM call)
// ---------------------------------------------------------------------------

process.stdout.write("\nOpen Brain — pi-open-brain load test (SDK, no LLM)\n\n");

let session, extensionsResult, loader;

try {
  loader = new DefaultResourceLoader({
    cwd: REPO_DIR,
    agentDir: getAgentDir(),
    additionalExtensionPaths: [path.join(PKG_DIR, "extensions", "index.ts")],
    additionalSkillPaths:     [path.join(PKG_DIR, "skills")],
  });
  await loader.reload();

  ({ session, extensionsResult } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    resourceLoader: loader,
    noTools: "builtin", // suppress built-in tools so our 4 stand out clearly
  }));
} catch (err) {
  process.stderr.write(`Fatal: could not initialise pi session — ${err.message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Check 1: no extension load errors for our package
// ---------------------------------------------------------------------------

const ourErrors = extensionsResult.errors.filter((e) =>
  e.path?.includes("pi-open-brain")
);
if (ourErrors.length === 0) {
  pass("extension loads without errors");
} else {
  for (const e of ourErrors) fail(`extension load error: ${e.path}`, e.error);
}

// ---------------------------------------------------------------------------
// Check 2: all 4 tools registered
// ---------------------------------------------------------------------------

const registeredTools = new Set(session.agent.state.tools.map((t) => t.name));

for (const name of REQUIRED_TOOLS) {
  if (registeredTools.has(name)) {
    pass(`tool registered: ${name}`);
  } else {
    fail(`tool missing: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Check 3: all 3 package skills loaded
// ---------------------------------------------------------------------------

const { skills: loadedSkills, diagnostics: skillDiags } = loader.getSkills();
const skillNames = new Set(loadedSkills.map((s) => s.name));

for (const name of REQUIRED_SKILLS) {
  if (skillNames.has(name)) {
    pass(`skill loaded: ${name}`);
  } else {
    fail(`skill missing: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Check 4: no skill diagnostic warnings for our package
// ---------------------------------------------------------------------------

const ourSkillWarnings = skillDiags.filter((d) =>
  d.path?.includes("pi-open-brain")
);
if (ourSkillWarnings.length === 0) {
  pass("no skill diagnostic warnings");
} else {
  for (const w of ourSkillWarnings) fail(`skill warning: ${w.path}`, w.message);
}

// ---------------------------------------------------------------------------
// Cleanup + summary
// ---------------------------------------------------------------------------

try { session.dispose(); } catch { /* ignore */ }

const total = passed + failed;
process.stdout.write(
  `\nSummary: ${passed} pass, ${failed} fail (${total} total)\n`
);
process.stdout.write(failed === 0 ? "Result: OK\n\n" : "Result: FAIL\n\n");
process.exit(failed === 0 ? 0 : 1);
