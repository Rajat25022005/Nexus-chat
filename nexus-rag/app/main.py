from fastapi import FastAPI
from app.api.ingest import router as ingest_router
from app.api.query import router as query_router

app = FastAPI(
    title="Nexus RAG Service",
    description="Context-aware RAG backend for Nexus",
    version="0.1.0",
)

# Routers
app.include_router(ingest_router, prefix="/rag", tags=["Ingest"])
app.include_router(query_router, prefix="/rag", tags=["Query"])


@app.get("/health")
def health():
    return {"status": "ok"}
