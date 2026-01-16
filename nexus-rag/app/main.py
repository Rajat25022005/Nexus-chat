from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute

from app.auth.router import router as auth_router
from app.api.history import router as history_router
from app.api.ingest import router as ingest_router
from app.api.query import router as query_router
from app.api.messages import router as messages_router
from app.socketio import socket_app

from app.api.groups import router as groups_router

import uvicorn
import os

app = FastAPI(title="Nexus RAG Service")

origins = [
    "https://nexus-backend-453285339762.europe-west1.run.app",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ... (routes remain)
app.include_router(query_router, prefix="/api")
app.include_router(ingest_router, prefix="/api")
app.include_router(messages_router)
app.include_router(history_router)
app.include_router(auth_router)
app.include_router(groups_router)

# Socket.IO at /socket.io
app.mount("/socket.io", socket_app)

@app.get("/")
def root():
    return {"status": "running"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.on_event("startup")
def debug_routes():
    print("=== REGISTERED ROUTES ===")
    for r in app.routes:
        if isinstance(r, APIRoute):
            print(r.path, r.methods)
        else:
            print(r.path, None)

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
