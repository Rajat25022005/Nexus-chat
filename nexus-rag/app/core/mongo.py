from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
import logging
from typing import Optional
from contextlib import contextmanager

from app.core.config import (
    MONGO_URI,
    MONGO_DB_NAME,
    VECTOR_COLLECTION_NAME,
    MONGO_MAX_POOL_SIZE,
    MONGO_MIN_POOL_SIZE,
    MONGO_SERVER_SELECTION_TIMEOUT_MS,
)

logger = logging.getLogger(__name__)

# Global client instance (singleton pattern)
_client: Optional[MongoClient] = None
_db = None


def initialize_database():
    """
    Initialize MongoDB connection with proper pooling settings.
    Should be called on application startup.
    """
    global _client, _db
    
    if _client is not None:
        logger.warning("Database already initialized")
        return
    
    try:
        logger.info("Initializing MongoDB connection...")
        _client = MongoClient(
            MONGO_URI,
            maxPoolSize=MONGO_MAX_POOL_SIZE,
            minPoolSize=MONGO_MIN_POOL_SIZE,
            serverSelectionTimeoutMS=MONGO_SERVER_SELECTION_TIMEOUT_MS,
            retryWrites=True,
            retryReads=True,
            connectTimeoutMS=10000,
            socketTimeoutMS=30000,
        )
        
        # Verify connection
        _client.admin.command('ping')
        _db = _client[MONGO_DB_NAME]
        
        logger.info(f"MongoDB connected successfully to database: {MONGO_DB_NAME}")
        
        # Create indexes for performance
        _create_indexes()
        
    except (ConnectionFailure, ServerSelectionTimeoutError) as e:
        logger.error(f"Failed to connect to MongoDB: {e}")
        raise RuntimeError(f"Could not connect to MongoDB: {e}")
    except Exception as e:
        logger.error(f"Unexpected error during MongoDB initialization: {e}")
        raise


def _create_indexes():
    """Create database indexes for optimal query performance"""
    try:
        logger.info("Creating database indexes...")
        
        # Messages collection indexes
        messages_col = _db["messages"]
        messages_col.create_index([("user_id", ASCENDING), ("group_id", ASCENDING), ("chat_id", ASCENDING)])
        messages_col.create_index([("created_at", DESCENDING)])
        messages_col.create_index([("group_id", ASCENDING), ("chat_id", ASCENDING), ("created_at", DESCENDING)])
        
        # Users collection indexes
        users_col = _db["users"]
        users_col.create_index([("email", ASCENDING)], unique=True)
        users_col.create_index([("username", ASCENDING)], unique=True)
        
        # Groups collection indexes
        groups_col = _db["groups"]
        groups_col.create_index([("user_id", ASCENDING)])
        groups_col.create_index([("user_id", ASCENDING), ("is_personal", ASCENDING)])
        
        # Vector collection indexes
        vector_col = _db[VECTOR_COLLECTION_NAME]
        vector_col.create_index([("group_id", ASCENDING), ("chat_id", ASCENDING)])
        vector_col.create_index([("created_at", DESCENDING)])
        
        logger.info("Database indexes created successfully")
        
    except Exception as e:
        logger.error(f"Error creating indexes: {e}")
        # Don't raise - indexes are optimization, not critical


def close_database():
    """
    Close MongoDB connection.
    Should be called on application shutdown.
    """
    global _client
    
    if _client is not None:
        logger.info("Closing MongoDB connection...")
        _client.close()
        _client = None
        logger.info("MongoDB connection closed")


def check_health() -> bool:
    """
    Check if database connection is healthy.
    Returns True if healthy, False otherwise.
    """
    try:
        if _client is None:
            return False
        _client.admin.command('ping')
        return True
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return False


def get_db():
    """Get database instance"""
    if _db is None:
        raise RuntimeError("Database not initialized. Call initialize_database() first.")
    return _db


def get_vector_collection():
    """Get vector collection instance"""
    db = get_db()
    return db[VECTOR_COLLECTION_NAME]


def get_message_collection():
    """Get messages collection instance"""
    db = get_db()
    return db["messages"]


def get_users_collection():
    """Get users collection instance"""
    db = get_db()
    return db["users"]


def get_groups_collection():
    """Get groups collection instance"""
    db = get_db()
    return db["groups"]


@contextmanager
def get_db_context():
    """
    Context manager for safe database access with automatic error handling.
    
    Usage:
        with get_db_context() as db:
            db.collection.find(...)
    """
    try:
        yield get_db()
    except Exception as e:
        logger.error(f"Database operation error: {e}")
        raise