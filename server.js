const http = require('http').createServer();
const io = require('socket.io')(http, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    socket.on('join-room', (room) => socket.join(room));
    socket.on('send-move', (data) => {
        socket.to(data.roomId).emit('receive-move', data.move);
    });
});

http.listen(process.env.PORT || 3000);
