# Nexus Workplace AI

![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

> **An Agentic Collaboration Platform featuring Real-time Messaging and Context-Aware AI.**

**Nexus** is a real-time collaboration workspace where AI is a first-class citizen. Unlike standard chat apps, Nexus uses **RAG (Retrieval-Augmented Generation)** to retain team context, allowing the AI assistant to answer questions based on historical conversations, decisions, and shared documents.

---

## Key Features

### Real-Time Collaboration
- **Instant Messaging:** Bi-directional low-latency communication powered by **Socket.io**.
- **Optimistic UI Updates:** Messages appear instantly on the sender's screen before server confirmation for a zero-latency feel.
- **Dynamic Rooms:** Support for multiple channels and private groups.

### Agentic AI Assistant (@NexusBot)
- **Context Retention (RAG):** Every message is vector-embedded and stored in **Pinecone/MongoDB Vector**.
- **Semantic Search:** The AI understands intent, not just keywords (e.g., query "The login bug" retrieves messages about "Auth Token Errors").
- **High-Speed Inference:** Powered by **Llama-3 via Groq API** for sub-second responses.
- **Task Extraction:** Automatically detects action items in chat (e.g., "I'll fix the navbar") and logs them.

### Enterprise-Grade DevOps
- **Cloud Native:** Fully hosted on **Microsoft Azure App Services**.
- **CI/CD Pipelines:** Automated build and deployment workflows via **GitHub Actions**.
- **Containerization:** Backend wrapped in **Docker** for consistent production environments.

---

## Tech Stack

| Domain | Technologies |
| :--- | :--- |
| **Frontend** | React.js (Vite), Tailwind CSS, Shadcn/UI, Redux Toolkit |
| **Backend** | Node.js, Express.js |
| **Real-Time** | Socket.io (WebSockets) |
| **Database** | MongoDB Atlas (NoSQL), Pinecone (Vector DB) |
| **AI Engine** | LangChain.js, Llama-3 (Groq API), OpenAI Embeddings |
| **DevOps** | Docker, Microsoft Azure, GitHub Actions |

---

## System Architecture

1.  **Ingestion:** User sends a message via React Client.
2.  **Broadcast:** `Socket.io` server pushes the message to all room participants immediately.
3.  **Persistence:** Message is asynchronously saved to **MongoDB**.
4.  **Embedding Pipeline:** 
    *   Text is sent to the Embedding Model.
    *   Vector is Upserted into **Pinecone** with metadata `{sender, timestamp, roomId}`.
5.  **RAG Query (@NexusBot):**
    *   User tags `@AI`.
    *   System performs **Cosine Similarity Search** on Pinecone.
    *   Retrieves top-k relevant past messages as context.
    *   **Llama-3** generates a response and streams it back to the chat.

---

## Getting Started (Local Setup)

### Prerequisites
- Node.js (v18+)
- MongoDB URI
- Pinecone API Key
- Groq or OpenAI API Key

### 1. Clone the Repository
```bash
git clone https://github.com/Rajat25022005/Nexus-Workplace-AI.git
cd Nexus-Workplace-AI
```
### 2. Backend Setup
```bash
cd server
npm install
```
## Create a .env file in the /server directory:
```bash
Env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
PINECONE_API_KEY=your_pinecone_key
PINECONE_INDEX=nexus-index
GROQ_API_KEY=your_groq_key
```
## Run the server:
```bash
Bash
npm run dev
```
### 3. Frontend Setup
```bash
cd client
npm install
npm run dev
```
### Access the app at http://localhost:5173
## Contributing
-  Contributions are welcome!
-  Fork the Project
-  Create your Feature Branch (git checkout -b feature/AmazingFeature)
-  Commit your Changes (git commit -m 'Add some AmazingFeature')
-  Push to the Branch (git push origin feature/AmazingFeature)
-  Open a Pull Request
