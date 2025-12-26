from sentence_transformers import SentenceTransformer
from typing import List

class Embedder:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """
        Lightweight, fast, production-proven embedding model.
        Output dimension: 384
        """
        self.model = SentenceTransformer(model_name)

    def embed(self, text: str) -> List[float]:
        """
        Embed a single string.
        """
        vector = self.model.encode(text)
        return vector.tolist()

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """
        Embed multiple strings at once.
        """
        vectors = self.model.encode(texts)
        return vectors.tolist()
