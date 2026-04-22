const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const rooms = {}; 

io.on("connection", (socket) => {
    socket.on("create-room", (data) => {
        const { password, name, mins, secs, inc, colorPref } = data;
        if (rooms[password]) {
            socket.emit("error-msg", "Room password already in use.");
            return;
        }
        socket.join(password);
        rooms[password] = {
            creatorId: socket.id,
            creatorName: name,
            settings: { mins, secs, inc, colorPref },
            status: "waiting",
            players: { white: null, black: null }
        };
        socket.emit("room-created", { password });
    });

    socket.on("join-attempt", (data) => {
        const { password, name } = data;
        const room = rooms[password];
        if (!room) {
            socket.emit("error-msg", "Room not found.");
            return;
        }
        if (room.status !== "waiting") {
            socket.emit("error-msg", "Room is already in progress.");
            return;
        }
        let joinerColor;
        const pref = room.settings.colorPref;
        if (pref === 'white') joinerColor = 'black';
        else if (pref === 'black') joinerColor = 'white';
        else joinerColor = Math.random() < 0.5 ? 'white' : 'black';

        socket.emit("preview-settings", {
            creatorName: room.creatorName,
            settings: room.settings,
            yourColor: joinerColor
        });
    });

    socket.on("confirm-join", (data) => {
        const { password, name, color } = data;
        const room = rooms[password];
        if (!room || room.status !== "waiting") return;

        socket.join(password);
        room.status = "active";
        const joinerId = socket.id;
        const creatorId = room.creatorId;

        if (color === 'white') {
            room.players.white = joinerId;
            room.players.black = creatorId;
        } else {
            room.players.white = creatorId;
            room.players.black = joinerId;
        }

        io.to(creatorId).emit("player-assignment", { 
            color: color === 'white' ? 'black' : 'white', 
            settings: room.settings,
            oppName: name
        });
        io.to(joinerId).emit("player-assignment", { 
            color: color, 
            settings: room.settings,
            oppName: room.creatorName
        });
    });

    socket.on("send-move", (data) => {
        socket.to(data.password).emit("receive-move", data);
    });

    socket.on("resign", (data) => {
        socket.to(data.password).emit("opponent-resigned", { winner: data.winner });
    });

    socket.on("offer-draw", (data) => {
        socket.to(data.password).emit("draw-offered");
    });

    socket.on("draw-response", (data) => {
        socket.to(data.password).emit("draw-resolved", { accepted: data.accepted });
    });

    socket.on("disconnecting", () => {
        socket.rooms.forEach(roomPass => {
            if (rooms[roomPass]) delete rooms[roomPass];
        });
    });
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
