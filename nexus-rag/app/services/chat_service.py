from datetime import datetime
import logging
import asyncio

from app.core.mongo import get_message_collection
from app.rag.retriever import retrieve_context
from app.generator.prompt import build_prompt
from app.generator.service import generate_answer

logger = logging.getLogger(__name__)


async def process_chat_message(
    user_query: str,
    group_id: str,
    chat_id: str,
    user_email: str,
    history: list = []
):
    """
    Core RAG logic for processing chat messages.
    
    1. Retrieve relevant context from vector store
    2. Build prompt with context and history
    3. Generate AI response
    4. Store response in database
    
    Args:
        user_query: The user's input message
        group_id: Group identifier
        chat_id: Chat identifier
        user_email: User's email (from JWT)
        history: List of recent messages for context
    
    Returns:
        Tuple of (answer, retrieved_documents)
    """
    try:
        logger.debug(f"Processing chat message for user: {user_email}")
        
        # 1. Retrieve Context (Run in executor to avoid blocking)
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
    )

    # 1.5 Fetch Group Members (Context)
    from app.core.mongo import get_db
    import bson
    db = get_db()
    
    group_members = []
    try:
        if group_id.startswith("personal_"):
            # Personal group implies strict 1-on-1 with self/AI
             # Extract email from personal_email
             # But usually personal groups don't have multiple members.
             # Just default to [user_email]? Or parse ID.
             # Actually, best to just say [user_email] for personal.
             group_members = [user_email]
        else:
            # Regular group
            oid = bson.ObjectId(group_id)
            group_doc = db.groups.find_one({"_id": oid})
            if group_doc:
                group_members = group_doc.get("members", [])
                if not group_members and group_doc.get("user_id"):
                    # Fallback for old groups without members list
                     group_members = [group_doc["user_id"]]
    except Exception as e:
        print(f"Error fetching group members: {e}")
        group_members = [user_email] # Fallback

    # 2. Build Prompt
    prompt = build_prompt(
        user_query=user_query,
        retrieved_docs=documents,
        chat_history=history,
        group_members=group_members
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
