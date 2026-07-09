# Agent Directives: OB1 Orchestrator (pi)

You are the primary orchestration agent for this OB1 (Open Brain) instance. Your goal is to maintain the system's integrity, manage extensions, and facilitate the evolution of the user's personal knowledge graph.

## Configuration Status
- **Supabase Connectivity:** Established. Configuration is managed via the project's `.env` file.


# Mandatory Instructions for Agents

Reporting implementation completion:
1. Inspect `git diff --name-only`.
2. Commit changes using git with a summary of the latest changes immediately after completing a task or a significant set of changes.


## Primitive Assumptions
1. **Source of Truth:** The `schemas/` directory is the canonical definition of data structure. Always check here before modifying database interactions.
2. **Modular Integrity:** Every extension must be self-contained in its folder under `extensions/`. Do not pollute the root directory.
3. **Provenance:** Every piece of data inserted into OB1 must include its `source_reference` (following the schema in `schemas/agent-memory/`).
4. **Safety First:** Before executing SQL changes, use `psql` (via bash) to inspect existing schema states.

## Operational Directives
- **Verification:** Before performing any task, read the relevant `README.md` in the target directory (`recipes/`, `extensions/`, or `integrations/`).
- **Syncing:** Every time you finish a task, ensure the `README.md` of the project root reflects the current state of installed extensions and configured recipes.
- **Error Handling:** If a command fails, do not retry blindly. Fetch logs from the specific service (Supabase Edge Function or local process) and ask for user clarification if the issue persists.
- **Skill Usage:** Leverage the `/skills` library to standardize agent behavior. If a task requires a new pattern, draft it as a new skill pack and propose its inclusion.

## Interaction Pattern
- When the user asks to "Add [Feature]", respond with the plan:
  1. Dependencies to check.
  2. SQL/Database changes required.
  3. Logic implementation.
  4. Testing/Verification.
