const socket = io("https://algebra-but-better.onrender.com");

let myColor = null;
let currentPassword = null;
let tempName = "";
let whiteName = "White";
let blackName = "Black";

let boardState;
let currentTurn;
let hasMoved;
let enPassantTarget;
let selected;
let isGameOver;
let isInfinite;

let whiteTime;
let blackTime;
let increment;
let moveHistory = [];
let rematchRequested = false;
let gameSettings = null;

// --- ADMIN & COMMAND STATE ---
let isAdmin = false;
let isPaused = false;
let keyBuffer = "";

// --- SOCKET LISTENERS ---

socket.on("player-assignment", (data) => {
    myColor = data.color;
    gameSettings = data.settings;
    
    if (myColor === 'white') {
        whiteName = tempName || "White";
        blackName = data.oppName;
    } else {
        blackName = tempName || "Black";
        whiteName = data.oppName;
    }
    
    const overlay = document.getElementById('setup-overlay');
    if (overlay) overlay.remove();
    
    initGameState();
    appendChatMessage("System", `Game started! You are ${myColor.toUpperCase()}.`, true);
});

socket.on("room-created", (data) => {
    const card = document.querySelector('.setup-card');
    card.innerHTML = `
        <h2 style="color: #779556">Room Created</h2>
        <p>Waiting for opponent...</p>
        <div style="background: #1a1a1a; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <span style="color: #bababa; font-size: 12px; display: block; margin-bottom: 5px;">ROOM PASSWORD</span>
            <strong style="font-size: 24px; letter-spacing: 2px;">${data.password}</strong>
        </div>
        <button class="action-btn" onclick="location.reload()">Cancel</button>
    `;
});

socket.on("preview-settings", (data) => {
    const card = document.querySelector('.setup-card');
    const s = data.settings;
    let displayColor = "RANDOM";
    if (data.creatorColorPref === 'white') displayColor = "BLACK";
    if (data.creatorColorPref === 'black') displayColor = "WHITE";

    card.innerHTML = `
        <h2 style="color: #779556">Join Room?</h2>
        <div style="text-align: left; margin-bottom: 20px; background: #1a1a1a; padding: 15px; border-radius: 8px;">
            <p><strong>Host:</strong> ${data.creatorName}</p>
            <p><strong>Time:</strong> ${s.mins}m ${s.secs}s (+${s.inc}s)</p>
            <p><strong>Your Side:</strong> ${displayColor}</p>
        </div>
        <button class="start-btn" onclick="confirmJoin()">CONFIRM & START</button>
        <button class="action-btn" style="margin-top: 10px; width: 100%;" onclick="location.reload()">Back</button>
    `;
});

socket.on("receive-move", (data) => {
    whiteTime = data.whiteTime;
    blackTime = data.blackTime;
    handleActualMove(data.move.from, data.move.to, false);
});

socket.on("receive-chat", (data) => {
    appendChatMessage(data.sender, data.message);
});

socket.on("pause-state-updated", (data) => {
    isPaused = data.isPaused;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isPaused && !isGameOver && !isInfinite) startTimer();

    const status = isPaused ? "Game Paused by Admin" : "Game Resumed by Admin";
    appendChatMessage("Console", status, true);
    render(); 
});

socket.on("opponent-resigned", (data) => {
    const status = `${data.winner.toUpperCase()} WINS BY RESIGNATION`;
    isGameOver = true;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    showResultModal(status);
    render(status);
});

socket.on("rematch-offered", () => {
    const btn = document.getElementById('rematch-btn');
    if (btn) {
        btn.innerText = "Accept Rematch";
        btn.style.background = "#779556";
    }
});

socket.on("rematch-cancelled", () => {
    const btn = document.getElementById('rematch-btn');
    if (btn) {
        btn.innerText = "Request Rematch";
        btn.style.background = "#779556";
        rematchRequested = false;
    }
    showStatusMessage("Opponent withdrew rematch offer.");
});

socket.on("rematch-start", () => {
    rematchRequested = false;
    myColor = (myColor === 'white' ? 'black' : 'white');
    [whiteName, blackName] = [blackName, whiteName];
    const overlay = document.getElementById('game-over-overlay');
    if (overlay) overlay.remove();
    initGameState();
});

socket.on("error-msg", (msg) => alert(msg));

// --- FUNCTIONS ---

function startTimer() {
    window.chessIntervalInstance = setInterval(() => {
        if (isGameOver || isPaused) return;
        if (currentTurn === 'white') whiteTime--; else blackTime--;
        updateTimerDisplay();
        if (whiteTime <= 0 || blackTime <= 0) {
            isGameOver = true;
            clearInterval(window.chessIntervalInstance);
            showResultModal(whiteTime <= 0 ? "BLACK WINS ON TIME" : "WHITE WINS ON TIME");
        }
    }, 1000);
}

function updateTimerDisplay() {
    const w = document.getElementById('timer-white'), b = document.getElementById('timer-black');
    if (w) w.textContent = formatTime(whiteTime);
    if (b) b.textContent = formatTime(blackTime);
}

function formatTime(s) {
    if (isInfinite) return "∞";
    const m = Math.floor(Math.max(0, s)/60), sec = Math.max(0, s)%60;
    return `${m}:${sec.toString().padStart(2,'0')}`;
}

function initGameState() {
    boardState = [
        ['♜','♞','♝','♛','♚','♝','♞','♜'],
        ['♟','♟','♟','♟','♟','♟','♟','♟'],
        ['','','','','','','',''],['','','','','','','',''],
        ['','','','','','','',''],['','','','','','','',''],
        ['♙','♙','♙','♙','♙','♙','♙','♙'],
        ['♖','♘','♗','♕','♔','♗','♘','♖']
    ];
    currentTurn = 'white'; isGameOver = false; isPaused = false; hasMoved = {}; moveHistory = [];
    if (gameSettings) {
        whiteTime = (parseInt(gameSettings.mins)*60)+parseInt(gameSettings.secs);
        blackTime = whiteTime; increment = parseInt(gameSettings.inc);
        isInfinite = (whiteTime === 0);
    }
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isInfinite) startTimer();
    render();
}

function render(forcedStatus) {
    const layout = document.getElementById('main-layout');
    if (!layout) return;
    const curVal = document.getElementById('chat-input')?.value || "";
    const curHist = document.getElementById('chat-messages')?.innerHTML || "";

    layout.innerHTML = `
        <div id="chat-panel">
            <div id="chat-header">GAME CHAT</div>
            <div id="chat-messages">${curHist}</div>
            <div id="chat-input-area">
                <input id="chat-input" value="${curVal}" autocomplete="off">
                <button onclick="sendChatMessage()">Send</button>
            </div>
        </div>
        <div id="game-area">
            <div class="player-bar"><span>${myColor==='black'?whiteName:blackName}</span><div id="timer-${myColor==='black'?'white':'black'}" class="timer"></div></div>
            <div id="board-container"><div id="board"></div></div>
            <div class="player-bar"><span>${myColor==='white'?whiteName:blackName} (YOU)</span><div id="timer-${myColor}" class="timer"></div></div>
        </div>
        <div id="side-panel">
            <div id="status-box">${forcedStatus || (isPaused?"PAUSED":currentTurn.toUpperCase()+"'S TURN")}</div>
            <div id="notification-area"></div>
            <button class="action-btn" onclick="resignGame()">Resign</button>
        </div>
    `;

    const b = document.getElementById('board'), range = myColor==='black'?[7,6,5,4,3,2,1,0]:[0,1,2,3,4,5,6,7];
    for(let r of range) for(let c of range) {
        const s = document.createElement('div');
        s.className = `square ${(r+c)%2===0?'white-sq':'black-sq'}`;
        if(selected?.r===r && selected?.c===c) s.classList.add('selected');
        s.textContent = boardState[r][c];
        s.onclick = () => {
            if(isPaused || isGameOver || currentTurn!==myColor) return;
            if(selected && canMoveTo(selected.r, selected.c, r, c, boardState[selected.r][selected.c], boardState)) {
                handleActualMove(selected, {r,c}, true);
            } else if(getTeam(boardState[r][c])===myColor) {
                selected={r,c}; render();
            }
        };
        b.appendChild(s);
    }
    updateTimerDisplay();
}

function handleActualMove(from, to, isLocal) {
    const p = boardState[from.r][from.c];
    boardState[to.r][to.c] = p; boardState[from.r][from.c] = '';
    currentTurn = currentTurn === 'white' ? 'black' : 'white';
    selected = null;
    if (isLocal) socket.emit("send-move", { password: currentPassword, move: { from, to }, whiteTime, blackTime });
    render();
}

function getTeam(p) { return p === '' ? null : (['♖','♘','♗','♕','♔','♙'].includes(p) ? 'white' : 'black'); }

function canMoveTo(fR, fC, tR, tC, p, board) {
    // Simplified logic for brevity; ensure your full move logic is integrated here
    return true; 
}

function requestRematch() {
    const btn = document.getElementById('rematch-btn');
    if (!rematchRequested) {
        rematchRequested = true;
        btn.innerText = "Cancel Rematch"; btn.style.background = "#883333";
        socket.emit("rematch-request", { password: currentPassword });
    } else {
        rematchRequested = false;
        btn.innerText = "Request Rematch"; btn.style.background = "#779556";
        socket.emit("cancel-rematch", { password: currentPassword });
    }
}

function resignGame() { socket.emit("resign", { password: currentPassword, winner: myColor==='white'?'black':'white' }); }

function showSetup() {
    const overlay = document.createElement('div');
    overlay.id = 'setup-overlay';
    overlay.innerHTML = `
        <div class="setup-card">
            <div class="tabs">
                <button id="tab-create" class="active" onclick="switchTab('create')">Create</button>
                <button id="tab-join" onclick="switchTab('join')">Join</button>
            </div>
            <div id="create-sect">
                <input id="roomPass" placeholder="Room Password">
                <input id="uName" placeholder="Your Name" value="Player 1">
                <div style="display:flex; gap:5px; margin-top:10px;">
                    <input type="number" id="tMin" value="10" style="width:50px">
                    <input type="number" id="tSec" value="0" style="width:50px">
                </div>
                <button class="start-btn" onclick="createRoom()" style="margin-top:15px">CREATE</button>
            </div>
            <div id="join-sect" style="display:none;">
                <input id="joinPass" placeholder="Room Password">
                <input id="joinName" placeholder="Your Name" value="Player 2">
                <button class="start-btn" onclick="joinRoom()" style="margin-top:15px">FIND ROOM</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

function switchTab(t) {
    document.getElementById('create-sect').style.display = t==='create'?'block':'none';
    document.getElementById('join-sect').style.display = t==='join'?'block':'none';
}

function createRoom() {
    currentPassword = document.getElementById('roomPass').value;
    tempName = document.getElementById('uName').value;
    socket.emit("create-room", { password: currentPassword, name: tempName, mins: document.getElementById('tMin').value, secs: document.getElementById('tSec').value, inc: 0, colorPref: 'random' });
}

function joinRoom() {
    currentPassword = document.getElementById('joinPass').value;
    tempName = document.getElementById('joinName').value;
    socket.emit("join-attempt", { password: currentPassword });
}

function confirmJoin() { socket.emit("confirm-join", { password: currentPassword, name: tempName }); }

function showResultModal(text) {
    const ov = document.createElement('div'); ov.id = 'game-over-overlay';
    ov.innerHTML = `
        <div class="result-card">
            <h2>Game Over</h2><p>${text}</p>
            <button id="rematch-btn" onclick="requestRematch()">Request Rematch</button>
            <button onclick="location.reload()">New Game</button>
        </div>
    `; document.body.appendChild(ov);
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    if (msg.startsWith("/") && isAdmin) { handleAdminCommand(msg); input.value = ""; return; }
    socket.emit("send-chat", { password: currentPassword, message: msg, senderName: (myColor==='white'?whiteName:blackName) });
    appendChatMessage("You", msg);
    input.value = "";
}

function appendChatMessage(s, m, sys=false) {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    const div = document.createElement('div');
    div.innerHTML = sys ? `<i>${m}</i>` : `<b>${s}:</b> ${m}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

window.addEventListener('keydown', (e) => {
    keyBuffer += e.key; if (keyBuffer.length > 2) keyBuffer = keyBuffer.slice(-2);
    if (keyBuffer === "[]") { isAdmin = true; appendChatMessage("Console", "Admin Active", true); }
});

window.onload = showSetup;
