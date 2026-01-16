
from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv("nexus-rag/.env")

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
client = MongoClient(MONGO_URI)
db = client.nexus
messages = list(db.messages.find({}, {"content": 1, "group_id": 1}).limit(20))

print("--- Messages in DB ---")
for m in messages:
    print(f"[{m.get('group_id')}] {m.get('content')}")
