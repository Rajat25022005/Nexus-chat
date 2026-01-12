import { io } from "socket.io-client"

export const socket = io("https://nexus-backend-453285339762.europe-west1.run.app", {
  autoConnect: false,
  transports: ["websocket"],
  auth: {
    token: localStorage.getItem("nexus_token"),
  },
})
