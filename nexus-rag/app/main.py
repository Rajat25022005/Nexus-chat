from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import socketio
import logging
import os
import uvicorn
import uvicorn

from app.auth.router import router as auth_router
from app.api.history import router as history_router
from app.api.ingest import router as ingest_router
from app.api.query import router as query_router
from app.api.messages import router as messages_router
from app.api.groups import router as groups_router
from app.socketio import sio
from app.core.config import ALLOWED_ORIGINS, RATE_LIMIT_ENABLED, RATE_LIMIT_PER_MINUTE, DEBUG
from app.core.middleware import RequestLoggingMiddleware, RateLimitMiddleware
from app.core.mongo import initialize_database, close_database, check_health

logger = logging.getLogger(__name__)

fastapi_app = FastAPI(title="Nexus RAG Service")

origins = [
    "https://nexus-backend-453285339762.europe-west1.run.app",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
]

# Configure CORS
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add request logging middleware
fastapi_app.add_middleware(RequestLoggingMiddleware)

# Socket.IO at /socket.io
#app.mount("/socket.io", socket_app)

# Include routers
fastapi_app.include_router(auth_router)
fastapi_app.include_router(query_router, prefix="/api")
fastapi_app.include_router(ingest_router, prefix="/api")
fastapi_app.include_router(messages_router)
fastapi_app.include_router(history_router)
fastapi_app.include_router(groups_router)


@fastapi_app.get("/")
def root():
    """Root endpoint"""
    return {
        "service": "Nexus RAG Service",
        "status": "running",
        "version": "1.0.0"
    }


@fastapi_app.get("/health")
def health():
    """Enhanced health check with database connectivity"""
    db_healthy = check_health()
    
    return {
        "status": "healthy" if db_healthy else "degraded",
        "database": "connected" if db_healthy else "disconnected",
        "service": "running"
    }


# Lifecycle events
@fastapi_app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    logger.info("=" * 50)
    logger.info("Starting Nexus RAG Service...")
    logger.info("=" * 50)
    
    # Initialize database with proper pooling
    try:
        initialize_database()
        logger.info("✓ Database initialized successfully")
    except Exception as e:
        logger.error(f"✗ Failed to initialize database: {e}")
        raise
    
    # Log registered routes for debugging
    logger.info("Registered routes:")
    for route in fastapi_app.routes:
        if hasattr(route, "methods") and hasattr(route, "path"):
            methods = ", ".join(route.methods)
            logger.info(f"  {methods:10} {route.path}")
    
    logger.info("=" * 50)
    logger.info("Nexus RAG Service started successfully!")
    logger.info("=" * 50)


@fastapi_app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down Nexus RAG Service...")
    close_database()
    logger.info("Shutdown complete")


# Error handlers
@fastapi_app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    """Handle 404 errors"""
    return JSONResponse(
        status_code=404,
        content={
            "error": "Not Found",
            "detail": f"The requested path '{request.url.path}' was not found",
            "path": request.url.path
        }
    )


@fastapi_app.exception_handler(500)
async def internal_error_handler(request: Request, exc):
    """Handle 500 errors"""
    logger.error(f"Internal server error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "detail": "An unexpected error occurred. Please try again later.",
            "request_id": getattr(request.state, "request_id", None)
        }
    )


@fastapi_app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle all unhandled exceptions"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "detail": str(exc) if DEBUG else "An unexpected error occurred",
            "request_id": getattr(request.state, "request_id", None)
        }
    )


# Wrap FastAPI with SocketIO
app = socketio.ASGIApp(sio, fastapi_app)

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8080))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
