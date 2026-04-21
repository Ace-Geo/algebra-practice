const socket = io("https://algebra-but-better.onrender.com");
let myColor = null; 
let currentPassword = null;
let whiteName = "White", blackName = "Black"; // Set defaults immediately

// MULTIPLAYER LISTENERS
socket.on("player-assignment", (data) => {
    myColor = data.color;
    let m = parseInt(data.settings.mins) || 10;
    whiteTime = m * 60; 
    blackTime = whiteTime;
    isInfinite = (m === 0);
    whiteName = data.settings.whiteName || "White";
    
    if (myColor === "black") {
        const localName = document.getElementById('uName')?.value;
        blackName = localName || "Black";
    } else {
        blackName = "Waiting...";
    }
    
    initGameState();
});

socket.on("opponent-joined", (data) => {
    blackName = data.blackName || "Black";
    render();
});

socket.on("receive-move", (data) => {
    if (data.whiteTime !== undefined) whiteTime = data.whiteTime;
    if (data.blackTime !== undefined) blackTime = data.blackTime;
    handleActualMove(data.move.from, data.move.to, false);
});

socket.on("error-msg", (msg) => alert(msg));

// GAME VARIABLES
const whiteChars = ['♖', '♘', '♗', '♕', '♔', '♙'];
const isWhite = (char) => whiteChars.includes(char);
const getTeam = (char) => char === '' ? null : (isWhite(char) ? 'white' : 'black');

let boardState, currentTurn, hasMoved, enPassantTarget, selected, isGameOver, isInfinite;
let whiteTime, blackTime, moveHistory;
const mainLayout = document.getElementById('main-layout');

function formatTime(s) { 
    if (isInfinite) return "∞";
    const displaySec = Math.max(0, s);
    return `${Math.floor(displaySec/60)}:${(displaySec%60).toString().padStart(2,'0')}`; 
}

function updateTimerDisplay() {
    const wT = document.getElementById('timer-white'), bT = document.getElementById('timer-black');
    if (wT) { wT.textContent = formatTime(whiteTime); wT.className = `timer ${currentTurn === 'white' ? 'active' : ''}`; }
    if (bT) { bT.textContent = formatTime(blackTime); bT.className = `timer ${currentTurn === 'black' ? 'active' : ''}`; }
}

function startTimer() {
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (isInfinite) return;
    window.chessIntervalInstance = setInterval(() => {
        if (isGameOver) return clearInterval(window.chessIntervalInstance);
        if (currentTurn === 'white') whiteTime--; else blackTime--;
        updateTimerDisplay();
        if (whiteTime <= 0 || blackTime <= 0) {
            isGameOver = true;
            render(whiteTime <= 0 ? "BLACK WINS ON TIME" : "WHITE WINS ON TIME");
        }
    }, 1000);
}

function handleActualMove(from, to, isLocal) {
    const p = boardState[from.r][from.c];
    const isEP = (p==='♙'||p==='♟') && enPassantTarget?.r === to.r && enPassantTarget?.c === to.c;
    
    if((p==='♔'||p==='♚') && Math.abs(from.c - to.c) === 2) {
        const rO = to.c === 6 ? 7 : 0, rN = to.c === 6 ? 5 : 3;
        boardState[to.r][rN] = boardState[to.r][rO]; boardState[to.r][rO] = '';
    }

    if(isEP) boardState[from.r][to.c] = '';
    boardState[to.r][to.c] = p; boardState[from.r][from.c] = '';
    if(p==='♙'&& to.r===0) boardState[to.r][to.c] = '♕'; 
    if(p==='♟'&& to.r===7) boardState[to.r][to.c] = '♛';

    enPassantTarget = (p==='♙'||p==='♟') && Math.abs(from.r - to.r) === 2 ? {r:(from.r+to.r)/2, c: to.c} : null;
    currentTurn = currentTurn === 'white' ? 'black' : 'white';
    selected = null;

    if (isLocal) {
        socket.emit("send-move", { 
            password: currentPassword, 
            move: { from, to },
            whiteTime: whiteTime,
            blackTime: blackTime
        });
    }
    render();
}

function render(forcedStatus) {
    if (!mainLayout) return;
    mainLayout.replaceChildren();
    
    const gArea = document.createElement('div'); gArea.id = 'game-area';
    const createBar = (name, id) => {
        const div = document.createElement('div'); div.className = 'player-bar';
        div.innerHTML = `<span class="player-name">${name} ${myColor === id ? '(YOU)' : ''}</span><div id="timer-${id}" class="timer"></div>`;
        return div;
    };

    gArea.appendChild(createBar(blackName, 'black'));
    const bWrap = document.createElement('div'); bWrap.id = 'board-container';
    const bEl = document.createElement('div'); bEl.id = 'board';

    for(let r=0; r<8; r++) for(let c=0; c<8; c++) {
        const sq = document.createElement('div'); const char = boardState[r][c];
        sq.className = `square ${(r+c)%2===0?'white-sq':'black-sq'}`;
        if(char) {
            const sp = document.createElement('span'); sp.className = `piece ${isWhite(char)?'w-piece':'b-piece'}`; sp.textContent = char; sq.appendChild(sp);
        }
        sq.onclick = () => {
            if(isGameOver || currentTurn !== myColor) return;
            if(selected) {
                handleActualMove(selected, {r, c}, true);
            } else if(getTeam(char) === currentTurn) { 
                selected = {r,c}; render(); 
            }
        };
        bEl.appendChild(sq);
    }
    bWrap.appendChild(bEl); gArea.appendChild(bWrap);
    gArea.appendChild(createBar(whiteName, 'white'));
    mainLayout.appendChild(gArea);

    const side = document.createElement('div'); side.id = 'side-panel';
    side.innerHTML = `<div id="status-box"><div id="status-text">${forcedStatus || currentTurn.toUpperCase() + "'S TURN"}</div></div>`;
    mainLayout.appendChild(side);
    updateTimerDisplay();
}

function showSetup() {
    const overlay = document.createElement('div');
    overlay.id = 'setup-overlay';
    overlay.innerHTML = `
        <div class="setup-card">
            <h2>Chess Lobby</h2>
            <div class="input-group"><label>Room Password</label><input id="roomPass" placeholder="Secret Code"></div>
            <div class="input-group"><label>Your Name</label><input id="uName" value="Player"></div>
            <div class="input-group"><label>Minutes (White only)</label><input type="number" id="tMin" value="10"></div>
            <button class="start-btn" id="startBtn">JOIN / CREATE ROOM</button>
        </div>`;
    document.body.appendChild(overlay);
    document.getElementById('startBtn').onclick = () => {
        currentPassword = document.getElementById('roomPass').value;
        if(!currentPassword) return alert("Enter password");
        socket.emit("join-room", { password: currentPassword, name: document.getElementById('uName').value, mins: document.getElementById('tMin').value });
        overlay.remove();
    };
}

function initGameState() {
    boardState = [['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],...Array(4).fill(null).map(() => Array(8).fill('')),['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']];
    currentTurn = 'white'; isGameOver = false;
    startTimer(); render();
}
showSetup();
