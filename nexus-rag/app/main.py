from dotenv import load_dotenv
load_dotenv()  # 👈 MUST BE FIRST

from fastapi import FastAPI
from app.api.ingest import router as ingest_router
from app.api.query import router as query_router
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Nexus RAG Service",
    description="Context-aware RAG backend for Nexus",
    version="0.1.0",
)
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(query_router, prefix="/api", tags=["Query"])
app.include_router(ingest_router, prefix="/api", tags=["Ingest"])

@app.get("/")
def root():
    return {"status": "Nexus RAG running"}

@app.get("/health")
def health():
    return {"status": "ok"}
