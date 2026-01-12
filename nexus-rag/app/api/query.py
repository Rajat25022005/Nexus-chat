from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional
from app.auth.dependencies import get_current_user
from app.core.mongo import get_message_collection
from datetime import datetime
from app.rag.retriever import retrieve_context
from app.generator.prompt import build_prompt
from app.generator.service import generate_answer

router = APIRouter()
class ChatMessage(BaseModel):
    role: str  # "user" | "assistant" | "system"
    content: str


class QueryRequest(BaseModel):
    query: str = Field(..., description="User message")
    group_id: str = Field(..., description="Collaboration group ID")
    chat_id: str = Field(..., description="Chat/thread ID")
    history: List[ChatMessage] = Field(
        default_factory=list,
        description="Recent chat history for conversational context"
    )


class SourceChunk(BaseModel):
    id: str
    score: float
    content: Optional[str] = None


class QueryResponse(BaseModel):
    answer: str
    sources: List[SourceChunk]

@router.post("/query", response_model=QueryResponse)
async def query_rag(
    request: QueryRequest,
    user=Depends(get_current_user)
):
    try:
        messages = get_message_collection()
        messages.insert_one({
            "user_id": user["email"], 
            "group_id": request.group_id,
            "chat_id": request.chat_id,
            "role": "user",
            "content": request.query,
            "created_at": datetime.utcnow(),
        })

        from app.services.chat_service import process_chat_message
        answer, documents = await process_chat_message(
            user_query=request.query,
            group_id=request.group_id,
            chat_id=request.chat_id,
            user_email=user["email"],
            history=request.history
        )

        return {
            "answer": answer,
            "sources": [
                {
                    "id": str(doc.get("id")),
                    "score": float(doc.get("score", 0)),
                    "content": doc.get("content"),
                }
                for doc in documents
            ]
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"RAG query failed: {str(e)}"
        )
