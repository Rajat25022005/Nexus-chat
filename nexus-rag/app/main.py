from dotenv import load_dotenv
load_dotenv()
from app.auth.router import router as auth_router


from fastapi import FastAPI
from app.api.ingest import router as ingest_router
from app.api.query import router as query_router
from fastapi.middleware.cors import CORSMiddleware
from app.api.messages import router as messages_router


app = FastAPI(
    title="Nexus RAG Service",
    description="Context-aware RAG backend for Nexus",
    version="0.1.0",
)

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
app.include_router(auth_router)
app.include_router(messages_router)


@app.get("/")
def root():
    return {"status": "Nexus RAG running"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.on_event("startup")
def debug_routes():
    print("=== REGISTERED ROUTES ===")
    for r in app.routes:
        print(r.path, r.methods)



