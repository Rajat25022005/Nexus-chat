from app.core.mongo import get_message_collection
import pprint

col = get_message_collection()
# Get last 50 messages
cursor = col.find().sort("created_at", -1).limit(50)

print(f"Total messages found: {col.count_documents({})}")
for msg in cursor:
    print("----------------")
    pprint.pprint(msg)
