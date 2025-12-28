import os
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "nexus")
VECTOR_COLLECTION_NAME = os.getenv(
    "VECTOR_COLLECTION_NAME", "memory_vectors"
)

EMBEDDING_MODEL = os.getenv(
    "EMBEDDING_MODEL",
    "sentence-transformers/all-MiniLM-L6-v2",
)

if not MONGO_URI:
    raise RuntimeError("MONGO_URI is not set in .env")
