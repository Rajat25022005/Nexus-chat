from datetime import datetime, timedelta
from jose import jwt
from passlib.context import CryptContext
from app.core.config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRE_MINUTES
import hashlib

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def normalize_password(password: str) -> str:
    """Pre-hash password with SHA-256 to ensure it fits within bcrypt's 72-byte limit."""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return pwd_context.hash(normalize_password(password))


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(normalize_password(plain), hashed)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
