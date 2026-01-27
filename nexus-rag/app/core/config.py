import os
import logging
from dotenv import load_dotenv

load_dotenv()

# ============ JWT Configuration ============
JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))

# Validate critical JWT settings
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is not set in .env - this is required for security")

# ============ OAuth Configuration ============
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")


# ============ MongoDB Configuration ============
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "nexus")
VECTOR_COLLECTION_NAME = os.getenv("VECTOR_COLLECTION_NAME", "memory_vectors")

# MongoDB Connection Pool Settings
MONGO_MAX_POOL_SIZE = int(os.getenv("MONGO_MAX_POOL_SIZE", "50"))
MONGO_MIN_POOL_SIZE = int(os.getenv("MONGO_MIN_POOL_SIZE", "10"))
MONGO_SERVER_SELECTION_TIMEOUT_MS = int(os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "5000"))

if not MONGO_URI:
    raise RuntimeError("MONGO_URI is not set in .env")

# ============ AI/LLM Configuration ============
EMBEDDING_MODEL = os.getenv(
    "EMBEDDING_MODEL",
    "sentence-transformers/all-MiniLM-L6-v2",
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "30"))  # seconds
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))

if not GROQ_API_KEY:
    logging.warning("GROQ_API_KEY is not set - AI features will not work")

# ============ Application Settings ============
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
DEBUG = os.getenv("DEBUG", "true").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# ============ Rate Limiting ============
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))

# ============ CORS Configuration ============
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174,https://www.nexusainow.online,https://nexusainow.online,nexus-ai-483013.firebaseapp.com"
).split(",")

# Add production origin if set
PRODUCTION_ORIGIN = os.getenv("PRODUCTION_ORIGIN")
if PRODUCTION_ORIGIN:
    ALLOWED_ORIGINS.append(PRODUCTION_ORIGIN)

# ============ Logging Configuration ============
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper()),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
    ]
)

logger = logging.getLogger(__name__)

# ============ SMTP Configuration ============
MAIL_USERNAME = os.getenv("MAIL_USERNAME")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")
MAIL_FROM = os.getenv("MAIL_FROM")
MAIL_PORT = int(os.getenv("MAIL_PORT", "587"))
MAIL_SERVER = os.getenv("MAIL_SERVER")

if not MAIL_USERNAME or not MAIL_PASSWORD:
    logging.warning("SMTP credentials not set - Email features will not work")

logger.info(f"Configuration loaded - Environment: {ENVIRONMENT}, Debug: {DEBUG}")
