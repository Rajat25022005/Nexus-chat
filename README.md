# Nexus Workplace AI

**Build Status**: Passing  
**License**: MIT  

Nexus is an agentic collaboration platform that integrates real-time communication with context-aware artificial intelligence. It is designed to function as a shared workspace where AI operates as an active collaborator rather than a passive chatbot.

Unlike traditional chat applications, Nexus leverages Retrieval-Augmented Generation (RAG) and a Multi-Agent Orchestration system to retain organizational context, understand intent, and assist teams based on historical conversations, decisions, and shared knowledge.

---

## Key Features

### 🚀 Real-Time Collaboration
- **Instant Messaging**: Low-latency bi-directional communication using Socket.io.
- **Unified Workspaces**: Support for multiple groups and chat channels.
- **Personal & Shared Spaces**: 
    - **Personal Workspace**: A private area for your own notes and AI interactions, isolated from other users.
    - **Shared Groups**: Collaborative spaces for team discussions.
- **Thread Management**: Create, view, and **delete** chats and groups (with ownership controls).

### 🧠 Context-Aware AI Assistant
- **RAG Engine**: Retrieval-Augmented Generation for long-term memory.
- **Semantic Search**: Searches across historical conversations to provide relevant answers.
- **Fast Inference**: Sub-second responses using Llama-3 via Groq API.
- **Contextual Understanding**: Responses are grounded in prior discussions, reducing hallucinations.

### 🛡️ Enterprise-Ready Architecture
- **Secure Authentication**: JWT-based login and session management.
- **Scalable Backend**: Built with FastAPI and MongoDB.
- **Vector Search**: Integrated vector database for semantic memory.
- **Containerized**: Fully Dockerized for easy deployment.

---

## System Architecture

1.  **Frontend**: React (TypeScript) + Vite -> Handles UI and Socket.io client.
2.  **Backend**: FastAPI -> Manages API endpoints (`/groups`, `/auth`) and Socket.io events (`new_message`, `typing`).
3.  **Database**: 
    - **MongoDB**: Stores Users, Groups, Chats, and Messages.
    - **Vector Store**: Stores message embeddings for RAG.
4.  **AI Engine**:
    - **Retriever**: Fetches relevant context from MongoDB.
    - **LLM**: Groq API (Llama-3) generates responses based on context + query.

---

## Tech Stack

### Frontend
- **Framework**: React.js with Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Real-time**: Socket.io Client

### Backend
- **Framework**: FastAPI (Python)
- **Real-time**: Socket.io (ASGI)
- **Database**: MongoDB (Motor async driver)
- **AI/ML**: Sentence Transformers (Embeddings), Groq API (Inference)

---

## Getting Started (Local Setup)

### Prerequisites
- Python 3.10+
- Node.js 18+
- MongoDB (running locally or via Docker)
- Groq API Key

### 1. Clone the Repository
```bash
git clone https://github.com/Rajat25022005/Nexus-Workplace-AI.git
cd Nexus-Workplace-AI
```

### 2. Environment Setup
Create a `.env` file in `nexus-rag/` with the following:
```env
MONGO_URI=mongodb://localhost:27017
DB_NAME=nexus
JWT_SECRET_KEY=your_secret_key
GROQ_API_KEY=your_groq_api_key
```

### 3. Quick Start
You can run the entire stack (Backend + Frontend) using the provided helper script:

```bash
# Make the script executable
chmod +x start.sh

# Run the application
./start.sh
```
This script will:
- Set up a Python virtual environment.
- Install backend dependencies.
- Install frontend dependencies (`npm install`).
- Start the FastAPI backend server.
- Start the React frontend development server.

### 4. Manual Setup (Optional)

**Backend:**
```bash
cd nexus-rag
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd client
npm install
npm run dev
```

---

## Usage Guide

1.  **Register/Login**: Create an account to access the platform.
2.  **Personal Space**: You land in your "Personal" group. Use this for private brainstorming with the AI.
3.  **Create Groups**: Use the "+" button to create shared groups for your team.
4.  **Invites**: Share the Group ID (visible in the sidebar for shared groups) to let others join.
5.  **Chat with AI**: The AI ("Nexus") monitors conversations and replies when addressed or when it has relevant context. You can also toggle AI processing on/off.
6.  **Manage Content**: As an owner, you can delete groups or chats you created using the delete icons in the sidebar.

---

## Roadmap
- [ ] File attachments and parsing
- [ ] User presence indicators (Online/Offline)
- [ ] Voice interface
- [ ] Slack/Discord integration bridges

---

**License**: MIT
