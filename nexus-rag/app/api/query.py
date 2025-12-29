from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional

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
async def query_rag(request: QueryRequest):
    """
    Nexus RAG Query Endpoint

    - Scoped by group_id and chat_id
    - Uses recent conversation history
    - Returns answer + sources (for explainability)
    """

    try:
        # 1️⃣ Retrieve relevant context (RAG)
        documents = retrieve_context(
            query=request.query,
            group_id=request.group_id,
            chat_id=request.chat_id,
            top_k=5,
        )

        # documents = [
        #   { "id": "...", "content": "...", "score": 0.82 }
        # ]

        # 2️⃣ Build RAG-aware prompt
        prompt = build_prompt(
            user_query=request.query,
            retrieved_docs=documents,
            chat_history=request.history,
        )

        # 3️⃣ Generate response from LLM
        answer = generate_answer(prompt)

        # 4️⃣ Format sources for frontend
        sources = [
            SourceChunk(
                id=str(doc.get("id")),
                score=float(doc.get("score", 0)),
                content=doc.get("content"),
            )
            for doc in documents
        ]

        return QueryResponse(
            answer=answer,
            sources=sources,
        )

    except Exception as e:
        import traceback
        print("\n===== RAG QUERY ERROR =====")
        traceback.print_exc()
        print("===== END ERROR =====\n")

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
