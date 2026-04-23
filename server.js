const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const rooms = {}; 
const roomRematchStates = {}; 

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
        const { password } = data;
        const room = rooms[password];
        if (!room) {
            socket.emit("error-msg", "Room not found.");
            return;
        }
        if (room.status !== "waiting") {
            socket.emit("error-msg", "Room is already in progress.");
            return;
        }
        socket.emit("preview-settings", {
            creatorName: room.creatorName,
            settings: room.settings,
            creatorColorPref: room.settings.colorPref
        });
    });

    socket.on("confirm-join", (data) => {
        const { password, name } = data;
        const room = rooms[password];
        if (!room || room.status !== "waiting") return;

        socket.join(password);
        room.status = "active";
        const joinerId = socket.id;
        const creatorId = room.creatorId;

        let whiteId, blackId;
        const pref = room.settings.colorPref;
        if (pref === 'white') { whiteId = creatorId; blackId = joinerId; }
        else if (pref === 'black') { whiteId = joinerId; blackId = creatorId; }
        else {
            if (Math.random() < 0.5) { whiteId = creatorId; blackId = joinerId; }
            else { whiteId = joinerId; blackId = creatorId; }
        }

        room.players.white = whiteId;
        room.players.black = blackId;

        io.to(creatorId).emit("player-assignment", { 
            color: creatorId === whiteId ? 'white' : 'black', 
            settings: room.settings,
            oppName: name
        });
        io.to(joinerId).emit("player-assignment", { 
            color: joinerId === whiteId ? 'white' : 'black', 
            settings: room.settings,
            oppName: room.creatorName
        });
    });

    socket.on("send-move", (data) => {
        socket.to(data.password).emit("receive-move", data);
    });

    socket.on("send-chat", (data) => {
        socket.to(data.password).emit("receive-chat", {
            message: data.message,
            sender: data.senderName
        });
    });

    socket.on("resign", (data) => {
        socket.to(data.password).emit("opponent-resigned", { winner: data.winner });
    });

    socket.on("offer-draw", (data) => {
        socket.to(data.password).emit("draw-offered");
    });

    socket.on("draw-response", (data) => {
        io.in(data.password).emit("draw-resolved", { accepted: data.accepted });
    });

    socket.on("rematch-request", (data) => {
        const pass = data.password;
        if (!roomRematchStates[pass]) roomRematchStates[pass] = new Set();
        roomRematchStates[pass].add(socket.id);
        socket.to(pass).emit("rematch-offered");

        if (roomRematchStates[pass].size === 2) {
            delete roomRematchStates[pass];
            io.in(pass).emit("rematch-start");
        }
    });

    socket.on("disconnecting", () => {
        socket.rooms.forEach(roomPass => {
            if (rooms[roomPass]) delete rooms[roomPass];
            if (roomRematchStates[roomPass]) delete roomRematchStates[roomPass];
        });
    });
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
