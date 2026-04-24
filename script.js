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
let isOpponentAdmin = false; 
let keyBuffer = "";
let adminSyncData = { white: false, black: false, spectators: [] };
let isPaused = false;

// --- SOCKET LISTENERS ---

socket.on("lobby-update", (rooms) => {
    const container = document.getElementById('spectator-list');
    if (container) renderSpectatorLobby(rooms);
});

socket.on("player-assignment", (data) => {
    myColor = data.color;
    gameSettings = data.settings;
    
    if (myColor === 'spectator') {
        isSpectator = true;
        spectatorId = data.spectatorId;
        whiteName = data.whiteName || "White";
        blackName = data.blackName || "Black";
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
    const roleMsg = isSpectator ? `Spectator #${spectatorId}` : `playing as ${myColor.toUpperCase()}`;
    appendChatMessage("System", `Joined ${roleMsg}.`, true);
});

socket.on("admin-list-sync", (data) => {
    adminSyncData = data;
});

socket.on("permission-updated", (data) => {
    isAdmin = data.isAdmin;
    appendChatMessage("Console", `Your admin permissions have been ${isAdmin ? 'granted' : 'removed'}.`, true);
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
            <h2 style="color: #779556">Spectate Game</h2>
            <div style="text-align: left; margin-bottom: 20px; background: #1a1a1a; padding: 15px; border-radius: 8px;">
                <p><strong>Host:</strong> ${data.creatorName}</p>
                <p><strong>Time:</strong> ${s.mins}m + ${s.inc}s</p>
            </div>
            <div class="input-group"><label>Your Username</label><input id="specName" value="Spectator"></div>
            <button class="start-btn" onclick="confirmSpectate('${data.password}')">JOIN AS SPECTATOR</button>
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
    appendChatMessage("Console", isPaused ? "Game Paused by Admin" : "Game Resumed by Admin", true);
    render(); 
});

socket.on("time-updated", (data) => {
    if (data.color === 'white') whiteTime = data.newTime;
    else blackTime = data.newTime;
    updateTimerDisplay();
    appendChatMessage("Console", `${data.color.toUpperCase()} time updated`, true);
});

socket.on("increment-updated", (data) => {
    increment = data.newInc;
    appendChatMessage("Console", `Increment set to ${increment}s`, true);
});

socket.on("piece-placed", (data) => {
    boardState[data.r][data.c] = data.piece;
    render();
});

socket.on("board-reset-triggered", () => {
    boardState = [
        ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'], ['♟', '♟', '♟', '♟', '♟', '♟', '♟', '♟'],
        ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
        ['♙', '♙', '♙', '♙', '♙', '♙', '♙', '♙'], ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖']
    ];
    enPassantTarget = null; selected = null; hasMoved = {};
    render();
});

socket.on("opponent-resigned", (data) => {
    const status = `${data.winner.toUpperCase()} WINS BY RESIGNATION`;
    isGameOver = true;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    showResultModal(status);
    render(status);
});

socket.on("draw-offered", () => { if (!isSpectator) showDrawOffer(); });

socket.on("draw-resolved", (data) => {
    if (data.accepted) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        showResultModal("GAME DRAWN BY AGREEMENT");
        render("GAME DRAWN BY AGREEMENT");
    } else {
        showStatusMessage("Draw offer declined");
    }
});

socket.on("rematch-offered", () => {
    const btn = document.getElementById('rematch-btn');
    if (btn) { btn.innerText = "Accept Rematch"; btn.classList.add('rematch-ready'); }
});

socket.on("rematch-canceled", () => {
    const btn = document.getElementById('rematch-btn');
    if (btn) { btn.innerText = "Request Rematch"; btn.classList.remove('rematch-ready'); }
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

// --- COMMAND HELPERS ---

const COMMANDS_HELP = {
    "pause": { desc: "Pauses/resumes clocks.", usage: "/pause <true/false>" },
    "time": { desc: "Sets player time.", usage: "/time <white/black> <min> <sec>" },
    "increment": { desc: "Sets increment.", usage: "/increment <sec>" },
    "place": { desc: "Places piece.", usage: "/place <sq> <color> <piece>" },
    "reset": { desc: "Resets pieces.", usage: "/reset" },
    "admin": { desc: "Lists statuses or toggles permission.", usage: "/admin <list or Color/ID> <true/false>" },
    "help": { desc: "Shows commands.", usage: "/help <cmd>" }
};

function handleAdminCommand(cmd) {
    const args = cmd.split(' ');
    const baseCmd = args[0].toLowerCase().substring(1);

    if (baseCmd === "help") {
        appendChatMessage("Console", "Available Commands:", true);
        for (const k in COMMANDS_HELP) appendChatMessage("Console", `/${k} - ${COMMANDS_HELP[k].desc}`, true);
    } 
    else if (baseCmd === "admin") {
        const target = args[1]?.toLowerCase();
        if (target === "list") {
            let list = `<b>Players:</b><br>White (${whiteName}): Admin=${adminSyncData.white}<br>Black (${blackName}): Admin=${adminSyncData.black}<br><b>Spectators:</b>`;
            if (adminSyncData.spectators.length === 0) list += "<br>None";
            adminSyncData.spectators.forEach(s => {
                list += `<br>Spectator ${s.id} (${s.name}): Admin=${s.isAdmin}`;
            });
            appendChatMessage("Console", list, true);
        } else if (target && (args[2] === "true" || args[2] === "false")) {
            socket.emit("admin-permission-toggle", { password: currentPassword, targetColor: target, isAdmin: args[2] === 'true' });
        } else {
            appendChatMessage("Console", `Usage: ${COMMANDS_HELP.admin.usage}`, true);
        }
    }
    else if (baseCmd === "pause") {
        socket.emit("admin-pause-toggle", { password: currentPassword, isPaused: args[1] === "true" });
    }
    else if (baseCmd === "time") {
        const t = (parseInt(args[2]) * 60) + parseInt(args[3]);
        socket.emit("admin-set-time", { password: currentPassword, color: args[1], newTime: t });
    }
    else if (baseCmd === "increment") {
        socket.emit("admin-set-increment", { password: currentPassword, newInc: parseInt(args[1]) });
    }
    else if (baseCmd === "reset") {
        socket.emit("admin-reset-board", { password: currentPassword });
    }
    else if (baseCmd === "place") {
        const sq = args[1];
        const col = args[2]?.toLowerCase();
        const type = args[3]?.toLowerCase();
        if (!sq || !col || !type) return;
        const c = sq.charCodeAt(0) - 97;
        const r = 8 - parseInt(sq[1]);
        const pieces = { 
            white: { p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔' },
            black: { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' }
        };
        const piece = pieces[col]?.[type];
        if (piece) socket.emit("admin-place-piece", { password: currentPassword, r, c, piece });
    }
}

// --- CORE CHESS LOGIC ---

const isWhite = (piece) => ['♖', '♘', '♗', '♕', '♔', '♙'].includes(piece);
const getTeam = (piece) => piece === '' ? null : (isWhite(piece) ? 'white' : 'black');
function getNotation(r, c) { return String.fromCharCode(97 + c) + (8 - r); }

function canAttackSquare(fromR, fromC, toR, toC, board) {
    const piece = board[fromR][fromC];
    if (!piece) return false;
    const type = piece.toLowerCase();
    const dr = toR - fromR, dc = toC - fromC;
    const adr = Math.abs(dr), adc = Math.abs(dc);

    if (piece === '♙') return dr === -1 && adc === 1;
    if (piece === '♟') return dr === 1 && adc === 1;
    if (type === '♖' || type === '♜') {
        if (dr !== 0 && dc !== 0) return false;
        const sr = dr === 0 ? 0 : dr / adr, sc = dc === 0 ? 0 : dc / adc;
        for (let i = 1; i < Math.max(adr, adc); i++) if (board[fromR + i * sr][fromC + i * sc] !== '') return false;
        return true;
    }
    if (type === '♘' || type === '♞') return (adr === 2 && adc === 1) || (adr === 1 && adc === 2);
    if (type === '♗' || type === '♝') {
        if (adr !== adc) return false;
        const sr = dr / adr, sc = dc / adc;
        for (let i = 1; i < adr; i++) if (board[fromR + i * sr][fromC + i * sc] !== '') return false;
        return true;
    }
    if (type === '♕' || type === '♛') {
        if (dr !== 0 && dc !== 0 && adr !== adc) return false;
        const sr = dr === 0 ? 0 : dr / adr, sc = dc === 0 ? 0 : dc / adc;
        for (let i = 1; i < Math.max(adr, adc); i++) if (board[fromR + i * sr][fromC + i * sc] !== '') return false;
        return true;
    }
    if (type === '♔' || type === '♚') return adr <= 1 && adc <= 1;
    return false;
}

function canMoveTo(fromR, fromC, toR, toC, board, history, moved) {
    const piece = board[fromR][fromC];
    const target = board[toR][toC];
    if (getTeam(piece) === getTeam(target)) return false;
    const dr = toR - fromR, dc = toC - fromC;
    const adr = Math.abs(dr), adc = Math.abs(dc);

    if (piece === '♙' || piece === '♟') {
        const dir = piece === '♙' ? -1 : 1;
        if (dc === 0) {
            if (dr === dir && target === '') return true;
            if (dr === 2 * dir && target === '' && board[fromR + dir][fromC] === '' && (piece === '♙' ? fromR === 6 : fromR === 1)) return true;
        } else if (adc === 1 && dr === dir) {
            if (target !== '') return true;
            if (enPassantTarget && enPassantTarget.r === toR && enPassantTarget.c === toC) return true;
        }
        return false;
    }
    
    if ((piece === '♔' || piece === '♚') && adr === 0 && adc === 2) {
        if (isSquareAttacked(fromR, fromC, getTeam(piece) === 'white' ? 'black' : 'white', board)) return false;
        const row = fromR;
        if (toC === 6) {
            const rookSq = getNotation(row, 7);
            if (moved[rookSq] || board[row][7].toLowerCase() !== (piece === '♔' ? '♖' : '♜').toLowerCase()) return false;
            if (board[row][5] !== '' || board[row][6] !== '') return false;
            if (isSquareAttacked(row, 5, getTeam(piece) === 'white' ? 'black' : 'white', board)) return false;
            return true;
        }
        if (toC === 2) {
            const rookSq = getNotation(row, 0);
            if (moved[rookSq] || board[row][0].toLowerCase() !== (piece === '♔' ? '♖' : '♜').toLowerCase()) return false;
            if (board[row][1] !== '' || board[row][2] !== '' || board[row][3] !== '') return false;
            if (isSquareAttacked(row, 3, getTeam(piece) === 'white' ? 'black' : 'white', board)) return false;
            return true;
        }
    }
    return canAttackSquare(fromR, fromC, toR, toC, board);
}

function isSquareAttacked(r, c, attackerColor, board) {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if (getTeam(board[i][j]) === attackerColor && canAttackSquare(i, j, r, c, board)) return true;
    return false;
}

function isTeamInCheck(team, board) {
    let kr, kc;
    const king = team === 'white' ? '♔' : '♚';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] === king) { kr = r; kc = c; break; }
    return isSquareAttacked(kr, kc, team === 'white' ? 'black' : 'white', board);
}

function getLegalMoves(r, c, board, history, moved) {
    const moves = [];
    for (let tr = 0; tr < 8; tr++) {
        for (let tc = 0; tc < 8; tc++) {
            if (canMoveTo(r, c, tr, tc, board, history, moved)) {
                const nextBoard = board.map(row => [...row]);
                const piece = nextBoard[r][c];
                if ((piece === '♙' || piece === '♟') && enPassantTarget && enPassantTarget.r === tr && enPassantTarget.c === tc) nextBoard[r][tc] = '';
                nextBoard[tr][tc] = piece; nextBoard[r][c] = '';
                if (!isTeamInCheck(getTeam(piece), nextBoard)) moves.push({ r: tr, c: tc });
            }
        }
    }
    return moves;
}

function handleActualMove(from, to, isLocal) {
    if (isGameOver) return;
    const movingPiece = boardState[from.r][from.c];
    const team = currentTurn;

    const isEP = (movingPiece === '♙' || movingPiece === '♟') && enPassantTarget && enPassantTarget.r === to.r && enPassantTarget.c === to.c;
    if (isEP) boardState[from.r][to.c] = '';
    
    if ((movingPiece === '♔' || movingPiece === '♚') && Math.abs(from.c - to.c) === 2) {
        const rCol = to.c === 6 ? 7 : 0; const nCol = to.c === 6 ? 5 : 3;
        boardState[to.r][nCol] = boardState[to.r][rCol]; boardState[to.r][rCol] = '';
    }

    boardState[to.r][to.c] = movingPiece; boardState[from.r][from.c] = '';
    if (movingPiece === '♙' && to.r === 0) boardState[to.r][to.c] = '♕';
    if (movingPiece === '♟' && to.r === 7) boardState[to.r][to.c] = '♛';

    if (!isInfinite && isLocal) { if (team === 'white') whiteTime += increment; else blackTime += increment; }
    enPassantTarget = (movingPiece === '♙' || movingPiece === '♟') && Math.abs(from.r - to.r) === 2 ? { r: (from.r + to.r) / 2, c: to.c } : null;
    hasMoved[getNotation(from.r, from.c)] = true;
    currentTurn = (team === 'white' ? 'black' : 'white');

    if (isLocal) socket.emit("send-move", { password: currentPassword, move: { from, to }, whiteTime, blackTime });
    render();
}

// --- UI & RENDERING ---

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
    let myName = (myColor === 'white' ? whiteName : blackName);
    if (isSpectator) myName = `${tempName} (spec)`;
    socket.emit("send-chat", { password: currentPassword, message: msg, senderName: myName });
    appendChatMessage("You", msg);
    input.value = '';
}

function render(forcedStatus) {
    const layout = document.getElementById('main-layout'); 
    if (!layout) return;
    const chatMsgs = document.getElementById('chat-messages')?.innerHTML || "";
    const chatVal = document.getElementById('chat-input')?.value || "";
    layout.innerHTML = '';
    
    const chatPanel = document.createElement('div');
    chatPanel.id = 'chat-panel';
    chatPanel.innerHTML = `<div id="chat-header">GAME CHAT</div><div id="chat-messages">${chatMsgs}</div><div id="chat-input-area"><input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off"><button id="chat-send-btn">Send</button></div>`;
    const newInp = chatPanel.querySelector('#chat-input');
    newInp.value = chatVal;
    newInp.addEventListener('keydown', (e) => e.stopPropagation());
    newInp.onkeypress = (e) => { if (e.key === 'Enter') sendChatMessage(); };
    chatPanel.querySelector('#chat-send-btn').onclick = sendChatMessage;
    layout.appendChild(chatPanel);

    const gameArea = document.createElement('div'); gameArea.id = 'game-area';
    let viewAs = 'white';
    if (isSpectator) viewAs = boardFlipped ? 'black' : 'white';
    else viewAs = boardFlipped ? (myColor === 'white' ? 'black' : 'white') : myColor;
    
    const range = (viewAs === 'black') ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    const createBar = (name, id) => {
        const bar = document.createElement('div'); bar.className = 'player-bar';
        bar.innerHTML = `<span class="player-name">${name} ${myColor === id ? '(YOU)' : ''}</span><div id="timer-${id}" class="timer">--:--</div>`;
        return bar;
    };

    if (viewAs === 'black') gameArea.appendChild(createBar(whiteName, 'white'));
    else gameArea.appendChild(createBar(blackName, 'black'));

    const boardEl = document.createElement('div'); boardEl.id = 'board';
    const legalMoves = selected ? getLegalMoves(selected.r, selected.c, boardState, moveHistory, hasMoved) : [];
    for (let r of range) {
        for (let c of range) {
            const sq = document.createElement('div');
            sq.className = `square ${(r+c)%2===0 ? 'white-sq' : 'black-sq'}`;
            const isLegal = legalMoves.some(m => m.r === r && m.c === c);
            if (isLegal) {
                const dot = document.createElement('div');
                dot.className = boardState[r][c] === '' ? 'move-dot' : 'capture-circle';
                sq.appendChild(dot);
            }
            if (boardState[r][c]) {
                const s = document.createElement('span');
                s.className = `piece ${isWhite(boardState[r][c]) ? 'w-piece' : 'b-piece'}`;
                s.textContent = boardState[r][c];
                sq.appendChild(s);
            }
            sq.onclick = () => {
                if (isSpectator || isGameOver || isPaused || currentTurn !== myColor) return;
                if (selected && isLegal) { handleActualMove(selected, {r, c}, true); selected = null; }
                else { if (getTeam(boardState[r][c]) === myColor) selected = {r, c}; else selected = null; }
                render();
            };
            boardEl.appendChild(sq);
        }
    }
    const cont = document.createElement('div'); cont.id = 'board-container';
    cont.appendChild(boardEl); gameArea.appendChild(cont);
    if (viewAs === 'black') gameArea.appendChild(createBar(blackName, 'black'));
    else gameArea.appendChild(createBar(whiteName, 'white'));
    layout.appendChild(gameArea);

    const side = document.createElement('div'); side.id = 'side-panel';
    side.innerHTML = `<div id="status-box"><div id="status-text">${forcedStatus || currentTurn.toUpperCase() + "'S TURN"}</div></div><div id="notification-area"></div><div class="btn-row"></div><div id="history-container"></div>`;
    const btnRow = side.querySelector('.btn-row');
    if (isSpectator) btnRow.innerHTML = `<button class="action-btn" onclick="boardFlipped = !boardFlipped; render();">Flip Board</button><button class="action-btn" onclick="location.reload()">Lobby</button>`;
    else btnRow.innerHTML = `<button class="action-btn" onclick="offerDraw()">Offer Draw</button><button class="action-btn" onclick="resignGame()">Resign</button>`;
    layout.appendChild(side);
    updateTimerDisplay();
}

// --- BOOTSTRAP ---

function initGameState() {
    boardState = [ ['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖'] ];
    currentTurn = 'white'; isGameOver = false; isPaused = false; hasMoved = {};
    if (gameSettings) { whiteTime = (parseInt(gameSettings.mins) * 60) + parseInt(gameSettings.secs); blackTime = whiteTime; increment = parseInt(gameSettings.inc) || 0; isInfinite = (whiteTime === 0); }
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isInfinite) startTimer();
    render();
}

function switchTab(t) {
    document.getElementById('create-sect').style.display = t === 'create' ? 'block' : 'none';
    document.getElementById('join-sect').style.display = t === 'join' ? 'block' : 'none';
    document.getElementById('tab-create').className = t === 'create' ? 'active' : '';
    document.getElementById('tab-join').className = t === 'join' ? 'active' : '';
}

function createRoom() {
    const pass = document.getElementById('roomPass').value.trim();
    const name = document.getElementById('uName').value.trim();
    if (!pass || !name) return alert("Fill all fields");
    currentPassword = pass; tempName = name;
    socket.emit("create-room", { password: pass, name, mins: document.getElementById('tMin').value, secs: document.getElementById('tSec').value, inc: document.getElementById('tInc').value, colorPref: 'random' });
}

function joinRoom() {
    const pass = document.getElementById('joinPass').value.trim();
    const name = document.getElementById('joinName').value.trim();
    if (!pass || !name) return alert("Fill all fields");
    currentPassword = pass; tempName = name;
    socket.emit("join-attempt", { password: pass });
}

function confirmJoin() {
    socket.emit("confirm-join", { password: currentPassword, name: tempName, isSpectator: false });
}

function confirmSpectate(pass) {
    currentPassword = pass; tempName = document.getElementById('specName').value;
    socket.emit("confirm-join", { password: pass, name: tempName, isSpectator: true });
}

function spectateGame(pass) { socket.emit("join-attempt", { password: pass, isSpectator: true }); }

function renderSpectatorLobby(rooms) {
    const container = document.getElementById('spectator-list');
    if (!container) return;
    container.innerHTML = `<hr><h3 style="color:#779556">Active Games</h3>`;
    const active = rooms.filter(r => r.status === "active");
    if (active.length === 0) container.innerHTML += `<p style="font-size:12px">No active matches.</p>`;
    active.forEach(r => {
        const item = document.createElement('div');
        item.style.cssText = "padding:10px; background:#1a1a1a; margin-bottom:5px; border-radius:4px;";
        item.innerHTML = `<div style="font-size:13px"><b>${r.whiteName}</b> vs <b>${r.blackName}</b></div><button class="action-btn" style="padding:4px 8px; font-size:11px; margin-top:5px" onclick="spectateGame('${r.password}')">Spectate</button>`;
        container.appendChild(item);
    });
}

function showSetup() {
    const overlay = document.createElement('div'); overlay.id = 'setup-overlay';
    overlay.innerHTML = `<div class="setup-card"><div class="tabs"><button id="tab-create" class="active" onclick="switchTab('create')">Create</button><button id="tab-join" onclick="switchTab('join')">Join</button></div><div id="create-sect"><div class="input-group"><label>Room Password</label><input id="roomPass" placeholder="Secret Code"></div><div class="input-group"><label>Your Name</label><input id="uName" value="Player 1"></div><div class="input-group"><label>Time Control</label><div style="display:flex; gap:5px;"><input type="number" id="tMin" value="10"><input type="number" id="tSec" value="0"><input type="number" id="tInc" value="0"></div></div><button class="start-btn" onclick="createRoom()">CREATE</button></div><div id="join-sect" style="display:none;"><div class="input-group"><label>Room Password</label><input id="joinPass" placeholder="Enter Password"></div><div class="input-group"><label>Your Name</label><input id="joinName" value="Player 2"></div><button class="start-btn" onclick="joinRoom()">FIND ROOM</button></div></div>`;
    document.body.appendChild(overlay);
}

window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;
    keyBuffer += e.key;
    if (keyBuffer.length > 2) keyBuffer = keyBuffer.slice(-2);
    if (keyBuffer === "[]") {
        if (!currentPassword) {
            const card = document.querySelector('.setup-card');
            if (card && !document.getElementById('spectator-list')) {
                const listDiv = document.createElement('div'); listDiv.id = 'spectator-list'; listDiv.style.marginTop = '20px';
                card.appendChild(listDiv); appendChatMessage("System", "Lobby enabled.", true);
            }
        } else { isAdmin = true; appendChatMessage("Console", "Admin enabled.", true); }
        keyBuffer = "";
    }
});

function formatTime(s) { const m = Math.floor(s / 60); const rs = s % 60; return `${m}:${rs < 10 ? '0' : ''}${rs}`; }
function updateTimerDisplay() {
    const tw = document.getElementById('timer-white'), tb = document.getElementById('timer-black');
    if (tw) { tw.textContent = formatTime(whiteTime); tw.classList.toggle('active', currentTurn === 'white'); }
    if (tb) { tb.textContent = formatTime(blackTime); tb.classList.toggle('active', currentTurn === 'black'); }
}
function startTimer() {
    window.chessIntervalInstance = setInterval(() => {
        if (isGameOver || isPaused) return;
        if (currentTurn === 'white') { whiteTime--; if (whiteTime <= 0) endGame("BLACK WINS ON TIME"); }
        else { blackTime--; if (blackTime <= 0) endGame("WHITE WINS ON TIME"); }
        updateTimerDisplay();
    }, 1000);
}
function endGame(s) { isGameOver = true; if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance); showResultModal(s); render(s); }
function showStatusMessage(m) { const a = document.getElementById('notification-area'); if (a) { a.textContent = m; setTimeout(() => a.textContent = '', 3000); } }
function offerDraw() { socket.emit("offer-draw", { password: currentPassword }); showStatusMessage("Draw offer sent"); }
function resignGame() { const win = myColor === 'white' ? 'black' : 'white'; socket.emit("resign", { password: currentPassword, winner: win }); }
function showDrawOffer() { const a = document.getElementById('notification-area'); a.innerHTML = `<div class="draw-modal">Opponent offers a draw.<div class="modal-btns"><button class="accept-btn" onclick="respondDraw(true)">Accept</button><button class="decline-btn" onclick="respondDraw(false)">Decline</button></div></div>`; }
function respondDraw(acc) { socket.emit("draw-response", { password: currentPassword, accepted: acc }); document.getElementById('notification-area').innerHTML = ''; }
function showResultModal(text) {
    const overlay = document.createElement('div'); overlay.id = 'game-over-overlay';
    overlay.innerHTML = `<div class="result-card"><h2>Game Over</h2><p>${text}</p><div class="modal-btns-vertical"><button id="rematch-btn" onclick="requestRematch()">Request Rematch</button><button class="action-btn" onclick="closeModal()">View Board</button><button class="action-btn" style="background:#444" onclick="location.reload()">New Game</button></div></div>`;
    document.body.appendChild(overlay);
}
function requestRematch() {
    const btn = document.getElementById('rematch-btn');
    if (rematchRequested) { rematchRequested = false; btn.innerText = "Request Rematch"; btn.classList.remove('cancel-state'); }
    else { rematchRequested = true; btn.innerText = "Cancel Rematch"; btn.classList.add('cancel-state'); }
    socket.emit("rematch-request", { password: currentPassword });
}
function closeModal() { document.getElementById('game-over-overlay').style.display = 'none'; if (!document.getElementById('reopen-results-btn')) { const btn = document.createElement('button'); btn.id = 'reopen-results-btn'; btn.className = 'action-btn'; btn.style.marginTop = '10px'; btn.textContent = 'Show Result'; btn.onclick = () => { document.getElementById('game-over-overlay').style.display = 'flex'; }; document.getElementById('side-panel').appendChild(btn); } }

window.onload = showSetup;
