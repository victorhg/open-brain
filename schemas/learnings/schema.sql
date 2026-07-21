-- learnings table
CREATE TABLE IF NOT EXISTS learnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    insight TEXT NOT NULL,
    learning_type TEXT NOT NULL CHECK (learning_type IN ('pattern', 'contradiction', 'connection', 'gap', 'trend')),
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    related_thought_ids UUID[],
    related_wiki_slugs TEXT[],
    related_entities JSONB DEFAULT '[]'::jsonb,
    session_window TSTZRANGE,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learnings_type ON learnings(learning_type);
CREATE INDEX IF NOT EXISTS idx_learnings_created_at ON learnings(created_at);

-- query_sessions table
CREATE TABLE IF NOT EXISTS query_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query TEXT NOT NULL,
    answer TEXT,
    thought_ids UUID[],
    wiki_slugs TEXT[],
    model_used TEXT,
    filed_as_wiki BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_sessions_created_at ON query_sessions(created_at);
