const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const rooms = {}; 
const roomRematchStates = {}; 

function getActiveRooms() {
    return Object.keys(rooms).map(pass => {
        const r = rooms[pass];
        return {
            password: pass,
            whiteName: r.whiteName || "Waiting...",
            blackName: r.blackName || "Waiting...",
            settings: r.settings,
            status: r.status
        };
    });
}

io.on("connection", (socket) => {
    // Send room list to anyone in lobby
    socket.emit("lobby-update", getActiveRooms());

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
            players: { white: null, black: null },
            spectators: [], 
            whiteName: null,
            blackName: null,
            adminStates: { white: false, black: false }
        };
        io.emit("lobby-update", getActiveRooms());
        socket.emit("room-created", { password });
    });

    socket.on("join-attempt", (data) => {
        const { password, isSpectator } = data;
        const room = rooms[password];
        if (!room) {
            socket.emit("error-msg", "Room not found.");
            return;
        }
        if (!isSpectator && room.status !== "waiting") {
            socket.emit("error-msg", "Room is already in progress.");
            return;
        }
        socket.emit("preview-settings", {
            creatorName: room.creatorName,
            settings: room.settings,
            creatorColorPref: room.settings.colorPref,
            isSpectator: !!isSpectator,
            password: password
        });
    });

    socket.on("confirm-join", (data) => {
        const { password, name, isSpectator } = data;
        const room = rooms[password];
        if (!room) return;

        socket.join(password);

        if (isSpectator) {
            const existingIds = room.spectators.map(s => s.id).sort((a,b) => a-b);
            let newId = 1;
            for (let id of existingIds) { if (id === newId) newId++; else break; }

            room.spectators.push({ id: newId, socketId: socket.id, name: name, isAdmin: false });
            
            socket.emit("player-assignment", { 
                color: 'spectator', 
                spectatorId: newId,
                settings: room.settings,
                whiteName: room.whiteName,
                blackName: room.blackName
            });

            socket.to(password).emit("receive-chat", {
                message: `${name} is now spectating the game.`,
                sender: "System"
            });
        } else {
            room.status = "active";
            const joinerId = socket.id;
            const creatorId = room.creatorId;

            let whiteId, blackId;
            const pref = room.settings.colorPref;
            if (pref === 'white') { whiteId = creatorId; blackId = joinerId; room.whiteName = room.creatorName; room.blackName = name; }
            else if (pref === 'black') { whiteId = joinerId; blackId = creatorId; room.whiteName = name; room.blackName = room.creatorName; }
            else {
                if (Math.random() < 0.5) { whiteId = creatorId; blackId = joinerId; room.whiteName = room.creatorName; room.blackName = name; }
                else { whiteId = joinerId; blackId = creatorId; room.whiteName = name; room.blackName = room.creatorName; }
            }

            room.players.white = whiteId;
            room.players.black = blackId;

            io.to(creatorId).emit("player-assignment", { color: creatorId === whiteId ? 'white' : 'black', settings: room.settings, oppName: name });
            io.to(joinerId).emit("player-assignment", { color: joinerId === whiteId ? 'white' : 'black', settings: room.settings, oppName: room.creatorName });
            io.emit("lobby-update", getActiveRooms());
        }
    });

    socket.on("send-move", (data) => { socket.to(data.password).emit("receive-move", data); });

    socket.on("send-chat", (data) => {
        socket.to(data.password).emit("receive-chat", { message: data.message, sender: data.senderName });
    });

    socket.on("admin-pause-toggle", (data) => { io.in(data.password).emit("pause-state-updated", data); });
    socket.on("admin-set-time", (data) => { io.in(data.password).emit("time-updated", data); });
    socket.on("admin-set-increment", (data) => { io.in(data.password).emit("increment-updated", data); });
    socket.on("admin-place-piece", (data) => { io.in(data.password).emit("piece-placed", data); });
    socket.on("admin-reset-board", (data) => { io.in(data.password).emit("board-reset-triggered"); });

    socket.on("admin-permission-toggle", (data) => {
        const room = rooms[data.password];
        if (!room) return;
        let targetSocketId = null;

        if (data.target === 'white') {
            targetSocketId = room.players.white;
            room.adminStates.white = data.isAdmin;
        } else if (data.target === 'black') {
            targetSocketId = room.players.black;
            room.adminStates.black = data.isAdmin;
        } else {
            const spec = room.spectators.find(s => s.id === parseInt(data.target));
            if (spec) {
                targetSocketId = spec.socketId;
                spec.isAdmin = data.isAdmin;
            }
        }

        if (targetSocketId) {
            io.to(targetSocketId).emit("permission-updated", { isAdmin: data.isAdmin });
        }
        // Broadcast the update so /admin list is accurate for everyone
        io.in(data.password).emit("admin-list-sync", { 
            white: room.adminStates.white, 
            black: room.adminStates.black,
            spectators: room.spectators.map(s => ({ id: s.id, name: s.name, isAdmin: s.isAdmin }))
        });
    });

    socket.on("resign", (data) => { socket.to(data.password).emit("opponent-resigned", data); });
    socket.on("offer-draw", (data) => { socket.to(data.password).emit("draw-offered"); });
    socket.on("draw-response", (data) => { io.in(data.password).emit("draw-resolved", data); });

    socket.on("rematch-request", (data) => {
        const pass = data.password;
        if (!roomRematchStates[pass]) roomRematchStates[pass] = new Set();
        if (roomRematchStates[pass].has(socket.id)) {
            roomRematchStates[pass].delete(socket.id);
            socket.to(pass).emit("rematch-canceled");
        } else {
            roomRematchStates[pass].add(socket.id);
            socket.to(pass).emit("rematch-offered");
            if (roomRematchStates[pass].size === 2) {
                delete roomRematchStates[pass];
                io.in(pass).emit("rematch-start");
            }
        }
    });

    socket.on("disconnecting", () => {
        socket.rooms.forEach(roomPass => {
            const room = rooms[roomPass];
            if (room) {
                if (socket.id === room.players.white || socket.id === room.players.black) {
                    delete rooms[roomPass];
                    io.emit("lobby-update", getActiveRooms());
                } else {
                    room.spectators = room.spectators.filter(s => s.socketId !== socket.id);
                }
            }
        });
    });
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
