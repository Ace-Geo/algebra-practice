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
    appendChatMessage("System", `Game started! You are playing as ${myColor.toUpperCase()}.`, true);
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
            <p style="margin: 5px 0;"><strong>Host:</strong> ${data.creatorName}</p>
            <p style="margin: 5px 0;"><strong>Time:</strong> ${s.mins}m ${s.secs}s</p>
            <p style="margin: 5px 0;"><strong>Increment:</strong> ${s.inc}s</p>
            <p style="margin: 5px 0;"><strong>Your Side:</strong> ${displayColor}</p>
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
    if (!isPaused && !isGameOver && !isInfinite) {
        startTimer();
    }
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

socket.on("draw-offered", () => {
    showDrawOffer();
});

socket.on("draw-resolved", (data) => {
    if (data.accepted) {
        const status = "GAME DRAWN BY AGREEMENT";
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        showResultModal(status);
        render(status);
    } else {
        showStatusMessage("Draw offer declined");
    }
});

socket.on("rematch-offered", () => {
    const btn = document.getElementById('rematch-btn');
    if (btn) {
        btn.innerText = "Accept Rematch";
        btn.classList.add('rematch-ready');
    }
});

// NEW: Handle opponent cancelling their offer
socket.on("rematch-cancelled", () => {
    const btn = document.getElementById('rematch-btn');
    if (btn) {
        btn.innerText = "Request Rematch";
        btn.classList.remove('rematch-ready');
        btn.style.background = "#779556";
        btn.disabled = false;
        rematchRequested = false;
    }
    showStatusMessage("Opponent withdrew rematch offer.");
});

socket.on("rematch-start", () => {
    rematchRequested = false;
    myColor = (myColor === 'white' ? 'black' : 'white');
    let oldWhite = whiteName;
    whiteName = blackName;
    blackName = oldWhite;

    const overlay = document.getElementById('game-over-overlay');
    if (overlay) overlay.remove();
    const reopenBtn = document.getElementById('reopen-results-btn');
    if (reopenBtn) reopenBtn.remove();

    initGameState();
    appendChatMessage("System", "Rematch started! Colors have been swapped.", true);
});

socket.on("error-msg", (msg) => { alert(msg); });

// --- CHAT FUNCTIONS ---

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
    if (msg.startsWith("/") && isAdmin) { handleAdminCommand(msg); input.value = ''; return; }
    const myName = (myColor === 'white' ? whiteName : blackName);
    socket.emit("send-chat", { password: currentPassword, message: msg, senderName: myName });
    appendChatMessage("You", msg);
    input.value = '';
}

function handleAdminCommand(cmd) {
    const args = cmd.split(' ');
    const baseCmd = args[0].toLowerCase();
    if (baseCmd === "/pause") {
        const val = args[1]?.toLowerCase();
        let newState = isPaused;
        if (val === "true") newState = true;
        else if (val === "false") newState = false;
        else { appendChatMessage("Console", "Usage: /pause true/false", true); return; }
        socket.emit("admin-pause-toggle", { password: currentPassword, isPaused: newState });
    }
}

window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;
    keyBuffer += e.key;
    if (keyBuffer.length > 2) keyBuffer = keyBuffer.slice(-2);
    if (keyBuffer === "[]") { isAdmin = true; appendChatMessage("Console", "Admin Active", true); }
});

// --- CORE CHESS LOGIC ---

const isWhite = (piece) => ['♖', '♘', '♗', '♕', '♔', '♙'].includes(piece);
const getTeam = (piece) => piece === '' ? null : (isWhite(piece) ? 'white' : 'black');

function getPieceNotation(piece) {
    const map = { '♖':'R','♘':'N','♗':'B','♕':'Q','♔':'K','♜':'R','♞':'N','♝':'B','♛':'Q','♚':'K' };
    return map[piece] || '';
}

function getNotation(fR, fC, tR, tC, p, tar, isEP, castle) {
    if (castle) return castle === 'short' ? 'O-O' : 'O-O-O';
    const files = ['a','b','c','d','e','f','g','h'], rows = ['8','7','6','5','4','3','2','1'];
    let m = getPieceNotation(p), cap = (tar !== '' || isEP) ? 'x' : '';
    if (m === '' && cap) m = files[fC];
    return m + cap + files[tC] + rows[tR];
}

function canAttackSquare(fR, fC, tR, tC, piece, board) {
    const dr = tR-fR, dc = tC-fC, adr = Math.abs(dr), adc = Math.abs(dc), team = getTeam(piece);
    const path = (r1, c1, r2, c2) => {
        const sR = r2===r1?0:(r2-r1)/Math.abs(r2-r1), sC = c2===c1?0:(c2-c1)/Math.abs(c2-c1);
        let cr = r1+sR, cc = c1+sC;
        while(cr!==r2||cc!==c2) { if(board[cr][cc]!=='') return false; cr+=sR; cc+=sC; }
        return true;
    };
    if (piece === '♙' || piece === '♟') return adc === 1 && dr === (team === 'white' ? -1 : 1);
    if (piece === '♖' || piece === '♜') return (dr === 0 || dc === 0) && path(fR, fC, tR, tC);
    if (piece === '♘' || piece === '♞') return (adr === 2 && adc === 1) || (adr === 1 && adc === 2);
    if (piece === '♗' || piece === '♝') return adr === adc && path(fR, fC, tR, tC);
    if (piece === '♕' || piece === '♛') return (adr === adc || dr === 0 || dc === 0) && path(fR, fC, tR, tC);
    if (piece === '♔' || piece === '♚') return adr <= 1 && adc <= 1;
    return false;
}

function canMoveTo(fR, fC, tR, tC, piece, board) {
    const team = getTeam(piece), target = board[tR][tC];
    if (target !== '' && getTeam(target) === team) return false;
    if (piece === '♙' || piece === '♟') {
        const dir = team === 'white' ? -1 : 1;
        if (tC === fC && target === '') {
            if (tR-fR === dir) return true;
            if (tR-fR === 2*dir && fR === (team==='white'?6:1) && board[fR+dir][fC] === '') return true;
        }
        if (Math.abs(tC-fC) === 1 && tR-fR === dir) {
            if (target !== '') return true;
            if (enPassantTarget && enPassantTarget.r === tR && enPassantTarget.c === tC) return true;
        }
        return false;
    }
    if ((piece === '♔' || piece === '♚') && Math.abs(tC-fC) === 2) {
        if (hasMoved[`${fR},${fC}`]) return false;
        if (isSquareAttacked(fR, fC, team==='white'?'black':'white', board)) return false;
        const rCol = tC === 6 ? 7 : 0;
        if (board[fR][rCol] === '' || hasMoved[`${fR},${rCol}`]) return false;
        const sC = tC === 6 ? 1 : -1;
        for(let c=fC+sC; c!==rCol; c+=sC) if(board[fR][c]!=='') return false;
        return true;
    }
    return canAttackSquare(fR, fC, tR, tC, piece, board);
}

function isSquareAttacked(r, c, atkTeam, board) {
    for (let i=0; i<8; i++) for (let j=0; j<8; j++) 
        if (board[i][j] !== '' && getTeam(board[i][j]) === atkTeam) 
            if (canAttackSquare(i, j, r, c, board[i][j], board)) return true;
    return false;
}

function isTeamInCheck(team, board) {
    let kR, kC, k = team === 'white' ? '♔' : '♚';
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(board[r][c]===k) { kR=r; kC=c; }
    return isSquareAttacked(kR, kC, team === 'white' ? 'black' : 'white', board);
}

function isMoveLegal(fR, fC, tR, tC, team) {
    const piece = boardState[fR][fC];
    if (!canMoveTo(fR, fC, tR, tC, piece, boardState)) return false;
    const b = boardState.map(row => [...row]);
    b[tR][tC] = piece; b[fR][fC] = '';
    if ((piece === '♙' || piece === '♟') && enPassantTarget?.r === tR && enPassantTarget?.c === tC) b[fR][tC] = '';
    return !isTeamInCheck(team, b);
}

function getLegalMoves(team) {
    let moves = [];
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) 
        if(getTeam(boardState[r][c]) === team)
            for(let tr=0; tr<8; tr++) for(let tc=0; tc<8; tc++)
                if(isMoveLegal(r, c, tr, tc, team)) moves.push({ from: {r,c}, to: {r:tr, c:tc} });
    return moves;
}

function handleActualMove(from, to, isLocal) {
    if (isGameOver) return;
    const p = boardState[from.r][from.c], tar = boardState[to.r][to.c], team = currentTurn;
    const isEP = (p === '♙' || p === '♟') && enPassantTarget?.r === to.r && enPassantTarget?.c === to.c;
    let castle = null;
    if ((p === '♔' || p === '♚') && Math.abs(from.c - to.c) === 2) {
        castle = from.c < to.c ? 'short' : 'long';
        const rO = to.c === 6 ? 7 : 0, rN = to.c === 6 ? 5 : 3;
        boardState[to.r][rN] = boardState[to.r][rO]; boardState[to.r][rO] = '';
    }
    let notation = getNotation(from.r, from.c, to.r, to.c, p, tar, isEP, castle);
    if (isEP) boardState[from.r][to.c] = '';
    hasMoved[`${from.r},${from.c}`] = true;
    boardState[to.r][to.c] = p; boardState[from.r][from.c] = '';
    if (p === '♙' && to.r === 0) boardState[to.r][to.c] = '♕';
    if (p === '♟' && to.r === 7) boardState[to.r][to.c] = '♛';
    if (!isInfinite && isLocal) { if (team === 'white') whiteTime += increment; else blackTime += increment; }
    enPassantTarget = (p === '♙' || p === '♟') && Math.abs(from.r - to.r) === 2 ? { r: (from.r + to.r) / 2, c: to.c } : null;
    currentTurn = team === 'white' ? 'black' : 'white';
    const nextMoves = getLegalMoves(currentTurn), inCheck = isTeamInCheck(currentTurn, boardState);
    let forced = null;
    if (nextMoves.length === 0) {
        isGameOver = true; if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        if (inCheck) { notation += '#'; forced = `CHECKMATE! ${team.toUpperCase()} WINS`; }
        else forced = "DRAW BY STALEMATE";
        showResultModal(forced);
    } else if (inCheck) notation += '+';
    if (team === 'white') moveHistory.push({ w: notation, b: '' });
    else if (moveHistory.length > 0) moveHistory[moveHistory.length - 1].b = notation;
    selected = null;
    if (isLocal) socket.emit("send-move", { password: currentPassword, move: { from, to }, whiteTime, blackTime });
    render(forced);
}

// --- UI AND RENDER ---

function render(forcedStatus) {
    const layout = document.getElementById('main-layout');
    if (!layout) return;

    // Preserve chat state
    const oldInput = document.getElementById('chat-input');
    const isChatFocused = (document.activeElement === oldInput);
    const cursorPos = oldInput ? oldInput.selectionStart : 0;
    const currentTypingValue = oldInput ? oldInput.value : "";
    const existingMessagesHTML = document.getElementById('chat-messages')?.innerHTML || "";

    layout.innerHTML = '';

    // Chat Panel
    const chatPanel = document.createElement('div');
    chatPanel.id = 'chat-panel';
    chatPanel.innerHTML = `
        <div id="chat-header">GAME CHAT</div>
        <div id="chat-messages">${existingMessagesHTML}</div>
        <div id="chat-input-area">
            <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off">
            <button id="chat-send-btn">Send</button>
        </div>
    `;
    const newInp = chatPanel.querySelector('#chat-input');
    newInp.value = currentTypingValue;
    newInp.addEventListener('keydown', (e) => e.stopPropagation());
    newInp.onkeypress = (e) => { if (e.key === 'Enter') sendChatMessage(); };
    chatPanel.querySelector('#chat-send-btn').onclick = sendChatMessage;
    layout.appendChild(chatPanel);

    // Game Area
    const gameArea = document.createElement('div');
    gameArea.id = 'game-area';
    const createPlayerBar = (name, id) => {
        const bar = document.createElement('div');
        bar.className = 'player-bar';
        bar.innerHTML = `<span class="player-name">${name} ${myColor === id ? '(YOU)' : ''}</span><div id="timer-${id}" class="timer">--:--</div>`;
        return bar;
    };
    if (myColor === 'black') gameArea.appendChild(createPlayerBar(whiteName, 'white'));
    else gameArea.appendChild(createPlayerBar(blackName, 'black'));

    const boardCont = document.createElement('div');
    boardCont.id = 'board-container';
    const boardEl = document.createElement('div');
    boardEl.id = 'board';

    const check = isTeamInCheck(currentTurn, boardState);
    let hints = (selected && !isGameOver) ? getLegalMoves(currentTurn).filter(m => m.from.r === selected.r && m.from.c === selected.c).map(m => m.to) : [];
    const range = (myColor === 'black') ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

    for (let r of range) {
        for (let c of range) {
            const sq = document.createElement('div');
            const piece = boardState[r][c];
            sq.className = `square ${(r + c) % 2 === 0 ? 'white-sq' : 'black-sq'}`;
            if (check && piece === (currentTurn === 'white' ? '♔' : '♚')) sq.classList.add('king-check');
            if (selected && selected.r === r && selected.c === c) sq.classList.add('selected');
            if (hints.some(h => h.r === r && h.c === c)) {
                const hint = document.createElement('div');
                hint.className = piece === '' ? 'hint-dot' : 'hint-capture';
                sq.appendChild(hint);
            }
            if (piece !== '') {
                const span = document.createElement('span');
                span.className = `piece ${isWhite(piece) ? 'w-piece' : 'b-piece'}`;
                span.textContent = piece;
                sq.appendChild(span);
            }
            sq.onclick = () => {
                if (isGameOver || currentTurn !== myColor) return;
                const hintMatch = hints.find(h => h.r === r && h.c === c);
                if (selected && hintMatch) handleActualMove(selected, { r, c }, true);
                else if (getTeam(piece) === currentTurn) { selected = { r, c }; render(); }
                else { selected = null; render(); }
            };
            boardEl.appendChild(sq);
        }
    }
    boardCont.appendChild(boardEl);
    gameArea.appendChild(boardCont);
    if (myColor === 'black') gameArea.appendChild(createPlayerBar(blackName, 'black'));
    else gameArea.appendChild(createPlayerBar(whiteName, 'white'));
    layout.appendChild(gameArea);

    // Side Panel
    const sidePanel = document.createElement('div');
    sidePanel.id = 'side-panel';
    let statusDisplay = forcedStatus || (isGameOver ? "GAME OVER" : `${currentTurn.toUpperCase()}'S TURN ${check ? '(CHECK!)' : ''}`);
    sidePanel.innerHTML = `
        <div id="status-box"><div id="status-text">${statusDisplay}</div></div>
        <div id="notification-area"></div>
        <div class="btn-row">
            <button class="action-btn" onclick="offerDraw()" ${isGameOver ? 'disabled' : ''}>Offer Draw</button>
            <button class="action-btn" onclick="resignGame()" ${isGameOver ? 'disabled' : ''}>Resign</button>
        </div>
        <div id="history-container"></div>
    `;
    const hist = sidePanel.querySelector('#history-container');
    moveHistory.forEach((m, i) => {
        const row = document.createElement('div');
        row.className = 'history-row';
        row.innerHTML = `<div class="move-num">${i + 1}.</div><div>${m.w}</div><div>${m.b}</div>`;
        hist.appendChild(row);
    });
    layout.appendChild(sidePanel);

    if (isChatFocused) { newInp.focus(); newInp.setSelectionRange(cursorPos, cursorPos); }
    updateTimerDisplay();
}

function updateTimerDisplay() {
    const wT = document.getElementById('timer-white'), bT = document.getElementById('timer-black');
    if (wT) { wT.textContent = formatTime(whiteTime); wT.className = `timer ${currentTurn === 'white' && !isGameOver ? 'active' : ''}`; }
    if (bT) { bT.textContent = formatTime(blackTime); bT.className = `timer ${currentTurn === 'black' && !isGameOver ? 'active' : ''}`; }
}

function formatTime(seconds) {
    if (isInfinite) return "∞";
    const s = Math.max(0, seconds), m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

function startTimer() {
    window.chessIntervalInstance = setInterval(() => {
        if (isGameOver || isPaused) return;
        if (currentTurn === 'white') whiteTime--; else blackTime--;
        updateTimerDisplay();
        if (whiteTime <= 0 || blackTime <= 0) {
            isGameOver = true; clearInterval(window.chessIntervalInstance);
            const msg = whiteTime <= 0 ? "BLACK WINS ON TIME" : "WHITE WINS ON TIME";
            showResultModal(msg); render(msg);
        }
    }, 1000);
}

function initGameState() {
    boardState = [
        ['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],
        ['','','','','','','',''],['','','','','','','',''],
        ['','','','','','','',''],['','','','','','','',''],
        ['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']
    ];
    currentTurn = 'white'; hasMoved = {}; moveHistory = []; isGameOver = false; selected = null; rematchRequested = false; isPaused = false;
    if (gameSettings) { whiteTime = (parseInt(gameSettings.mins)*60)+parseInt(gameSettings.secs); blackTime = whiteTime; increment = parseInt(gameSettings.inc)||0; isInfinite = (whiteTime===0); }
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isInfinite) startTimer();
    render();
}

function showSetup() {
    const overlay = document.createElement('div');
    overlay.id = 'setup-overlay';
    overlay.innerHTML = `
        <div class="setup-card">
            <div class="tabs"><button id="tab-create" class="active" onclick="switchTab('create')">Create Room</button><button id="tab-join" onclick="switchTab('join')">Join Room</button></div>
            <div id="create-sect">
                <div class="input-group"><label>Room Password</label><input id="roomPass" placeholder="Secret Code"></div>
                <div class="input-group"><label>Your Name</label><input id="uName" value="Player 1"></div>
                <div class="input-group"><label>Time Control</label><div style="display:flex; gap:5px;"><input type="number" id="tMin" value="10"><input type="number" id="tSec" value="0"><input type="number" id="tInc" value="0"></div></div>
                <div class="input-group"><label>Play As</label><select id="colorPref"><option value="random">Random</option><option value="white">White</option><option value="black">Black</option></select></div>
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
    document.getElementById('tab-create').className = tab === 'create' ? 'active' : '';
    document.getElementById('tab-join').className = tab === 'join' ? 'active' : '';
}

function createRoom() {
    currentPassword = document.getElementById('roomPass').value;
    tempName = document.getElementById('uName').value;
    if (!currentPassword) return alert("Enter password.");
    socket.emit("create-room", { password: currentPassword, name: tempName, mins: document.getElementById('tMin').value, secs: document.getElementById('tSec').value, inc: document.getElementById('tInc').value, colorPref: document.getElementById('colorPref').value });
}

function joinRoom() {
    currentPassword = document.getElementById('joinPass').value;
    tempName = document.getElementById('joinName').value;
    socket.emit("join-attempt", { password: currentPassword });
}

function confirmJoin() { socket.emit("confirm-join", { password: currentPassword, name: tempName }); }

function resignGame() {
    if (isGameOver) return;
    const winner = myColor === 'white' ? 'black' : 'white';
    socket.emit("resign", { password: currentPassword, winner });
    isGameOver = true; if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    showResultModal(`${winner.toUpperCase()} WINS BY RESIGNATION`); render(`${winner.toUpperCase()} WINS BY RESIGNATION`);
}

function offerDraw() { if (!isGameOver) { socket.emit("offer-draw", { password: currentPassword }); showStatusMessage("Draw offer sent..."); } }

function showDrawOffer() {
    const area = document.getElementById('notification-area');
    area.innerHTML = `<div class="draw-modal">Opponent offers a draw<div class="modal-btns"><button class="accept-btn" onclick="respondToDraw(true)">Accept</button><button class="decline-btn" onclick="respondToDraw(false)">Decline</button></div></div>`;
}

function respondToDraw(accepted) { socket.emit("draw-response", { password: currentPassword, accepted }); document.getElementById('notification-area').innerHTML = ''; }

function showStatusMessage(msg) {
    const area = document.getElementById('notification-area');
    area.innerHTML = `<div style="background:#4b4845; padding:10px; border-radius:4px; font-size:12px; text-align:center;">${msg}</div>`;
    setTimeout(() => { area.innerHTML = ''; }, 3000);
}

function showResultModal(text) {
    const overlay = document.createElement('div');
    overlay.id = 'game-over-overlay';
    overlay.innerHTML = `
        <div class="result-card">
            <h2>Game Over</h2><p>${text}</p>
            <div class="modal-btns-vertical">
                <button id="rematch-btn" onclick="requestRematch()">Request Rematch</button>
                <button class="action-btn" onclick="closeModal()">View Board</button>
                <button class="action-btn" style="background:#444" onclick="location.reload()">New Game</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

// RESTORED: requestRematch with Toggle support
function requestRematch() {
    const btn = document.getElementById('rematch-btn');
    if (!rematchRequested) {
        rematchRequested = true;
        btn.innerText = "Cancel Rematch";
        btn.style.background = "#883333";
        socket.emit("rematch-request", { password: currentPassword });
    } else {
        rematchRequested = false;
        btn.innerText = "Request Rematch";
        btn.style.background = "#779556";
        socket.emit("cancel-rematch", { password: currentPassword });
    }
}

function closeModal() {
    document.getElementById('game-over-overlay').style.display = 'none';
    if (!document.getElementById('reopen-results-btn')) {
        const btn = document.createElement('button');
        btn.id = 'reopen-results-btn'; btn.className = 'action-btn'; btn.style.marginTop = '10px'; btn.textContent = 'Show Result';
        btn.onclick = () => { document.getElementById('game-over-overlay').style.display = 'flex'; };
        document.getElementById('side-panel').appendChild(btn);
    }
}

window.onload = showSetup;
