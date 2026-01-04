from typing import List
from app.core.config import EMBEDDING_MODEL
from sentence_transformers import SentenceTransformer

_model = SentenceTransformer(EMBEDDING_MODEL)


def embed_text(text: str) -> List[float]:
    """
    Generate embedding for a given text.

    Returns:
        List[float] of length 384 (must match Mongo vector index)
    """
    embedding = _model.encode(text, normalize_embeddings=True)

    if len(embedding) != 384:
        raise ValueError(
            f"Embedding dimension mismatch: expected 384, got {len(embedding)}"
        )

    return embedding.tolist()
