from fastapi import APIRouter
from pydantic import BaseModel
from app.embeddings.embedder import Embedder
from app.api.ingest import vector_store


router = APIRouter()

class QueryRequest(BaseModel):
    room_id: str
    query: str


embedder = Embedder()

@router.post("/query")
def query_context(payload: QueryRequest):
    query_vector = embedder.embed(payload.query)

    results = vector_store.similarity_search(
        query_vector=query_vector,
        room_id=payload.room_id,
        top_k=5,
    )

    return {
        "matches": results
    }
