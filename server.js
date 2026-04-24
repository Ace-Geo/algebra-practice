const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const rooms = {};
const roomRematchStates = {};

function getNextSpectatorId(room) {
    const used = new Set(Object.values(room.spectators).map((s) => s.id));
    let id = 1;
    while (used.has(id)) id++;
    return id;
}

function buildSpectatorList(room) {
    return Object.values(room.spectators)
        .sort((a, b) => a.id - b.id)
        .map((s) => ({ id: s.id, name: s.name, isAdmin: s.isAdmin }));
}

function emitSpectatorList(roomPass) {
    const room = rooms[roomPass];
    if (!room) return;
    io.in(roomPass).emit("spectator-list-updated", { spectators: buildSpectatorList(room) });
}

function buildActiveGames() {
    return Object.entries(rooms)
        .filter(([, room]) => room.status === "active" && room.players.white && room.players.black)
        .map(([password, room]) => ({
            password,
            whiteName: room.players.whiteName || "White",
            blackName: room.players.blackName || "Black",
            settings: room.settings
        }));
}

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
            players: { white: null, black: null, whiteName: null, blackName: null },
            spectators: {}
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
        room.players.whiteName = whiteId === creatorId ? room.creatorName : name;
        room.players.blackName = blackId === creatorId ? room.creatorName : name;

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

    socket.on("list-active-games", () => {
        socket.emit("active-games", { games: buildActiveGames() });
    });

    socket.on("spectate-game", (data) => {
        const { password, name } = data;
        const room = rooms[password];
        if (!room || room.status !== "active" || !room.players.white || !room.players.black) {
            socket.emit("error-msg", "Game not available for spectating.");
            return;
        }

        socket.join(password);
        const spectatorId = getNextSpectatorId(room);
        room.spectators[socket.id] = { id: spectatorId, name, isAdmin: false };

        socket.emit("spectator-assignment", {
            password,
            spectatorId,
            name,
            settings: room.settings,
            whiteName: room.players.whiteName,
            blackName: room.players.blackName
        });

        emitSpectatorList(password);
        io.in(password).emit("receive-chat", {
            sender: "System",
            message: `${name} is now spectating the game.`
        });

        io.to(room.players.white).emit("spectator-sync-needed", { requesterId: socket.id });
        io.to(room.players.black).emit("spectator-sync-needed", { requesterId: socket.id });
    });

    socket.on("spectator-state-sync", (data) => {
        io.to(data.targetSocketId).emit("spectator-state-sync", { state: data.state });
    });

    socket.on("send-move", (data) => {
        socket.to(data.password).emit("receive-move", data);
    });

    socket.on("send-chat", (data) => {
        io.in(data.password).emit("receive-chat", {
            message: data.message,
            sender: data.senderName
        });
    });

    // --- ADMIN COMMANDS ---
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

    socket.on("admin-permission-toggle", (data) => {
        const room = rooms[data.password];
        if (!room) return;

        if (data.targetType === "spectator") {
            const spectator = Object.values(room.spectators).find((s) => s.id === data.spectatorId);
            if (!spectator) return;
            spectator.isAdmin = data.isAdmin;
            io.in(data.password).emit("permission-updated", {
                targetType: "spectator",
                spectatorId: data.spectatorId,
                isAdmin: data.isAdmin
            });
            emitSpectatorList(data.password);
            return;
        }

        io.in(data.password).emit("permission-updated", {
            targetType: "player",
            targetColor: data.targetColor,
            isAdmin: data.isAdmin
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
        Object.entries(rooms).forEach(([roomPass, room]) => {
            if (room.spectators[socket.id]) {
                delete room.spectators[socket.id];
                emitSpectatorList(roomPass);
                return;
            }

            const isPlayer = room.creatorId === socket.id || room.players.white === socket.id || room.players.black === socket.id;
            if (isPlayer) {
                delete rooms[roomPass];
                if (roomRematchStates[roomPass]) delete roomRematchStates[roomPass];
            }
        });
    });
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
