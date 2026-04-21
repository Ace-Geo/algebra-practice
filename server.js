const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const roomSettings = {}; 

io.on("connection", (socket) => {
    socket.on("create-room", (data) => {
        const { password, name, mins, secs, inc, preferredColor } = data;
        socket.join(password);
        
        // Determine actual creator color
        let creatorColor = preferredColor;
        if (preferredColor === 'random') {
            creatorColor = Math.random() > 0.5 ? 'white' : 'black';
        }

        roomSettings[password] = {
            mins: parseInt(mins) || 0,
            secs: parseInt(secs) || 0,
            inc: parseInt(inc) || 0,
            whiteName: creatorColor === 'white' ? name : null,
            blackName: creatorColor === 'black' ? name : null,
            creatorColor: creatorColor,
            creatorId: socket.id
        };
        
        socket.emit("waiting-for-opponent");
    });

    socket.on("join-attempt", (data) => {
        const { password, name } = data;
        const settings = roomSettings[password];
        
        if (!settings) {
            return socket.emit("error-msg", "Room not found!");
        }
        
        const room = io.sockets.adapter.rooms.get(password);
        if (room && room.size >= 2) {
            return socket.emit("error-msg", "Room is full!");
        }

        // Send settings to joiner for confirmation
        socket.emit("confirm-settings", {
            settings: settings,
            creatorName: settings.whiteName || settings.blackName
        });
    });

    socket.on("join-confirmed", (data) => {
        const { password, name } = data;
        const settings = roomSettings[password];
        if (!settings) return;

        socket.join(password);
        
        // Assign the remaining color to the joiner
        const joinerColor = settings.creatorColor === 'white' ? 'black' : 'white';
        if (joinerColor === 'white') settings.whiteName = name;
        else settings.blackName = name;

        // Start game for both
        io.to(password).emit("game-start", {
            settings: settings,
            whiteName: settings.whiteName,
            blackName: settings.blackName
        });
        
        // Tell each socket their specific color
        socket.emit("assign-color", joinerColor);
        io.to(settings.creatorId).emit("assign-color", settings.creatorColor);
    });

    // Default move/resign/draw handlers...
    socket.on("send-move", (data) => socket.to(data.password).emit("receive-move", data));
    socket.on("resign", (data) => socket.to(data.password).emit("opponent-resigned", { winner: data.winner }));
    socket.on("offer-draw", (data) => socket.to(data.password).emit("draw-offered"));
    socket.on("draw-response", (data) => socket.to(data.password).emit("draw-resolved", { accepted: data.accepted }));

    socket.on("disconnecting", () => {
        socket.rooms.forEach(room => {
            if (roomSettings[room] && roomSettings[room].creatorId === socket.id) {
                delete roomSettings[room];
            }
        });
    });
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
