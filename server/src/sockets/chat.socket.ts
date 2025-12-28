import { Server, Socket } from "socket.io"
import { askRag } from "../services/ragClient"

export function registerChatSocket(io: Server) {
  io.on("connection", (socket: Socket) => {
    console.log("User connected", socket.id)

    socket.on("join-room", (roomId: string) => {
      socket.join(roomId)
    })

    socket.on("message", async (payload) => {
      const { roomId, text } = payload

      // 1. Broadcast user message
      io.to(roomId).emit("message", {
        sender: "user",
        text
      })

      // 2. Call RAG
      try {
        const ragResponse = await askRag(roomId, text, [])

        // 3. Broadcast AI message
        io.to(roomId).emit("ai-message", {
          sender: "ai",
          text: ragResponse.answer,
          sources: ragResponse.context
        })
      } catch (err) {
        console.error("RAG error", err)
      }
    })

    socket.on("disconnect", () => {
      console.log("User disconnected", socket.id)
    })
  })
}
