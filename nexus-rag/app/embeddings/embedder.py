from typing import List
from app.core.config import EMBEDDING_MODEL
from sentence_transformers import SentenceTransformer

_model = None

def get_model():
    global _model
    if _model is None:
        _model = SentenceTransformer(EMBEDDING_MODEL)
    return _model

def embed_text(text: str) -> List[float]:
    model = get_model()
    embedding = model.encode(text, normalize_embeddings=True)

    if len(embedding) != 384:
        raise ValueError(
            f"Embedding dimension mismatch: expected 384, got {len(embedding)}"
        )

    return embedding.tolist()