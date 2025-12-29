from typing import List, Any

def build_prompt(
    user_query: str,
    retrieved_docs: list,
    chat_history: list,
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
You are Nexus AI, a helpful, intelligent collaboration assistant.

### DOCUMENT CONTEXT (optional):
{context_block if context_block else "No relevant documents available."}

### CHAT HISTORY:
{history_block if history_block else "No prior conversation."}

### BEHAVIOR RULES:
- If document context is available, use it.
- If document context is missing, answer normally using your general knowledge.
- You are allowed to write code, explain concepts, and help users.
- Only say "I don't have enough context" if the question truly cannot be answered.

### USER MESSAGE:
{user_query}

### ANSWER:
""".strip()
