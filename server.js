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
        let creatorColor = preferredColor === 'random' ? (Math.random() > 0.5 ? 'white' : 'black') : preferredColor;
        roomSettings[password] = {
            mins: parseInt(mins) || 0, secs: parseInt(secs) || 0, inc: parseInt(inc) || 0,
            whiteName: creatorColor === 'white' ? name : null,
            blackName: creatorColor === 'black' ? name : null,
            creatorColor: creatorColor, creatorId: socket.id
        };
        socket.emit("waiting-for-opponent");
    });

    socket.on("join-attempt", (data) => {
        const settings = roomSettings[data.password];
        if (!settings) return socket.emit("error-msg", "Room not found!");
        socket.emit("confirm-settings", { settings, creatorName: settings.whiteName || settings.blackName });
    });

    socket.on("join-confirmed", (data) => {
        const settings = roomSettings[data.password];
        if (!settings) return;
        socket.join(data.password);
        const joinerColor = settings.creatorColor === 'white' ? 'black' : 'white';
        if (joinerColor === 'white') settings.whiteName = data.name; else settings.blackName = data.name;
        io.to(data.password).emit("game-start", { settings, whiteName: settings.whiteName, blackName: settings.blackName });
        socket.emit("assign-color", joinerColor);
        io.to(settings.creatorId).emit("assign-color", settings.creatorColor);
    });

    socket.on("send-move", (data) => socket.to(data.password).emit("receive-move", data));
    socket.on("resign", (data) => io.to(data.password).emit("opponent-resigned", data));
    socket.on("offer-draw", (data) => socket.to(data.password).emit("draw-offered"));
    socket.on("draw-response", (data) => io.to(data.password).emit("draw-result", data.accepted));
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
