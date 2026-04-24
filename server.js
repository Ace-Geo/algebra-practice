const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const rooms = {}; 
const roomRematchStates = {}; 

// Helper to get active rooms for the lobby
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
    // Send room list to anyone in the lobby
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
            spectators: [] // Array of {id, socketId, name}
        };
        io.emit("lobby-update", getActiveRooms());
        socket.emit("room-created", { password });
    });

    socket.on("join-attempt", (data) => {
        const { password, isSpectator } = data;
        const room = rooms[password];
        if (!room) return socket.emit("error-msg", "Room not found.");
        
        if (isSpectator) {
            socket.emit("preview-settings", {
                creatorName: room.creatorName,
                settings: room.settings,
                isSpectator: true,
                password: password
            });
        } else {
            if (room.status !== "waiting") return socket.emit("error-msg", "Room is already active.");
            socket.emit("preview-settings", {
                creatorName: room.creatorName,
                settings: room.settings,
                creatorColorPref: room.settings.colorPref
            });
        }
    });

    socket.on("confirm-join", (data) => {
        const { password, name, isSpectator } = data;
        const room = rooms[password];
        if (!room) return;

        socket.join(password);

        if (isSpectator) {
            // Find lowest available spectator ID
            const existingIds = room.spectators.map(s => s.id);
            let newId = 1;
            while(existingIds.includes(newId)) newId++;

            room.spectators.push({ id: newId, socketId: socket.id, name: name });
            
            socket.emit("player-assignment", { 
                color: 'spectator', 
                spectatorId: newId,
                settings: room.settings,
                whiteName: room.whiteName,
                blackName: room.blackName,
                // Sync current state
                gameState: {
                    board: room.boardState,
                    turn: room.currentTurn,
                    history: room.moveHistory,
                    times: { white: room.whiteTime, black: room.blackTime }
                }
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

    socket.on("send-move", (data) => {
        const room = rooms[data.password];
        if(room) {
            // Update server's copy for new spectators
            room.whiteTime = data.whiteTime;
            room.blackTime = data.blackTime;
            // You would ideally track boardState here too for mid-game spectator joins
        }
        socket.to(data.password).emit("receive-move", data);
    });

    socket.on("admin-permission-toggle", (data) => {
        const room = rooms[data.password];
        if(!room) return;
        
        let targetSocketId = null;
        if(data.targetColor === 'white') targetSocketId = room.players.white;
        else if(data.targetColor === 'black') targetSocketId = room.players.black;
        else {
            const spec = room.spectators.find(s => s.id === parseInt(data.targetColor));
            if(spec) targetSocketId = spec.socketId;
        }

        if(targetSocketId) {
            io.to(targetSocketId).emit("permission-updated", { isAdmin: data.isAdmin });
        }
    });

    socket.on("disconnecting", () => {
        socket.rooms.forEach(roomPass => {
            const room = rooms[roomPass];
            if (room) {
                if(socket.id === room.players.white || socket.id === room.players.black) {
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
