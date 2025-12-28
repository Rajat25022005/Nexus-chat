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
        """
        Store a message embedding in MongoDB for RAG.
        
        This is Nexus-safe:
        - Scoped by group_id (workspace)
        - Scoped by chat_id (thread)
        """

        if not content.strip():
            return

        collection = get_vector_collection()

        # 1️⃣ Generate embedding
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