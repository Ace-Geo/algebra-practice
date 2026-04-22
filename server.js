const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const rooms = {}; 

io.on("connection", (socket) => {
    socket.on("create-room", (data) => {
        if (rooms[data.code]) {
            return socket.emit("error-msg", "Room code already taken!");
        }
        
        let color = data.prefColor;
        if (color === 'random') color = Math.random() > 0.5 ? 'white' : 'black';

        rooms[data.code] = {
            creatorId: socket.id,
            creatorName: data.name,
            creatorColor: color,
            settings: { mins: data.mins, secs: data.secs, inc: data.inc },
            status: 'waiting'
        };
        socket.join(data.code);
        socket.emit("waiting-for-opponent");
    });

    socket.on("join-attempt", (data) => {
        const room = rooms[data.code];
        if (!room) return socket.emit("error-msg", "Room not found!");
        if (room.status !== 'waiting') return socket.emit("error-msg", "Room is full!");

        const joinerColor = room.creatorColor === 'white' ? 'black' : 'white';
        socket.emit("confirm-join", {
            creatorName: room.creatorName,
            settings: room.settings,
            yourColor: joinerColor
        });
    });

    socket.on("join-confirmed", (data) => {
        const room = rooms[data.code];
        if (!room) return;

        socket.join(data.code);
        room.status = 'active';
        room.joinerName = data.name;

        const joinerColor = room.creatorColor === 'white' ? 'black' : 'white';
        
        // Start Game for both
        io.to(data.code).emit("game-start", {
            whiteName: joinerColor === 'white' ? data.name : room.creatorName,
            blackName: joinerColor === 'black' ? data.name : room.creatorName,
            settings: room.settings
        });

        // Send individual color assignments
        io.to(room.creatorId).emit("assign-color", room.creatorColor);
        socket.emit("assign-color", joinerColor);
    });

    socket.on("send-move", (data) => socket.to(data.code).emit("receive-move", data));
    socket.on("offer-draw", (data) => socket.to(data.code).emit("draw-offered"));
    socket.on("resign", (data) => io.to(data.code).emit("game-over", { winner: data.side === 'white' ? 'black' : 'white' }));
});

http.listen(process.env.PORT || 3000);
