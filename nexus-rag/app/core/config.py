import os
import logging
from dotenv import load_dotenv
from typing import List

# Load environment variables early
load_dotenv()

# =========================================================
# ENVIRONMENT
# =========================================================

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

# =========================================================
# LOGGING
# =========================================================

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

logger = logging.getLogger("nexus.config")

logger.info(f"Loading configuration | env={ENVIRONMENT} | debug={DEBUG}")

# =========================================================
# SECURITY / JWT
# =========================================================

JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))

if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is required and must be set")

# =========================================================
# OAUTH
# =========================================================

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")

if GOOGLE_CLIENT_ID and not GOOGLE_CLIENT_SECRET:
    logger.warning("GOOGLE_CLIENT_SECRET missing – Google OAuth will fail")

# =========================================================
# DATABASE (MongoDB)
# =========================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "nexus")
VECTOR_COLLECTION_NAME = os.getenv("VECTOR_COLLECTION_NAME", "memory_vectors")

MONGO_MAX_POOL_SIZE = int(os.getenv("MONGO_MAX_POOL_SIZE", "50"))
MONGO_MIN_POOL_SIZE = int(os.getenv("MONGO_MIN_POOL_SIZE", "10"))
MONGO_SERVER_SELECTION_TIMEOUT_MS = int(
    os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "5000")
)

if not MONGO_URI:
    raise RuntimeError("MONGO_URI is required and must be set")

# =========================================================
# AI / LLM
# =========================================================

EMBEDDING_MODEL = os.getenv(
    "EMBEDDING_MODEL",
    "sentence-transformers/all-MiniLM-L6-v2",
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "30"))
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))

if not GROQ_API_KEY:
    logger.warning("GROQ_API_KEY not set – AI features will be disabled")

# =========================================================
# RATE LIMITING
# =========================================================

RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))

# =========================================================
# CORS (FIXED & SAFE)
# =========================================================

def _parse_origins(raw: str) -> List[str]:
    return [o.strip() for o in raw.split(",") if o.strip()]

# Default origins that should always be allowed
DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://www.nexusainow.online",
    "https://nexusainow.online",
    "https://nexus-ai-483013.firebaseapp.com"
]

ALLOWED_ORIGINS: List[str] = [o for o in DEFAULT_ORIGINS]

# From ALLOWED_ORIGINS env
raw_origins = os.getenv("ALLOWED_ORIGINS", "")
if raw_origins:
    env_origins = _parse_origins(raw_origins)
    for origin in env_origins:
        if origin not in ALLOWED_ORIGINS:
            ALLOWED_ORIGINS.append(origin)

# Explicit production origin
PRODUCTION_ORIGIN = os.getenv("PRODUCTION_ORIGIN")
if PRODUCTION_ORIGIN and PRODUCTION_ORIGIN not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(PRODUCTION_ORIGIN.strip())

if not raw_origins and not PRODUCTION_ORIGIN:
    logger.info("ALLOWED_ORIGINS not set – using default allowed origins")

logger.info(f"CORS allowed origins: {ALLOWED_ORIGINS}")

# =========================================================
# SMTP / EMAIL
# =========================================================

MAIL_USERNAME = os.getenv("MAIL_USERNAME")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")
MAIL_FROM = os.getenv("MAIL_FROM")
MAIL_PORT = int(os.getenv("MAIL_PORT", "587"))
MAIL_SERVER = os.getenv("MAIL_SERVER")

if MAIL_USERNAME and not MAIL_PASSWORD:
    logger.warning("MAIL_PASSWORD missing – email sending will fail")

# =========================================================
# FINAL CONFIG SUMMARY (NON-SENSITIVE)
# =========================================================

logger.info("Configuration loaded successfully")
