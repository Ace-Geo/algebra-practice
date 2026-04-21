const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const roomSettings = {}; 

io.on("connection", (socket) => {
    socket.on("join-room", (data) => {
        const { password, name, mins } = data;
        const room = io.sockets.adapter.rooms.get(password);
        const numClients = room ? room.size : 0;
        const safeName = name || "Anonymous";

        if (numClients === 0) {
            socket.join(password);
            roomSettings[password] = { 
                mins: mins || 10, 
                whiteName: safeName 
            };
            socket.emit("player-assignment", { 
                color: "white", 
                settings: roomSettings[password] 
            });
        } else if (numClients === 1) {
            socket.join(password);
            const settings = roomSettings[password];
            socket.emit("player-assignment", { 
                color: "black", 
                settings: settings, 
                blackName: safeName 
            });
            socket.to(password).emit("opponent-joined", { blackName: safeName });
        } else {
            socket.emit("error-msg", "Room is full!");
        }
    });

    socket.on("send-move", (data) => {
        socket.to(data.password).emit("receive-move", data);
    });

    socket.on("disconnecting", () => {
        for (const room of socket.rooms) {
            const clients = io.sockets.adapter.rooms.get(room);
            if (clients && clients.size === 1) delete roomSettings[room];
        }
    });
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
