import { io } from "socket.io-client"

export const socket = io(import.meta.env.VITE_API_URL || "https://nexus-backend-453285339762.europe-west1.run.app", {
  autoConnect: false,
  transports: ["websocket"],
  auth: {
    token: localStorage.getItem("nexus_token"),
  },
})
