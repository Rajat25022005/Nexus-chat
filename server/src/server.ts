import express from "express"
import http from "http"
import { Server } from "socket.io"
import cors from "cors"
import dotenv from "dotenv"
import { registerChatSocket } from "./sockets/chat.socket.js";

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const server = http.createServer(app)

const io = new Server(server, {
  cors: { origin: "*" }
})

registerChatSocket(io)

app.get("/health", (_, res) => {
  res.json({ status: "backend ok" })
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
})
