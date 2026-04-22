const socket = io("https://algebra-but-better.onrender.com");

let myColor, currentPassword;
let boardState, currentTurn = 'white', selected = null;

const pieces = {
    white: ['♖','♙','♘','♗','♕','♔'],
    black: ['♜','♟','♞','♝','♛','♚']
};

// --- CORE FUNCTIONS ---
function getTeam(p) {
    if (pieces.white.includes(p)) return 'white';
    if (pieces.black.includes(p)) return 'black';
    return null;
}

function render() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';
    
    // Flip board for black player
    const range = myColor === 'black' ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];

    for (let r of range) {
        for (let c of range) {
            const sq = document.createElement('div');
            const piece = boardState[r][c];
            sq.className = `square ${(r + c) % 2 === 0 ? 'white-sq' : 'black-sq'}`;
            
            if (selected && selected.r === r && selected.c === c) sq.classList.add('selected');

            if (piece) {
                const team = getTeam(piece);
                sq.innerHTML = `<span class="piece ${team === 'white' ? 'w' : 'b'}">${piece}</span>`;
            }

            sq.onclick = () => {
                if (currentTurn !== myColor) return;
                
                if (selected) {
                    // Execute Move
                    executeMove(selected, {r, c}, true);
                    selected = null;
                } else if (getTeam(piece) === myColor) {
                    selected = {r, c};
                }
                render();
            };
            boardEl.appendChild(sq);
        }
    }
    document.getElementById('status').innerText = `${currentTurn.toUpperCase()}'s Turn`;
}

function executeMove(from, to, isLocal) {
    const piece = boardState[from.r][from.c];
    boardState[to.r][to.c] = piece;
    boardState[from.r][from.c] = '';
    
    if (isLocal) {
        socket.emit("send-move", { password: currentPassword, from, to });
    }
    
    currentTurn = currentTurn === 'white' ? 'black' : 'white';
    render();
}

// --- SOCKET EVENTS ---
socket.on("assign-color", (color) => {
    myColor = color;
});

socket.on("game-start", (data) => {
    document.getElementById('setup-overlay').style.display = 'none';
    document.getElementById('main-layout').style.display = 'flex';
    
    // Reset Board State
    boardState = [
        ['♜','♞','♝','♛','♚','♝','♞','♜'],
        ['♟','♟','♟','♟','♟','♟','♟','♟'],
        ['','','','','','','',''],
        ['','','','','','','',''],
        ['','','','','','','',''],
        ['','','','','','','',''],
        ['♙','♙','♙','♙','♙','♙','♙','♙'],
        ['♖','♘','♗','♕','♔','♗','♘','♖']
    ];
    render();
});

socket.on("receive-move", (data) => {
    executeMove(data.from, data.to, false);
});

// --- UI BUTTONS ---
function init() {
    const overlay = document.getElementById('setup-overlay');
    overlay.innerHTML = `
        <div class="setup-card">
            <h2>Chess</h2>
            <input id="roomPass" placeholder="Room Password">
            <input id="uName" placeholder="Your Name">
            <button id="createBtn" style="background:#779556; color:white; margin-bottom:5px;">CREATE</button>
            <button id="joinBtn">JOIN</button>
        </div>`;

    document.getElementById('createBtn').onclick = () => {
        currentPassword = document.getElementById('roomPass').value;
        socket.emit("create-room", { password: currentPassword, name: document.getElementById('uName').value });
        overlay.innerHTML = "<h2>Waiting for opponent...</h2>";
    };

    document.getElementById('joinBtn').onclick = () => {
        currentPassword = document.getElementById('roomPass').value;
        socket.emit("join-attempt", { password: currentPassword, name: document.getElementById('uName').value });
    };
}

window.onload = init;
