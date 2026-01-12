from datetime import datetime
from app.core.mongo import get_message_collection
from app.rag.retriever import retrieve_context
from app.generator.prompt import build_prompt
from app.generator.service import generate_answer

async def process_chat_message(user_query: str, group_id: str, chat_id: str, user_email: str, history: list = []):
    """
    Core RAG logic:
    1. Store user message (if not already stored by the caller, but here we assume we do it if needed, or caller does it.
       Actually, socketio.py stores it before broadcasting. query.py stores it too.
       To avoid duplication, let's let this service handle the AI generation part mostly.
       But query.py uses it for the whole flow.
       Let's design it to generate the ANSWER and store the ANSWER.
    """
    
    # 1. Retrieve Context (Run in thread to avoid blocking loop with embeddings/mongo)
    import asyncio
    loop = asyncio.get_running_loop()
    
    documents = await loop.run_in_executor(
        None, 
        lambda: retrieve_context(
            query=user_query,
            group_id=group_id,
            chat_id=chat_id,
            top_k=5,
        )
    )

    # 2. Build Prompt
    prompt = build_prompt(
        user_query=user_query,
        retrieved_docs=documents,
        chat_history=history,
    )

    # 3. Generate Answer
    answer = await generate_answer(prompt)

    # 4. Store Assistant Message
    messages_col = get_message_collection()
    messages_col.insert_one({
        "user_id": user_email, # OR "system" / "assistant" - but the schema seems to track who "owned" the interaction? 
                               # In query.py it uses user['email'] for assistant msg too. adapting that.
        "group_id": group_id,
        "chat_id": chat_id,
        "role": "assistant",
        "content": answer,
        "created_at": datetime.utcnow(),
    })

    return answer, documents
