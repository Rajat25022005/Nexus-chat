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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(query_router, prefix="/api")
app.include_router(ingest_router, prefix="/api")
app.include_router(messages_router)
app.include_router(history_router)
app.include_router(auth_router)
app.include_router(groups_router)

# Socket.IO at root
app.mount("/", socket_app)

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
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000)
