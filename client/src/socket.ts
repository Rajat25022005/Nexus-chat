import { io } from "socket.io-client"

import { API_URL } from "./api/config"

export const socket = io(API_URL, {
  autoConnect: false,
  transports: ["websocket"],
  auth: {
    token: localStorage.getItem("nexus_token"),
  },
})
