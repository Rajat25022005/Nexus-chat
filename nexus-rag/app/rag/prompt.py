from typing import List
from app.api.query import ChatMessage


def build_prompt(
    user_query: str,
    retrieved_docs: List[dict],
    chat_history: List[ChatMessage],
) -> str:

    context_block = "\n".join(
        f"- {doc.get('content', '')}"
        for doc in retrieved_docs
        if doc.get("content")
    )

    history_block = "\n".join(
        f"{msg.role.upper()}: {msg.content}"
        for msg in chat_history
    )

    return f"""
You are Nexus AI, a strict context-aware assistant inside a collaborative workspace.

### CONTEXT:
{context_block if context_block else "No relevant context found."}

### CHAT HISTORY:
{history_block if history_block else "No prior conversation."}

### RULES:
1. You MUST answer using ONLY the CONTEXT.
2. Do NOT use outside knowledge.
3. If the answer is not present, say:
   "I don't have enough context."

### USER QUESTION:
{user_query}

### ANSWER:
""".strip()
