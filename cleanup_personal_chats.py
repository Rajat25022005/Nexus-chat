
from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv("nexus-rag/.env")

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
client = MongoClient(MONGO_URI)
db = client.nexus

# Delete messages in 'personal' group
result = db.messages.delete_many({"group_id": "personal"})

print(f"Deleted {result.deleted_count} messages from 'personal' group.")
