const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const rooms = {}; 
const roomRematchStates = {}; 

// Helper function to broadcast active games to the lobby
function getActiveRooms() {
    return Object.keys(rooms).map(pass => {
        const r = rooms[pass];
        return {
            password: pass,
            whiteName: r.whiteName || "Player 1",
            blackName: r.blackName || "Player 2",
            settings: r.settings,
            status: r.status
        };
    });
}

io.on("connection", (socket) => {
    // Send current active rooms to anyone who connects
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
            spectators: [], // Added to track spectators
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
        // Allow joining if it's a spectator, otherwise check if full
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
            // Add to spectator list
            const specId = room.spectators.length + 1;
            room.spectators.push({ 
                id: specId, 
                socketId: socket.id, 
                name: name, 
                isAdmin: false 
            });
            
            socket.emit("player-assignment", { 
                color: 'spectator', 
                spectatorId: specId, 
                settings: room.settings,
                whiteName: room.whiteName,
                blackName: room.blackName
            });
            
            socket.to(password).emit("receive-chat", { 
                message: `${name} has joined as a spectator.`, 
                sender: "System" 
            });
        } else {
            if (room.status !== "waiting") return;
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
            room.whiteName = (whiteId === creatorId) ? room.creatorName : name;
            room.blackName = (blackId === creatorId) ? room.creatorName : name;

            io.to(whiteId).emit("player-assignment", { 
                color: 'white', 
                settings: room.settings,
                oppName: room.blackName
            });
            io.to(blackId).emit("player-assignment", { 
                color: 'black', 
                settings: room.settings,
                oppName: room.whiteName
            });
            
            io.emit("lobby-update", getActiveRooms());
        }
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

    // --- ADMIN COMMANDS (Original logic untouched) ---
    socket.on("admin-pause-toggle", (data) => {
        io.in(data.password).emit("pause-state-updated", { isPaused: data.isPaused });
    });

    socket.on("admin-set-time", (data) => {
        io.in(data.password).emit("time-updated", {
            color: data.color,
            newTime: data.newTime
        });
    });

    socket.on("admin-set-increment", (data) => {
        io.in(data.password).emit("increment-updated", {
            newInc: data.newInc
        });
    });

    socket.on("admin-place-piece", (data) => {
        io.in(data.password).emit("piece-placed", {
            r: data.r,
            c: data.c,
            piece: data.piece
        });
    });

    socket.on("admin-reset-board", (data) => {
        io.in(data.password).emit("board-reset-triggered");
    });

    // Enhanced admin toggle to support targeting spectators by ID
    socket.on("admin-permission-toggle", (data) => {
        const room = rooms[data.password];
        if (!room) return;

        let targetSocketId = null;
        if (data.targetColor === 'white') {
            targetSocketId = room.players.white;
            room.adminStates.white = data.isAdmin;
        } else if (data.targetColor === 'black') {
            targetSocketId = room.players.black;
            room.adminStates.black = data.isAdmin;
        } else {
            // Target by spectator ID
            const spec = room.spectators.find(s => s.id == data.targetColor);
            if (spec) {
                targetSocketId = spec.socketId;
                spec.isAdmin = data.isAdmin;
            }
        }

        if (targetSocketId) {
            io.to(targetSocketId).emit("permission-updated", { isAdmin: data.isAdmin });
        }

        // Sync admin list to all for the /admin list command
        io.in(data.password).emit("admin-list-sync", {
            white: room.adminStates.white,
            black: room.adminStates.black,
            spectators: room.spectators.map(s => ({ id: s.id, name: s.name, isAdmin: s.isAdmin }))
        });
    });

    // --- GAME ACTIONS ---
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
                    // If a player leaves, delete room
                    delete rooms[roomPass];
                    if (roomRematchStates[roomPass]) delete roomRematchStates[roomPass];
                    io.emit("lobby-update", getActiveRooms());
                } else {
                    // If a spectator leaves, just remove from list
                    room.spectators = room.spectators.filter(s => s.socketId !== socket.id);
                }
            }
        });
    });
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
