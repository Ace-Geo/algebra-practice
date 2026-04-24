const socket = io("https://algebra-but-better.onrender.com");

let myColor = null;
let currentPassword = null;
let tempName = "";
let whiteName = "White";
let blackName = "Black";
let isSpectator = false;
let spectatorId = null;
let boardFlipped = false;

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
let adminPermissionsMap = { white: false, black: false }; // Tracks everyone's admin status

// --- SOCKET LISTENERS ---

socket.on("lobby-update", (rooms) => {
    if (document.getElementById('spectator-list')) {
        renderSpectatorLobby(rooms);
    }
});

socket.on("player-assignment", (data) => {
    myColor = data.color;
    gameSettings = data.settings;
    
    if (myColor === 'spectator') {
        isSpectator = true;
        spectatorId = data.spectatorId;
        whiteName = data.whiteName;
        blackName = data.blackName;
        // Sync mid-game state
        if (data.syncData) {
            whiteTime = data.syncData.whiteTime;
            blackTime = data.syncData.blackTime;
            moveHistory = data.syncData.history;
        }
    } else if (myColor === 'white') {
        whiteName = tempName || "White";
        blackName = data.oppName;
    } else {
        blackName = tempName || "Black";
        whiteName = data.oppName;
    }
    
    const overlay = document.getElementById('setup-overlay');
    if (overlay) overlay.remove();
    
    initGameState();
    const roleMsg = isSpectator ? `Spectator #${spectatorId}` : myColor.toUpperCase();
    appendChatMessage("System", `Joined as ${roleMsg}.`, true);
});

socket.on("receive-admin-sync", (data) => {
    adminPermissionsMap[data.target] = data.state;
});

socket.on("permission-updated", (data) => {
    isAdmin = data.isAdmin;
    appendChatMessage("Console", `Your admin permissions: ${isAdmin}`, true);
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
    
    if (data.isSpectator) {
        card.innerHTML = `
            <h2 style="color: #779556">Spectate Game?</h2>
            <div style="text-align: left; margin-bottom: 20px; background: #1a1a1a; padding: 15px; border-radius: 8px;">
                <p><strong>Room:</strong> ${data.password}</p>
                <p><strong>Host:</strong> ${data.creatorName}</p>
                <p><strong>Time:</strong> ${s.mins}m+${s.inc}s</p>
            </div>
            <div class="input-group"><label>Your Spectator Name</label><input id="specName" value="Spectator"></div>
            <button class="start-btn" onclick="confirmSpectate('${data.password}')">WATCH GAME</button>
            <button class="action-btn" style="margin-top: 10px; width: 100%;" onclick="location.reload()">Back</button>
        `;
    } else {
        let displayColor = "RANDOM";
        if (data.creatorColorPref === 'white') displayColor = "BLACK";
        if (data.creatorColorPref === 'black') displayColor = "WHITE";

        card.innerHTML = `
            <h2 style="color: #779556">Join Room?</h2>
            <div style="text-align: left; margin-bottom: 20px; background: #1a1a1a; padding: 15px; border-radius: 8px;">
                <p><strong>Host:</strong> ${data.creatorName}</p>
                <p><strong>Time:</strong> ${s.mins}m ${s.secs}s</p>
                <p><strong>Increment:</strong> ${s.inc}s</p>
                <p><strong>Your Side:</strong> ${displayColor}</p>
            </div>
            <button class="start-btn" onclick="confirmJoin()">CONFIRM & START</button>
            <button class="action-btn" style="margin-top: 10px; width: 100%;" onclick="location.reload()">Back</button>
        `;
    }
});

socket.on("receive-move", (data) => {
    whiteTime = data.whiteTime;
    blackTime = data.blackTime;
    handleActualMove(data.move.from, data.move.to, false);
});

socket.on("receive-chat", (data) => { appendChatMessage(data.sender, data.message); });

socket.on("pause-state-updated", (data) => {
    isPaused = data.isPaused;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isPaused && !isGameOver && !isInfinite) startTimer();
    appendChatMessage("Console", isPaused ? "Game Paused" : "Game Resumed", true);
    render(); 
});

socket.on("time-updated", (data) => {
    if (data.color === 'white') whiteTime = data.newTime;
    else blackTime = data.newTime;
    updateTimerDisplay();
    appendChatMessage("Console", `${data.color.toUpperCase()} time updated`, true);
});

socket.on("opponent-resigned", (data) => {
    const status = `${data.winner.toUpperCase()} WINS BY RESIGNATION`;
    isGameOver = true;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    showResultModal(status);
    render(status);
});

socket.on("draw-offered", () => { if(!isSpectator) showDrawOffer(); });

socket.on("draw-resolved", (data) => {
    if (data.accepted) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        showResultModal("DRAW BY AGREEMENT");
        render("GAME DRAWN");
    } else {
        showStatusMessage("Draw offer declined");
    }
});

socket.on("rematch-offered", () => {
    const btn = document.getElementById('rematch-btn');
    if (btn) { btn.innerText = "Accept Rematch"; btn.classList.add('rematch-ready'); }
});

socket.on("rematch-start", () => {
    if (isSpectator) { initGameState(); return; }
    rematchRequested = false;
    myColor = (myColor === 'white' ? 'black' : 'white');
    let oldWhite = whiteName; whiteName = blackName; blackName = oldWhite;
    document.getElementById('game-over-overlay')?.remove();
    document.getElementById('reopen-results-btn')?.remove();
    initGameState();
});

socket.on("error-msg", (msg) => { alert(msg); });

// --- FUNCTIONS ---

function appendChatMessage(sender, message, isSystem = false) {
    const msgContainer = document.getElementById('chat-messages');
    if (!msgContainer) return;
    const div = document.createElement('div');
    div.className = isSystem ? 'chat-msg system' : 'chat-msg';
    div.innerHTML = isSystem ? message : `<b>${sender}:</b> ${message}`;
    msgContainer.appendChild(div);
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg || !currentPassword) return;

    if (msg.startsWith("/") && isAdmin) {
        handleAdminCommand(msg);
        input.value = '';
        return;
    }

    let myName = (myColor === 'white' ? whiteName : blackName);
    if (isSpectator) myName = `${tempName} (spectator)`;

    socket.emit("send-chat", { password: currentPassword, message: msg, senderName: myName });
    appendChatMessage("You", msg);
    input.value = '';
}

const COMMANDS_HELP = {
    "pause": { desc: "Pauses/Resumes game.", usage: "/pause <true/false>" },
    "time": { desc: "Sets player time.", usage: "/time <white/black> <min> <sec>" },
    "admin": { desc: "Lists all or sets permission.", usage: "/admin <list or ID/Color> <true/false>" },
    "help": { desc: "Show this help.", usage: "/help <cmd>" }
};

function handleAdminCommand(cmd) {
    const args = cmd.split(' ');
    const baseCmd = args[0].toLowerCase().substring(1);

    if (baseCmd === "help") {
        appendChatMessage("Console", "Admin Commands:", true);
        for (const k in COMMANDS_HELP) appendChatMessage("Console", `/${k} - ${COMMANDS_HELP[k].desc}`, true);
    } 
    else if (baseCmd === "admin") {
        const target = args[1]?.toLowerCase();
        if (target === "list") {
            let list = `Players:<br>White (${whiteName}): ${adminPermissionsMap.white}<br>Black (${blackName}): ${adminPermissionsMap.black}`;
            // In a full implementation, you'd track spectator names here too
            appendChatMessage("Console", list, true);
        } else if (target && (args[2] === "true" || args[2] === "false")) {
            socket.emit("admin-permission-toggle", { password: currentPassword, targetColor: target, isAdmin: args[2] === 'true' });
        }
    }
    else if (baseCmd === "pause") {
        socket.emit("admin-pause-toggle", { password: currentPassword, isPaused: args[1] === "true" });
    }
    else if (baseCmd === "time") {
        const newTime = (parseInt(args[2]) * 60) + parseInt(args[3]);
        socket.emit("admin-set-time", { password: currentPassword, color: args[1], newTime: newTime });
    }
}

window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;
    keyBuffer += e.key;
    if (keyBuffer.length > 2) keyBuffer = keyBuffer.slice(-2);
    if (keyBuffer === "[]") {
        if (!currentPassword) {
            const card = document.querySelector('.setup-card');
            if (card && !document.getElementById('spectator-list')) {
                const listDiv = document.createElement('div');
                listDiv.id = 'spectator-list';
                listDiv.style.marginTop = '20px';
                card.appendChild(listDiv);
                // Trigger an initial update request if needed
            }
        } else {
            isAdmin = true;
            appendChatMessage("Console", "Admin mode enabled.", true);
        }
        keyBuffer = "";
    }
});

function renderSpectatorLobby(rooms) {
    const container = document.getElementById('spectator-list');
    if (!container) return;
    container.innerHTML = `<hr><h3 style="color:#779556">Active Matches</h3>`;
    if (rooms.length === 0) container.innerHTML += `<p style="font-size:12px">No active games.</p>`;
    rooms.forEach(r => {
        const item = document.createElement('div');
        item.style.padding = "10px";
        item.style.background = "#1a1a1a";
        item.style.marginBottom = "5px";
        item.style.borderRadius = "4px";
        item.innerHTML = `
            <div style="font-size:13px">${r.whiteName} vs ${r.blackName}</div>
            <div style="font-size:11px; color:#888">${r.settings.mins}m + ${r.settings.inc}s</div>
            <button class="action-btn" style="padding:4px 8px; font-size:11px; margin-top:5px" onclick="spectateGame('${r.password}')">Spectate</button>
        `;
        container.appendChild(item);
    });
}

function spectateGame(pass) {
    socket.emit("join-attempt", { password: pass, isSpectator: true });
}

function confirmSpectate(pass) {
    currentPassword = pass;
    tempName = document.getElementById('specName').value;
    socket.emit("confirm-join", { password: pass, name: tempName, isSpectator: true });
}

const isWhite = (piece) => ['♖', '♘', '♗', '♕', '♔', '♙'].includes(piece);
const getTeam = (piece) => piece === '' ? null : (isWhite(piece) ? 'white' : 'black');

// ... [Piece Movement Logic: getNotation, canAttackSquare, canMoveTo, etc. stays the same as original script.js] ...

function handleActualMove(from, to, isLocal) {
    if (isGameOver || isPaused) return;
    const movingPiece = boardState[from.r][from.c];
    const targetPiece = boardState[to.r][to.c];
    const team = currentTurn;
    const isEP = (movingPiece === '♙' || movingPiece === '♟') && enPassantTarget && enPassantTarget.r === to.r && enPassantTarget.c === to.c;
    
    if (isEP) boardState[from.r][to.c] = '';
    boardState[to.r][to.c] = movingPiece; boardState[from.r][from.c] = '';
    
    // Auto-promotion
    if (movingPiece === '♙' && to.r === 0) boardState[to.r][to.c] = '♕';
    if (movingPiece === '♟' && to.r === 7) boardState[to.r][to.c] = '♛';

    if (!isInfinite && isLocal) { if (team === 'white') whiteTime += increment; else blackTime += increment; }
    
    currentTurn = (team === 'white' ? 'black' : 'white');
    // ... [Status check logic: Checkmate/Draw detection] ...

    if (isLocal) socket.emit("send-move", { password: currentPassword, move: { from, to }, whiteTime, blackTime });
    render();
}

function render(forcedStatus) {
    const layout = document.getElementById('main-layout'); 
    if (!layout) return;

    // Preserve Chat UI
    const existingMessages = document.getElementById('chat-messages')?.innerHTML || "";
    const chatValue = document.getElementById('chat-input')?.value || "";

    layout.innerHTML = '';
    
    // Chat Panel
    const chatPanel = document.createElement('div');
    chatPanel.id = 'chat-panel';
    chatPanel.innerHTML = `
        <div id="chat-header">GAME CHAT</div>
        <div id="chat-messages">${existingMessages}</div>
        <div id="chat-input-area">
            <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off">
            <button id="chat-send-btn">Send</button>
        </div>
    `;
    const newInp = chatPanel.querySelector('#chat-input');
    newInp.value = chatValue;
    newInp.addEventListener('keydown', (e) => e.stopPropagation());
    newInp.onkeypress = (e) => { e.stopPropagation(); if (e.key === 'Enter') sendChatMessage(); };
    chatPanel.querySelector('#chat-send-btn').onclick = sendChatMessage;
    layout.appendChild(chatPanel);

    // Game Area
    const gameArea = document.createElement('div');
    gameArea.id = 'game-area';
    
    const viewColor = boardFlipped ? (myColor === 'black' ? 'white' : 'black') : (myColor === 'spectator' ? 'white' : myColor);
    
    const createPlayerBar = (name, id) => {
        const bar = document.createElement('div');
        bar.className = 'player-bar';
        bar.innerHTML = `<span class="player-name">${name} ${myColor === id ? '(YOU)' : ''}</span><div id="timer-${id}" class="timer">--:--</div>`;
        return bar;
    };

    if (viewColor === 'black') gameArea.appendChild(createPlayerBar(whiteName, 'white'));
    else gameArea.appendChild(createPlayerBar(blackName, 'black'));

    const boardCont = document.createElement('div');
    boardCont.id = 'board-container';
    const boardEl = document.createElement('div');
    boardEl.id = 'board';

    const range = (viewColor === 'black') ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    for (let r of range) {
        for (let c of range) {
            const sq = document.createElement('div');
            sq.className = `square ${(r + c) % 2 === 0 ? 'white-sq' : 'black-sq'}`;
            if (boardState[r][c] !== '') {
                const span = document.createElement('span');
                span.className = `piece ${isWhite(boardState[r][c]) ? 'w-piece' : 'b-piece'}`;
                span.textContent = boardState[r][c];
                sq.appendChild(span);
            }
            sq.onclick = () => {
                if (isSpectator || isGameOver || currentTurn !== myColor) return;
                // [Square click logic from original script]
            };
            boardEl.appendChild(sq);
        }
    }
    boardCont.appendChild(boardEl);
    gameArea.appendChild(boardCont);

    if (viewColor === 'black') gameArea.appendChild(createPlayerBar(blackName, 'black'));
    else gameArea.appendChild(createPlayerBar(whiteName, 'white'));
    layout.appendChild(gameArea);

    // Side Panel
    const sidePanel = document.createElement('div');
    sidePanel.id = 'side-panel';
    sidePanel.innerHTML = `
        <div id="status-box"><div id="status-text">${forcedStatus || currentTurn.toUpperCase() + "'S TURN"}</div></div>
        <div id="notification-area"></div>
        <div class="btn-row"></div>
        <div id="history-container"></div>
    `;
    
    const btnRow = sidePanel.querySelector('.btn-row');
    if (isSpectator) {
        btnRow.innerHTML = `
            <button class="action-btn" onclick="boardFlipped = !boardFlipped; render();">Flip Board</button>
            <button class="action-btn" onclick="location.reload()">Return to Lobby</button>
        `;
    } else {
        btnRow.innerHTML = `
            <button class="action-btn" onclick="offerDraw()">Offer Draw</button>
            <button class="action-btn" onclick="resignGame()">Resign</button>
        `;
    }

    layout.appendChild(sidePanel);
    updateTimerDisplay();
}

function updateTimerDisplay() {
    const wT = document.getElementById('timer-white'); const bT = document.getElementById('timer-black');
    if (wT) wT.textContent = formatTime(whiteTime);
    if (bT) bT.textContent = formatTime(blackTime);
}

function formatTime(s) { 
    if (isInfinite) return "∞";
    return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`; 
}

function startTimer() {
    window.chessIntervalInstance = setInterval(() => {
        if (isGameOver || isPaused) return;
        if (currentTurn === 'white') whiteTime--; else blackTime--;
        updateTimerDisplay();
        if (whiteTime <= 0 || blackTime <= 0) {
            isGameOver = true; clearInterval(window.chessIntervalInstance);
            render("TIME EXPIRED");
        }
    }, 1000);
}

function initGameState() {
    boardState = [
        ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'], ['♟', '♟', '♟', '♟', '♟', '♟', '♟', '♟'],
        ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
        ['♙', '♙', '♙', '♙', '♙', '♙', '♙', '♙'], ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖']
    ];
    currentTurn = 'white'; isGameOver = false; isPaused = false;
    if (gameSettings) {
        whiteTime = (parseInt(gameSettings.mins) * 60) + parseInt(gameSettings.secs);
        blackTime = whiteTime; increment = parseInt(gameSettings.inc) || 0;
        isInfinite = (whiteTime === 0);
    }
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isInfinite) startTimer();
    render();
}

function showSetup() {
    const overlay = document.createElement('div'); overlay.id = 'setup-overlay';
    overlay.innerHTML = `
        <div class="setup-card">
            <div class="tabs"><button id="tab-create" class="active" onclick="switchTab('create')">Create</button><button id="tab-join" onclick="switchTab('join')">Join</button></div>
            <div id="create-sect">
                <div class="input-group"><label>Room Password</label><input id="roomPass" placeholder="Secret Code"></div>
                <div class="input-group"><label>Your Name</label><input id="uName" value="Player 1"></div>
                <div class="input-group"><label>Time Control</label><div style="display:flex; gap:5px;"><input type="number" id="tMin" value="10"><input type="number" id="tSec" value="0"><input type="number" id="tInc" value="0"></div></div>
                <button class="start-btn" onclick="createRoom()">CREATE</button>
            </div>
            <div id="join-sect" style="display:none;">
                <div class="input-group"><label>Room Password</label><input id="joinPass" placeholder="Enter Password"></div>
                <div class="input-group"><label>Your Name</label><input id="joinName" value="Player 2"></div>
                <button class="start-btn" onclick="joinRoom()">FIND ROOM</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

function switchTab(tab) {
    document.getElementById('create-sect').style.display = tab === 'create' ? 'block' : 'none';
    document.getElementById('join-sect').style.display = tab === 'join' ? 'block' : 'none';
}

function createRoom() {
    currentPassword = document.getElementById('roomPass').value;
    tempName = document.getElementById('uName').value;
    socket.emit("create-room", { password: currentPassword, name: tempName, mins: document.getElementById('tMin').value, secs: document.getElementById('tSec').value, inc: document.getElementById('tInc').value, colorPref: 'random' });
}

function joinRoom() {
    currentPassword = document.getElementById('joinPass').value;
    tempName = document.getElementById('joinName').value;
    socket.emit("join-attempt", { password: currentPassword });
}

function confirmJoin() { socket.emit("confirm-join", { password: currentPassword, name: tempName }); }

window.onload = showSetup;
