from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import time
import logging
import uuid
from typing import Callable

logger = logging.getLogger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware to log all incoming requests and responses"""
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Generate unique request ID
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        
        # Log request
        start_time = time.time()
        logger.info(
            f"[{request_id}] {request.method} {request.url.path} - "
            f"Client: {request.client.host if request.client else 'unknown'}"
        )
        
        try:
            response = await call_next(request)
            
            # Log response
            process_time = time.time() - start_time
            logger.info(
                f"[{request_id}] Status: {response.status_code} - "
                f"Time: {process_time:.3f}s"
            )
            
            # Add request ID to response headers for debugging
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Process-Time"] = str(process_time)
            
            return response
            
        except Exception as e:
            process_time = time.time() - start_time
            logger.error(
                f"[{request_id}] Error: {str(e)} - Time: {process_time:.3f}s",
                exc_info=True
            )
            raise


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Simple in-memory rate limiting middleware.
    For production, consider using Redis-backed rate limiting.
    """
    
    def __init__(self, app, requests_per_minute: int = 60):
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self.request_counts: dict = {}  # {ip: [(timestamp, count)]}
        
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Get client IP
        client_ip = request.client.host if request.client else "unknown"
        
        # Skip rate limiting for health checks
        if request.url.path in ["/health", "/", "/docs", "/openapi.json"]:
            return await call_next(request)
        
        # Clean old entries (older than 1 minute)
        current_time = time.time()
        if client_ip in self.request_counts:
            self.request_counts[client_ip] = [
                (ts, count) for ts, count in self.request_counts[client_ip]
                if current_time - ts < 60
            ]
        
        # Count requests in the last minute
        if client_ip not in self.request_counts:
            self.request_counts[client_ip] = []
        
        total_requests = sum(count for _, count in self.request_counts[client_ip])
        
        if total_requests >= self.requests_per_minute:
            logger.warning(f"Rate limit exceeded for IP: {client_ip}")
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too many requests. Please try again later.",
                    "retry_after": 60
                }
            )
        
        # Add current request
        self.request_counts[client_ip].append((current_time, 1))
        
        return await call_next(request)
