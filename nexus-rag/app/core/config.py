import os
from dotenv import load_dotenv

load_dotenv()

ENV = os.getenv("ENV", "dev")
