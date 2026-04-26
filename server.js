const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const rooms = {};
const roomRematchStates = {};
const coupRooms = {};

function getCoupSocketRoom(password) {
    return `coup:${password}`;
}

function emitCoupLobbyUpdate(password) {
    const room = coupRooms[password];
    if (!room) return;
    io.in(getCoupSocketRoom(password)).emit("coup-lobby-update", {
        password: room.password,
        hostId: room.hostId,
        players: room.players.map((player) => ({ socketId: player.socketId, name: player.name }))
    });
}

function removePlayerFromCoupRoom(password, socketId) {
    const room = coupRooms[password];
    if (!room) return;

    const index = room.players.findIndex((player) => player.socketId === socketId);
    if (index === -1) return;

    room.players.splice(index, 1);
    if (!room.players.length) {
        delete coupRooms[password];
        return;
    }

    if (room.hostId === socketId) {
        room.hostId = room.players[0].socketId;
    }

    emitCoupLobbyUpdate(password);
}

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
            players: { white: null, black: null, whiteName: null, blackName: null, whiteAdmin: false, blackAdmin: false },
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
        room.players.whiteAdmin = false;
        room.players.blackAdmin = false;

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

    socket.on("coup-create-room", (data) => {
        const password = (data.password || "").trim();
        const name = (data.name || "").trim();
        if (!password || !name) {
            socket.emit("error-msg", "Room password and username are required.");
            return;
        }
        if (coupRooms[password]) {
            socket.emit("error-msg", "Room password already in use.");
            return;
        }

        const socketRoom = getCoupSocketRoom(password);
        socket.join(socketRoom);
        coupRooms[password] = {
            password,
            hostId: socket.id,
            status: "lobby",
            players: [{ socketId: socket.id, name }]
        };
        emitCoupLobbyUpdate(password);
    });

    socket.on("coup-join-room", (data) => {
        const password = (data.password || "").trim();
        const name = (data.name || "").trim();
        if (!password || !name) {
            socket.emit("error-msg", "Room password and username are required.");
            return;
        }

        const room = coupRooms[password];
        if (!room) {
            socket.emit("error-msg", "Room not found.");
            return;
        }
        if (room.status !== "lobby") {
            socket.emit("error-msg", "Game already started.");
            return;
        }
        if (room.players.some((player) => player.socketId === socket.id)) {
            emitCoupLobbyUpdate(password);
            return;
        }

        socket.join(getCoupSocketRoom(password));
        room.players.push({ socketId: socket.id, name });
        emitCoupLobbyUpdate(password);
    });

    socket.on("coup-change-name", (data) => {
        const password = (data.password || "").trim();
        const nextName = (data.name || "").trim();
        if (!password || !nextName) return;

        const room = coupRooms[password];
        if (!room) return;

        const player = room.players.find((p) => p.socketId === socket.id);
        if (!player) return;
        player.name = nextName;
        emitCoupLobbyUpdate(password);
    });

    socket.on("coup-kick-player", (data) => {
        const password = (data.password || "").trim();
        const targetSocketId = data.targetSocketId;
        const room = coupRooms[password];
        if (!room) return;
        if (room.hostId !== socket.id) return;
        if (!targetSocketId || targetSocketId === socket.id) return;
        if (!room.players.some((player) => player.socketId === targetSocketId)) return;

        removePlayerFromCoupRoom(password, targetSocketId);
        io.to(targetSocketId).emit("coup-kicked");
        io.sockets.sockets.get(targetSocketId)?.leave(getCoupSocketRoom(password));
    });

    socket.on("coup-start-game", (data) => {
        const password = (data.password || "").trim();
        const room = coupRooms[password];
        if (!room) return;
        if (room.hostId !== socket.id) return;
        if (room.players.length < 2) return;
        room.status = "active";
        io.in(getCoupSocketRoom(password)).emit("coup-start-placeholder", {
            message: "Coup game start flow coming soon."
        });
    });

    socket.on("coup-leave-room", (data) => {
        const password = (data.password || "").trim();
        if (!password) return;
        removePlayerFromCoupRoom(password, socket.id);
        socket.leave(getCoupSocketRoom(password));
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

    socket.on("self-admin-enabled", (data) => {
        const room = rooms[data.password];
        if (!room) return;

        if (room.players.white === socket.id) {
            room.players.whiteAdmin = true;
            return;
        }

        if (room.players.black === socket.id) {
            room.players.blackAdmin = true;
            return;
        }

        const spectator = room.spectators[socket.id];
        if (spectator) {
            spectator.isAdmin = true;
        }
    });

    socket.on("request-admin-list", (data) => {
        const room = rooms[data.password];
        if (!room) return;

        socket.emit("admin-list", {
            white: { name: room.players.whiteName || "White", isAdmin: !!room.players.whiteAdmin },
            black: { name: room.players.blackName || "Black", isAdmin: !!room.players.blackAdmin },
            spectators: buildSpectatorList(room)
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

        if (data.targetColor === "white") room.players.whiteAdmin = data.isAdmin;
        if (data.targetColor === "black") room.players.blackAdmin = data.isAdmin;

        io.in(data.password).emit("permission-updated", {
            targetType: "player",
            targetColor: data.targetColor,
            isAdmin: data.isAdmin
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

        Object.keys(coupRooms).forEach((password) => {
            const room = coupRooms[password];
            if (!room.players.some((player) => player.socketId === socket.id)) return;
            removePlayerFromCoupRoom(password, socket.id);
        });
    });
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
