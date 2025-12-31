from pymongo import MongoClient

from app.core.config import (
    MONGO_URI,
    MONGO_DB_NAME,
    VECTOR_COLLECTION_NAME,
)
_client = MongoClient(MONGO_URI)
_db = _client[MONGO_DB_NAME]

def get_db():
    return _db

def get_vector_collection():
    return _db[VECTOR_COLLECTION_NAME]

def get_message_collection():
    return _db["messages"]