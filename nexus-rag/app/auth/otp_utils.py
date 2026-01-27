import secrets
import hashlib
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM, MAIL_PORT, MAIL_SERVER
from email_validator import validate_email, EmailNotValidError

logger = logging.getLogger(__name__)

def validate_email_address(email: str) -> bool:
    """
    Validate email address format and deliverability (DNS check).
    Raises ValueError if invalid.
    """
    try:
        # check_deliverability=True performs DNS checks (MX records)
        validate_email(email, check_deliverability=True)
        return True
    except EmailNotValidError as e:
        # Determine if it's a format error or DNS error for better logging
        logger.warning(f"Email validation failed for {email}: {str(e)}")
        raise ValueError(str(e))

def generate_otp(length: int = 6) -> str:
    """Generate a secure numeric OTP of given length."""
    return "".join(secrets.choice("0123456789") for _ in range(length))

def hash_otp(otp: str) -> str:
    """Hash the OTP using SHA256 for secure storage."""
    return hashlib.sha256(otp.encode()).hexdigest()

def verify_otp_hash(otp: str, hashed_otp: str) -> bool:
    """Verify if the provided OTP matches the stored hash."""
    return hash_otp(otp) == hashed_otp

def send_email(to_email: str, subject: str, body: str):
    """Send an email via SMTP."""
    if not MAIL_USERNAME or not MAIL_PASSWORD:
        logger.warning(f"SMTP not configured. Mocking email to {to_email}: {subject}")
        return

    try:
        msg = MIMEMultipart()
        msg['From'] = MAIL_FROM
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        server = smtplib.SMTP(MAIL_SERVER, MAIL_PORT)
        server.starttls()
        server.login(MAIL_USERNAME, MAIL_PASSWORD)
        text = msg.as_string()
        server.sendmail(MAIL_FROM, to_email, text)
        server.quit()
        logger.info(f"Email sent successfully to {to_email}")
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        # In production, you might want to retry or raise, 
        # but for now we log error so we don't crash main flow if SMTP flaky
        raise e
