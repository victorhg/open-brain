"""
chunker.py — Note chunking pipeline.

Splits notes into atomic thoughts either by heading boundaries or,
for long sections, via LLM distillation (llm_client.llm_distill).
"""

import re

import config
from llm_client import llm_distill
from obsidian_parser import word_count


def chunk_by_headings(body: str, title: str) -> list[dict]:
    """Split note body on headings. Returns list of {section, content} dicts."""
    parts = re.split(r'^(#{1,6}\s+.+)$', body, flags=re.MULTILINE)

    chunks = []
    current_section = title  # content before first heading belongs to the note title
    current_content: list[str] = []

    for part in parts:
        heading_match = re.match(r'^#{1,6}\s+(.+)$', part.strip())
        if heading_match:
            text = '\n'.join(current_content).strip()
            if text and word_count(text) > 10:
                chunks.append({'section': current_section, 'content': text})
            current_section = heading_match.group(1).strip()
            current_content = []
        else:
            current_content.append(part)

    # Flush last section
    text = '\n'.join(current_content).strip()
    if text and word_count(text) > 10:
        chunks.append({'section': current_section, 'content': text})

    return chunks


def chunk_note(note: dict, use_llm: bool,
               verbose: bool = False) -> list[dict]:
    """Chunk a parsed note into atomic thoughts.

    Returns a list of dicts: {content, section, was_llm_chunked}.
    """
    body = note['body']
    title = note['title']
    wc = word_count(body)

    # Short note → single thought
    if wc <= config.WHOLE_NOTE_THRESHOLD:
        return [{'content': body.strip(), 'section': None, 'was_llm_chunked': False}]

    chunks = chunk_by_headings(body, title)

    # No useful heading splits → single thought
    if len(chunks) <= 1:
        return [{'content': body.strip(), 'section': None, 'was_llm_chunked': False}]

    results = []
    for chunk in chunks:
        if word_count(chunk['content']) > config.LLM_CHUNK_THRESHOLD and use_llm:
            if verbose:
                print(f"    LLM chunking section: {chunk['section']} "
                      f"({word_count(chunk['content'])} words)")
            llm_thoughts = llm_distill(title, chunk['content'])
            for thought in llm_thoughts:
                results.append({
                    'content': thought,
                    'section': chunk['section'],
                    'was_llm_chunked': True,
                })
        else:
            results.append({
                'content': chunk['content'],
                'section': chunk['section'],
                'was_llm_chunked': False,
            })

    return results
