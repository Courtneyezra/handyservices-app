-- B8 & B9: Install pgvector extension and add vector column
-- This migration enables native vector operations in PostgreSQL

-- B8: Install pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- B9: Add native vector column to productized_services
ALTER TABLE productized_services 
ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Migrate existing embedding_vector (text) data to new embedding (vector) column
-- This handles the conversion from JSON string to native vector type
UPDATE productized_services 
SET embedding = embedding_vector::vector
WHERE embedding_vector IS NOT NULL 
  AND embedding IS NULL;

-- B9: Add HNSW index for fast similarity search
-- HNSW (Hierarchical Navigable Small World) is optimized for high-dimensional vectors
CREATE INDEX IF NOT EXISTS idx_productized_services_embedding 
ON productized_services 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Note: Keep embedding_vector column for backwards compatibility
-- It will be deprecated in a future migration once pgvector is fully validated
