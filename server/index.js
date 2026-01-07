require('dotenv').config()
const { createServer } = require('http')
const { Server } = require('socket.io')
const axios = require('axios')

const httpServer = createServer()
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  }
})

const BACKEND_URL = process.env.BACKEND_URL || "https://nexus-backend-453285339762.europe-west1.run.app"

// Track active users in each room
const rooms = new Map() // roomId -> Set of socket.ids
const userSockets = new Map() // socket.id -> { userId, groupId, chatId }

io.on('connection', (socket) => {
  console.log(`✅ Client connected: ${socket.id}`)

  // Join a specific chat room
  socket.on('join_chat', ({ groupId, chatId, userId, token }) => {
    const roomId = `${groupId}:${chatId}`
    
    // Leave previous rooms
    Array.from(socket.rooms).forEach(room => {
      if (room !== socket.id) {
        socket.leave(room)
      }
    })

    // Join new room
    socket.join(roomId)
    
    // Track user
    userSockets.set(socket.id, { userId, groupId, chatId, token })
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set())
    }
    rooms.get(roomId).add(socket.id)

    console.log(`👤 User ${userId} joined room: ${roomId}`)
    console.log(`📊 Room ${roomId} now has ${rooms.get(roomId).size} users`)

    // Notify others in room
    socket.to(roomId).emit('user_joined', {
      userId,
      timestamp: new Date().toISOString()
    })

    // Send room info to user
    socket.emit('room_joined', {
      roomId,
      userCount: rooms.get(roomId).size
    })
  })

  // Handle new messages
  socket.on('send_message', async (data) => {
    const { groupId, chatId, content, userId, token, messageId } = data
    const roomId = `${groupId}:${chatId}`

    console.log(`📨 Message from ${userId} in ${roomId}: ${content.substring(0, 50)}...`)

    // Immediately broadcast to room (optimistic)
    io.to(roomId).emit('new_message', {
      id: messageId,
      role: 'user',
      content,
      userId,
      status: 'sent',
      timestamp: new Date().toISOString()
    })

    // Call backend to process AI response
    try {
      // Show typing indicator
      io.to(roomId).emit('typing_start', { userId: 'nexus_ai' })

      const response = await axios.post(
        `${BACKEND_URL}/api/query`,
        {
          query: content,
          group_id: groupId,
          chat_id: chatId,
          history: data.history || []
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      )

      // Stop typing indicator
      io.to(roomId).emit('typing_stop', { userId: 'nexus_ai' })

      // Broadcast AI response
      io.to(roomId).emit('new_message', {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: response.data.answer,
        userId: 'nexus_ai',
        status: 'sent',
        timestamp: new Date().toISOString(),
        sources: response.data.sources
      })

      console.log(`🤖 AI responded in ${roomId}`)

    } catch (error) {
      console.error('❌ Error processing message:', error.message)
      
      io.to(roomId).emit('typing_stop', { userId: 'nexus_ai' })
      
      io.to(roomId).emit('error', {
        message: 'Failed to get AI response',
        details: error.message
      })
    }
  })

  // Typing indicators
  socket.on('typing_start', () => {
    const userData = userSockets.get(socket.id)
    if (!userData) return

    const roomId = `${userData.groupId}:${userData.chatId}`
    socket.to(roomId).emit('user_typing', {
      userId: userData.userId,
      isTyping: true
    })
  })

  socket.on('typing_stop', () => {
    const userData = userSockets.get(socket.id)
    if (!userData) return

    const roomId = `${userData.groupId}:${userData.chatId}`
    socket.to(roomId).emit('user_typing', {
      userId: userData.userId,
      isTyping: false
    })
  })

  // Handle disconnection
  socket.on('disconnect', () => {
    const userData = userSockets.get(socket.id)
    
    if (userData) {
      const roomId = `${userData.groupId}:${userData.chatId}`
      
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id)
        
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId)
        }
      }

      socket.to(roomId).emit('user_left', {
        userId: userData.userId,
        timestamp: new Date().toISOString()
      })

      console.log(`👋 User ${userData.userId} left room: ${roomId}`)
    }

    userSockets.delete(socket.id)
    console.log(`❌ Client disconnected: ${socket.id}`)
  })
})

const PORT = process.env.PORT || 4000

httpServer.listen(PORT, () => {
  console.log(`🚀 Socket.IO server running on port ${PORT}`)
  console.log(`🔗 Accepting connections from: ${process.env.CLIENT_URL || "http://localhost:5173"}`)
  console.log(`🔗 Backend API: ${BACKEND_URL}`)
})