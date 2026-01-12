from app.core.mongo import get_message_collection
import datetime

col = get_message_collection()
pipeline = [
    {"$group": {"_id": "$group_id", "count": {"$sum": 1}}}
]
for doc in col.aggregate(pipeline):
    print(f"Group: {doc['_id']} | Count: {doc['count']}")
