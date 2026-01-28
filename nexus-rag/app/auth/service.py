from datetime import datetime, timedelta
from jose import jwt
from passlib.context import CryptContext
from app.core.config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRE_MINUTES
import hashlib

# Password hashing context
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)

# -------------------------------------------------------------------
# -------------------------------------------------------------------
# Password utilities (hashing & verification)
# -------------------------------------------------------------------

def normalize_password(password: str) -> str:
    # Debug print
    print(f"DEBUG: normalizing password of len {len(password)}")
    hashed = hashlib.sha256(password.encode("utf-8")).hexdigest()
    print(f"DEBUG: normalized to {hashed}")
    return hashed

def hash_password(password: str) -> str:
    """Hash a password securely."""
    print(f"DEBUG: hash_password called for len {len(password)}")
    norm = normalize_password(password)
    print(f"DEBUG: passing {norm} to pwd_context")
    return pwd_context.hash(norm)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plain password against a hashed one."""
    return pwd_context.verify(normalize_password(plain), hashed)

# -------------------------------------------------------------------
# JWT utilities
# -------------------------------------------------------------------

def create_access_token(
    data: dict,
    expires_delta: timedelta | None = None
) -> str:
    """
    Create a JWT access token.

    :param data: Payload data (will be copied)
    :param expires_delta: Optional timedelta for expiry
    :return: Encoded JWT token
    """

    to_encode = data.copy()

    # Defensive type check (prevents your crash)
    if expires_delta is not None:
        if not isinstance(expires_delta, timedelta):
            raise TypeError("expires_delta must be datetime.timedelta")
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MINUTES)

    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow()
    })

    return jwt.encode(
        to_encode,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM
    )
