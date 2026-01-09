from datetime import datetime
from typing import Optional

from app.core.mongo import get_vector_collection
from app.embeddings.embedder import embed_text

class VectorStore:
    def store_message(
        self,
        *,
        group_id: str,
        chat_id: str,
        content: str,
        role: str,
        message_id: Optional[str] = None,
    ):
        if not content.strip():
            return

        collection = get_vector_collection()

        embedding = embed_text(content)

        document = {
            "group_id": group_id,
            "chat_id": chat_id,
            "content": content,
            "embedding": embedding,
            "role": role,
            "message_id": message_id,
            "created_at": datetime.utcnow(),
        }

        collection.insert_one(document)
vector_store = VectorStore()