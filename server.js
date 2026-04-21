const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, {
  cors: { origin: "*" }
});

// THIS IS THE CRITICAL PART:
// Use Render's port if available, otherwise use 3000 for local testing
const PORT = process.env.PORT || 3000;

io.on("connection", (socket) => {
  console.log("A player connected:", socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`Player joined room: ${roomId}`);
  });

  socket.on("send-move", (data) => {
    socket.to(data.roomId).emit("receive-move", data.move);
  });
});

// Tell the server to listen on the correct port
http.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
