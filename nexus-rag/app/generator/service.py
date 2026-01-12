from app.generator.prompt import build_prompt
from app.generator.llm import generate_answer
from app.core.conversation_analyzer import analyze_conversation
from app.core.ai_policy import should_ai_interject


async def maybe_answer(
    context: list[str],
    question: str | None,
    mode: str = "observer",
    recent_ai_messages: int = 0,
) -> str | None:

    if mode == "direct":
        prompt = build_prompt(context, question)
        return await generate_answer(prompt)

    signals = analyze_conversation(context)

    if not should_ai_interject(signals, recent_ai_messages):
        return None 

    prompt = build_prompt(
        context=context,
        question="Provide a helpful, neutral intervention."
    )

    return await generate_answer(prompt)
