from typing import List, Dict
import numpy as np

class VectorRecord:
    def __init__(self, id: str, vector: List[float], metadata: Dict):
        self.id = id
        self.vector = np.array(vector)
        self.metadata = metadata


class InMemoryVectorStore:
    def __init__(self):
        self.records: List[VectorRecord] = []

    def add(self, record: VectorRecord):
        self.records.append(record)

    def similarity_search(
        self,
        query_vector: List[float],
        room_id: str,
        top_k: int = 5,
    ) -> List[Dict]:
        """
        Cosine similarity search (room-scoped)
        """
        query = np.array(query_vector)

        scored = []
        for record in self.records:
            if record.metadata.get("room_id") != room_id:
                continue

            score = self._cosine_similarity(query, record.vector)
            scored.append((score, record))

        scored.sort(key=lambda x: x[0], reverse=True)

        return [
            {
                "id": record.id,
                "score": float(score),
                "content": record.metadata.get("content"),
                "metadata": record.metadata,
            }
            for score, record in scored[:top_k]
        ]

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
