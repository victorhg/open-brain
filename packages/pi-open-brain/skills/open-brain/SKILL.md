# Open Brain — Personal Knowledge Graph

Use this skill when the user is working in a session where they may want to query or add to their personal knowledge base.

## What is Open Brain

Open Brain is a personal knowledge graph backed by an Obsidian vault. It contains the user's notes, decisions, insights, captured thoughts, and past writing — all stored as vector embeddings for semantic search.

## Available Tools

| Tool | When to use |
|---|---|
| `search_thoughts` | Any question that might be answered by the user's own notes |
| `capture_thought` | User explicitly asks to save, remember, or capture something |
| `list_thoughts` | User wants to see their recent captures |
| `thought_stats` | User asks "how many thoughts", "what's in my brain", etc. |

## Behavior Guidelines

- **Search before answering** any knowledge question about the user's life, decisions, projects, opinions, or relationships — their vault likely contains relevant context.
- **Never guess** about personal facts (people, projects, dates, past decisions). Search first.
- **Capture only on explicit request.** Do not silently save things the user mentions.
- **Respect low similarity.** If all results are below ~40% similarity, say so and note the vault may not cover this topic yet.
- **Combine sources.** You can search the vault AND use your general knowledge together — just clearly label what came from the vault vs. what is your own reasoning.
