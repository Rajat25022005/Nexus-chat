from app.generator.prompt import build_prompt
from app.generator.llm import generate_answer

def answer_query(context: list[str], question: str) -> str:
    prompt = build_prompt(context, question)
    return generate_answer(prompt)
