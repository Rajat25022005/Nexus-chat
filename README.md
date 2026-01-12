# Nexus Workplace AI

Build Status: Passing  
License: MIT  

Nexus is an agentic collaboration platform that integrates real-time communication with context-aware artificial intelligence. It is designed to function as a shared workspace where AI operates as an active collaborator rather than a passive chatbot.

Unlike traditional chat applications, Nexus leverages Retrieval-Augmented Generation (RAG) and a Multi-Agent Orchestration system to retain organizational context, understand intent, and assist teams based on historical conversations, decisions, and shared knowledge.

---

## Key Features

### Real-Time Collaboration
- Instant messaging with low-latency bi-directional communication using Socket.io
- Optimistic UI updates for immediate user feedback
- Support for multiple workspaces, groups, and chat channels

### Context-Aware AI Assistant
- Retrieval-Augmented Generation (RAG) for long-term memory
- Semantic search across historical conversations and documents
- Context-aware responses grounded in prior discussions
- Sub-second inference using Llama-3 via Groq API

### Multi-Agent Orchestration
- Distributed AI agents with specialized responsibilities
- Intent analysis and task delegation
- Collaborative reasoning and response synthesis
- Policy-driven and context-aware AI intervention

### Enterprise-Ready Architecture
- Secure JWT-based authentication
- Scalable backend architecture
- Containerized deployment using Docker
- CI/CD ready design

---

## Multi-Agent Orchestrator

Nexus implements a Multi-Agent Orchestration System that enables multiple specialized AI agents to collaborate on a single task. Instead of relying on a single monolithic AI model, Nexus dynamically assigns responsibilities to agents optimized for specific functions.

### Core Agents

| Agent | Responsibility |
|------|---------------|
| Coordinator Agent | Interprets user intent and plans execution |
| Retriever Agent | Performs semantic search over vector databases |
| Reasoning Agent | Conducts logical reasoning and synthesis |
| Action Agent | Executes side effects such as task logging |
| Validator Agent | Ensures correctness and reduces hallucinations |
| Observer Agent | Monitors conversations and intervenes when needed |

Agents operate independently but share structured context through the orchestrator.

---

### Agent Execution Flow

1. User submits a message or request
2. Coordinator Agent analyzes intent and creates an execution plan
3. Retriever Agent fetches relevant historical context
4. Reasoning Agent synthesizes insights
5. Validator Agent verifies contextual alignment
6. Action Agent executes required operations
7. The final response is delivered to the user in real time

---

### Safety and Control

- Policy-driven AI interventions based on conversation signals
- Strict context grounding to prevent hallucinations
- Rate-limited AI participation to avoid disruption
- Human-in-the-loop escalation when confidence is low

---

## System Architecture Overview

1. User sends a message via the frontend client
2. Socket.io broadcasts the message in real time
3. Message is asynchronously stored in MongoDB
4. Message is embedded and stored in a vector database
5. When AI is invoked:
   - Relevant context is retrieved using vector similarity search
   - Prompt is constructed using retrieved context and chat history
   - LLM generates a response
6. AI response is streamed back to the client

---

## Tech Stack

### Frontend
- React.js with Vite
- TypeScript
- Tailwind CSS
- Socket.io Client

### Backend
- FastAPI (Python)
- Socket.io (ASGI)
- JWT Authentication
- MongoDB

### AI and Data
- Sentence Transformers for embeddings
- MongoDB Vector Search
- Groq API with Llama-3
- Retrieval-Augmented Generation

### DevOps
- Docker
- GitHub Actions
- Cloud-ready architecture

---

## Getting Started (Local Setup)

### Prerequisites
- Python 3.10 or higher
- Node.js 18 or higher
- MongoDB (local or Atlas)
- Groq API key

---

### Backend Setup

Clone the repository and navigate to the backend directory.

```bash
git clone https://github.com/Rajat25022005/Nexus-Workplace-AI.git
cd Nexus-Workplace-AI
