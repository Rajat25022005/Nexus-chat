import os
import logging
import asyncio
from groq import AsyncGroq
from groq import RateLimitError, APIError
from dotenv import load_dotenv

from app.core.config import GROQ_API_KEY, LLM_MODEL, LLM_TIMEOUT, LLM_MAX_RETRIES

load_dotenv()

logger = logging.getLogger(__name__)

# Initialize Groq client
client = AsyncGroq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None


async def generate_answer(prompt: str, temperature: float = 0.2) -> str:
    """
    Generate an answer using the LLM with timeout and retry logic.
    
    Args:
        prompt: The prompt to send to the LLM
        temperature: Temperature for generation (0.0-1.0)
    
    Returns:
        Generated answer string
    
    Raises:
        RuntimeError: If LLM generation fails after all retries
    """
    if not client:
        logger.error("Groq client not initialized - missing API key")
        return "AI service is not configured. Please check your API key settings."
    
    for attempt in range(LLM_MAX_RETRIES):
        try:
            logger.debug(f"LLM generation attempt {attempt + 1}/{LLM_MAX_RETRIES}")
            
            # Generate with timeout
            completion = await asyncio.wait_for(
                client.chat.completions.create(
                    model=LLM_MODEL,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=temperature,
                    max_tokens=2048,
                ),
                timeout=LLM_TIMEOUT
            )
            
            answer = completion.choices[0].message.content
            
            if not answer:
                logger.warning("Empty response from LLM")
                return "I apologize, but I couldn't generate a response. Please try again."
            
            logger.debug(f"LLM generation successful (attempt {attempt + 1})")
            return answer
            
        except asyncio.TimeoutError:
            logger.warning(f"LLM request timeout (attempt {attempt + 1}/{LLM_MAX_RETRIES})")
            if attempt == LLM_MAX_RETRIES - 1:
                return "The AI service is taking too long to respond. Please try again later."
            await asyncio.sleep(1 * (attempt + 1))  # Exponential backoff
            
        except RateLimitError as e:
            logger.warning(f"Rate limit hit: {e}")
            if attempt == LLM_MAX_RETRIES - 1:
                return "The AI service is currently at capacity. Please try again in a moment."
            await asyncio.sleep(2 * (attempt + 1))
            
        except APIError as e:
            logger.error(f"Groq API error: {e}")
            if attempt == LLM_MAX_RETRIES - 1:
                return "There was an issue with the AI service. Please try again later."
            await asyncio.sleep(1 * (attempt + 1))
            
        except Exception as e:
            logger.error(f"Unexpected error in LLM generation: {e}", exc_info=True)
            if attempt == LLM_MAX_RETRIES - 1:
                return "An unexpected error occurred. Please try again."
            await asyncio.sleep(1 * (attempt + 1))
    
    # This should never be reached, but just in case
    return "Failed to generate a response. Please try again."
