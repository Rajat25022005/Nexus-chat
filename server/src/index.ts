import express from 'express';
import type { Express, Request, Response } from 'express';

import http from 'http';
import { Server } from 'socket.io';

import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: "http://localhost:5173",
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());

// HTTP server
const server = http.createServer(app);

// 🔥 Socket.IO server (THIS WAS MISSING)
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Socket events
io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});

// Database Connection
const MONGO_URI = process.env.MONGO_URI || '';

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// Routes
app.get('/', (req: Request, res: Response) => {
  res.send('Nexus AI Backend is Running with TypeScript!');
});

// Start server (IMPORTANT)
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
