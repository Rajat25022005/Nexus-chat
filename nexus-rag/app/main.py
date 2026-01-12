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
import socketio
from app.socketio import sio

from app.api.groups import router as groups_router

import uvicorn
import os

app = FastAPI(title="Nexus RAG Service")

origins = [
    "https://nexus-backend-453285339762.europe-west1.run.app",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174"
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

@app.get("/")
def root():
    return {"status": "running"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.on_event("startup")
def debug_routes():
    print("=== REGISTERED ROUTES ===")
    for r in fastapi_app.routes:
        if isinstance(r, APIRoute):
            print(r.path, r.methods)
        else:
            print(r.path, None)

# Wrap FastAPI with SocketIO
# 'app' here will be the ASGI app that uvicorn runs
# We rename the FastAPI instance to 'fastapi_app' internally usually, but 
# since uvicorn looks for 'app', we can do:
# fastapi_app = app
# app = ...
# But strictly, 'app' above is used for decorators.
# So we will do:

fastapi_app = app
app = socketio.ASGIApp(sio, fastapi_app)

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8080))
    # We must run the 'app' object which is now the encapsulated one
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
