from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime
from app.embeddings.embedder import Embedder
from app.vectorstore.store import InMemoryVectorStore, VectorRecord

router = APIRouter()

class IngestRequest(BaseModel):
    message_id: str
    room_id: str
    content: str
    author: str | None = None
    timestamp: datetime | None = None


@router.post("/ingest")
def ingest_message(payload: IngestRequest):
    vector = embedder.embed(payload.content)

    record = VectorRecord(
        id=payload.message_id,
        vector=vector,
        metadata={
            "room_id": payload.room_id,
            "content": payload.content,
            "author": payload.author,
            "timestamp": payload.timestamp,
        },
    )

    vector_store.add(record)

    return {
        "status": "stored",
        "message_id": payload.message_id,
    }

embedder = Embedder()
vector_store = InMemoryVectorStore()
