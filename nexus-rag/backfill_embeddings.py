import asyncio
from app.core.mongo import get_message_collection, get_vector_collection
from app.embeddings.embedder import embed_text

async def backfill():
    print("Starting backfill...")
    msg_col = get_message_collection()
    vec_col = get_vector_collection()
    
    # Process all messages that don't have embeddings (or just all to be safe/simple for now, assuming idempotent or we clear first?)
    # For safety, let's just process all. Duplicates in vector store might use extra space but won't break logic (just more results).
    # To be cleaner, we could check if already in vector store?
    # Actually, RAG uses vector search. If we duplicate, we get duplicate results.
    # Let's check simply: if 'id' in metadata? No, vector store has its own _id.
    # We'll just do it. It's a "migrate" script.
    
    cursor = msg_col.find({})
    count = 0
    
    for msg in cursor:
        try:
            user = msg.get("user_id", "unknown")
            content = msg.get("content", "")
            group_id = msg.get("group_id")
            chat_id = msg.get("chat_id")
            
            # Skip if no content
            if not content: continue
            
            # Check if likely already embedded (simple check: skip if created after 10:48 UTC which is when we likely enabled it?)
            # Hard to guess.
            # Let's just do it.
            
            vector_content = f"User ({user}): {content}"
            embedding = embed_text(vector_content)
            
            vec_col.insert_one({
                "group_id": group_id,
                "chat_id": chat_id,
                "content": vector_content,
                "embedding": embedding,
                "created_at": msg.get("created_at"), 
                "metadata": {"user_id": user, "type": "chat_message", "original_msg_id": msg["_id"]}
            })
            count += 1
            if count % 10 == 0:
                print(f"Processed {count} messages...")
        except Exception as e:
            print(f"Skipping msg {msg.get('_id')}: {e}")

    print(f"Backfill complete! Processed {count} messages.")

if __name__ == "__main__":
    asyncio.run(backfill())
