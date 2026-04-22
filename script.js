const socket = io("https://algebra-but-better.onrender.com");

// Game State Variables
let myColor = null, currentPassword = null, tempName = ""; 
let whiteName = "White", blackName = "Black"; 
let boardState, currentTurn, hasMoved, enPassantTarget, selected, isGameOver, isInfinite;
let whiteTime, blackTime, increment, moveHistory = [];
let rematchRequested = false;
let gameSettings = null;

// --- 1. SOCKET LISTENERS ---

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
    
    document.getElementById('setup-overlay')?.remove();
    initGameState();
    appendChatMessage("System", `Game started! You are playing as ${myColor.toUpperCase()}.`, true);
});

socket.on("receive-chat", (data) => {
    appendChatMessage(data.sender, data.message);
});

socket.on("receive-move", (data) => {
    whiteTime = data.whiteTime;
    blackTime = data.blackTime;
    handleActualMove(data.move.from, data.move.to, false);
});

socket.on("opponent-resigned", (data) => {
    const status = `${data.winner.toUpperCase()} WINS BY RESIGNATION`;
    isGameOver = true;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    appendChatMessage("System", status, true);
    showResultModal(status);
    render(status);
});

socket.on("draw-offered", () => showDrawOffer());

socket.on("draw-resolved", (data) => {
    if (data.accepted) {
        const status = "GAME DRAWN BY AGREEMENT";
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        appendChatMessage("System", status, true);
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

socket.on("rematch-start", () => {
    rematchRequested = false;
    // Swap colors for the rematch
    myColor = (myColor === 'white' ? 'black' : 'white');
    let oldWhite = whiteName;
    whiteName = blackName;
    blackName = oldWhite;

    document.getElementById('game-over-overlay')?.remove();
    document.getElementById('reopen-results-btn')?.remove();
    initGameState();
    appendChatMessage("System", "Rematch started! Colors swapped.", true);
});

socket.on("error-msg", (msg) => alert(msg));

// --- 2. LOBBY & CHAT UI ---

function showSetup() {
    const overlay = document.createElement('div');
    overlay.id = 'setup-overlay';
    overlay.innerHTML = `
        <div class="setup-card">
            <div class="tabs"><button id="tab-create" class="active" onclick="switchTab('create')">Create</button><button id="tab-join" onclick="switchTab('join')">Join</button></div>
            <div id="create-sect">
                <div class="input-group"><label>Room Password</label><input id="roomPass" placeholder="Secret Code"></div>
                <div class="input-group"><label>Username</label><input id="uName" value="Player 1"></div>
                <div class="input-group"><label>Time Control</label><div style="display:flex; gap:5px;"><input type="number" id="tMin" value="10"><input type="number" id="tSec" value="0"><input type="number" id="tInc" value="0"></div></div>
                <div class="input-group"><label>Play As</label><select id="colorPref"><option value="random">Random</option><option value="white">White</option><option value="black">Black</option></select></div>
                <button class="start-btn" onclick="createRoom()">CREATE</button>
            </div>
            <div id="join-sect" style="display:none;">
                <div class="input-group"><label>Room Password</label><input id="joinPass" placeholder="Password"></div>
                <div class="input-group"><label>Username</label><input id="joinName" value="Player 2"></div>
                <button class="start-btn" onclick="joinRoom()">FIND ROOM</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
}

function switchTab(t) {
    document.getElementById('create-sect').style.display = t === 'create' ? 'block' : 'none';
    document.getElementById('join-sect').style.display = t === 'join' ? 'block' : 'none';
    document.getElementById('tab-create').className = t === 'create' ? 'active' : '';
    document.getElementById('tab-join').className = t === 'join' ? 'active' : '';
}

function createRoom() {
    currentPassword = document.getElementById('roomPass').value;
    tempName = document.getElementById('uName').value;
    if(!currentPassword) return alert("Enter password");
    socket.emit("create-room", { password: currentPassword, name: tempName, mins: document.getElementById('tMin').value, secs: document.getElementById('tSec').value, inc: document.getElementById('tInc').value, colorPref: document.getElementById('colorPref').value });
}

function joinRoom() {
    currentPassword = document.getElementById('joinPass').value;
    tempName = document.getElementById('joinName').value;
    if(!currentPassword) return alert("Enter password");
    socket.emit("join-attempt", { password: currentPassword });
}

function confirmJoin() { socket.emit("confirm-join", { password: currentPassword, name: tempName }); }

function appendChatMessage(sender, message, isSystem = false) {
    const msgContainer = document.getElementById('chat-messages');
    if (!msgContainer) return;
    const div = document.createElement('div');
    div.className = isSystem ? 'chat-msg system' : 'chat-msg';
    div.innerHTML = isSystem ? message : `<b>${sender}:</b> ${message}`;
    msgContainer.appendChild(div);
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

// --- 3. CHESS RULES & LOGIC ---

const isWhite = (c) => ['♖', '♘', '♗', '♕', '♔', '♙'].includes(c);
const getTeam = (c) => c === '' ? null : (isWhite(c) ? 'white' : 'black');

function canMoveTo(fR, fC, tR, tC, p, b) {
    const dr = tR-fR, dc = tC-fC, adr = Math.abs(dr), adc = Math.abs(dc), team = getTeam(p);
    const target = b[tR][tC];
    if (target !== '' && getTeam(target) === team) return false;

    const clearPath = (r1, c1, r2, c2) => {
        const sr = r2 === r1 ? 0 : (r2-r1)/Math.abs(r2-r1), sc = c2 === c1 ? 0 : (c2-c1)/Math.abs(c2-c1);
        let cr = r1+sr, cc = c1+sc;
        while(cr !== r2 || cc !== c2) { if (b[cr][cc] !== '') return false; cr+=sr; cc+=sc; }
        return true;
    };

    if (p === '♙' || p === '♟') {
        const dir = team === 'white' ? -1 : 1;
        if (dc === 0 && target === '') {
            return dr === dir || (dr === 2*dir && fR === (team === 'white'?6:1) && b[fR+dir][fC] === '');
        }
        if (adc === 1 && dr === dir) {
            return target !== '' || (enPassantTarget && enPassantTarget.r === tR && enPassantTarget.c === tC);
        }
        return false;
    }
    if (['♖','♜'].includes(p)) return (dr===0 || dc===0) && clearPath(fR,fC,tR,tC);
    if (['♘','♞'].includes(p)) return (adr===2 && adc===1) || (adr===1 && adc===2);
    if (['♗','♝'].includes(p)) return adr===adc && clearPath(fR,fC,tR,tC);
    if (['♕','♛'].includes(p)) return (adr===adc || dr===0 || dc===0) && clearPath(fR,fC,tR,tC);
    if (['♔','♚'].includes(p)) return adr<=1 && adc<=1;
    return false;
}

function isSquareAttacked(r, c, attackerTeam, b) {
    for(let i=0; i<8; i++) {
        for(let j=0; j<8; j++) {
            const p = b[i][j];
            if(p !== '' && getTeam(p) === attackerTeam) {
                // Simplified attack check for pawns
                if (p === '♙' || p === '♟') {
                    const dir = getTeam(p) === 'white' ? -1 : 1;
                    if (Math.abs(c - j) === 1 && r - i === dir) return true;
                } else if (canMoveTo(i, j, r, c, p, b)) return true;
            }
        }
    }
    return false;
}

function isTeamInCheck(team, b) {
    let kR, kC, king = team === 'white' ? '♔' : '♚';
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(b[r][c] === king) { kR=r; kC=c; }
    return isSquareAttacked(kR, kC, team === 'white' ? 'black' : 'white', b);
}

function isMoveLegal(fR, fC, tR, tC, team) {
    const p = boardState[fR][fC];
    if (!canMoveTo(fR, fC, tR, tC, p, boardState)) return false;
    const nextBoard = boardState.map(row => [...row]);
    nextBoard[tR][tC] = p;
    nextBoard[fR][fC] = '';
    return !isTeamInCheck(team, nextBoard);
}

function getLegalMoves(team) {
    let moves = [];
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) {
        if(getTeam(boardState[r][c]) === team) {
            for(let tr=0; tr<8; tr++) for(let tc=0; tc<8; tc++) {
                if(isMoveLegal(r, c, tr, tc, team)) moves.push({from: {r,c}, to: {r:tr, c:tc}});
            }
        }
    }
    return moves;
}

// --- 4. GAME ACTIONS ---

function handleActualMove(from, to, isLocal) {
    if (isGameOver) return;
    const piece = boardState[from.r][from.c];
    boardState[to.r][to.c] = piece;
    boardState[from.r][from.c] = '';

    if (!isInfinite && isLocal) {
        if (currentTurn === 'white') whiteTime += increment;
        else blackTime += increment;
    }

    currentTurn = currentTurn === 'white' ? 'black' : 'white';
    const nextMoves = getLegalMoves(currentTurn);
    let forcedStatus = null;

    if (nextMoves.length === 0) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        forcedStatus = isTeamInCheck(currentTurn, boardState) ? `CHECKMATE! ${getTeam(piece).toUpperCase()} WINS` : "DRAW BY STALEMATE";
        showResultModal(forcedStatus);
    }

    if (isLocal) socket.emit("send-move", { password: currentPassword, move: { from, to }, whiteTime, blackTime });
    selected = null;
    render(forcedStatus);
}

function resignGame() {
    if (isGameOver) return;
    const winner = myColor === 'white' ? 'black' : 'white';
    socket.emit("resign", { password: currentPassword, winner: winner });
    const status = `${winner.toUpperCase()} WINS BY RESIGNATION`;
    isGameOver = true;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    showResultModal(status);
    render(status);
}

function offerDraw() {
    if (isGameOver) return;
    socket.emit("offer-draw", { password: currentPassword });
    showStatusMessage("Draw offer sent...");
}

function showDrawOffer() {
    const area = document.getElementById('notification-area');
    if (!area) return;
    area.innerHTML = `<div class="draw-modal">Opponent offers a draw<div class="modal-btns"><button class="accept-btn" onclick="respondToDraw(true)">Accept</button><button class="decline-btn" onclick="respondToDraw(false)">Decline</button></div></div>`;
}

function respondToDraw(accepted) {
    socket.emit("draw-response", { password: currentPassword, accepted: accepted });
    document.getElementById('notification-area').innerHTML = '';
}

function showStatusMessage(msg) {
    const area = document.getElementById('notification-area');
    if (!area) return;
    area.innerHTML = `<div class="status-msg">${msg}</div>`;
    setTimeout(() => { area.innerHTML = ''; }, 3000);
}

function requestRematch() {
    if (rematchRequested) return;
    rematchRequested = true;
    const btn = document.getElementById('rematch-btn');
    if (btn) { btn.innerText = "Waiting..."; btn.disabled = true; }
    socket.emit("rematch-request", { password: currentPassword });
}

function showResultModal(txt) {
    document.getElementById('game-over-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'game-over-overlay';
    overlay.innerHTML = `
        <div class="result-card">
            <h2>Game Over</h2>
            <p>${txt}</p>
            <div class="modal-btns-vertical">
                <button id="rematch-btn" class="start-btn" onclick="requestRematch()">Request Rematch</button>
                <button class="action-btn" style="margin-top:10px; width:100%" onclick="location.reload()">Exit</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
}

// --- 5. CORE RENDERER ---

function render(forcedStatus) {
    const layout = document.getElementById('main-layout');
    if (!layout) return;

    // Preserve Chat/Input states
    const oldChatHTML = document.getElementById('chat-messages')?.innerHTML || "";
    const oldInputValue = document.getElementById('chat-input')?.value || "";

    layout.replaceChildren();

    // COLUMN 1: CHAT
    const chatPanel = document.createElement('div');
    chatPanel.id = 'chat-panel';
    chatPanel.innerHTML = `
        <div id="chat-header">Game Chat</div>
        <div id="chat-messages">${oldChatHTML}</div>
        <div id="chat-input-area">
            <input type="text" id="chat-input" placeholder="Say hello..." autocomplete="off" value="${oldInputValue}">
            <button id="chat-send-btn">Send</button>
        </div>`;
    
    const sendMsg = () => {
        const inp = chatPanel.querySelector('#chat-input');
        if (inp.value.trim()) {
            const name = myColor === 'white' ? whiteName : blackName;
            socket.emit("send-chat", { password: currentPassword, message: inp.value, senderName: name });
            appendChatMessage("You", inp.value);
            inp.value = '';
        }
    };
    chatPanel.querySelector('#chat-send-btn').onclick = sendMsg;
    chatPanel.querySelector('#chat-input').onkeypress = (e) => e.key === 'Enter' && sendMsg();
    layout.appendChild(chatPanel);

    // COLUMN 2: BOARD
    const gameArea = document.createElement('div');
    gameArea.id = 'game-area';
    const createBar = (name, id) => {
        const div = document.createElement('div'); div.className = 'player-bar';
        div.innerHTML = `<span>${name} ${myColor === id ? '(You)' : ''}</span><div id="timer-${id}" class="timer"></div>`;
        return div;
    };

    gameArea.appendChild(createBar(myColor === 'white' ? blackName : whiteName, myColor === 'white' ? 'black' : 'white'));
    const bCont = document.createElement('div'); bCont.id = 'board-container';
    const boardEl = document.createElement('div'); boardEl.id = 'board';

    const range = (myColor === 'black') ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    let hints = selected ? getLegalMoves(currentTurn).filter(m => m.from.r === selected.r && m.from.c === selected.c).map(m => m.to) : [];

    for(let r of range) {
        for(let c of range) {
            const sq = document.createElement('div');
            const piece = boardState[r][c];
            sq.className = `square ${(r+c)%2===0 ? 'white-sq' : 'black-sq'}`;
            if(selected?.r===r && selected?.c===c) sq.classList.add('selected');
            if(hints.some(h => h.r===r && h.c===c)) {
                const dot = document.createElement('div');
                dot.className = piece === '' ? 'hint-dot' : 'hint-capture';
                sq.appendChild(dot);
            }
            if(piece) {
                const sp = document.createElement('span');
                sp.className = `piece ${isWhite(piece)?'w-piece':'b-piece'}`;
                sp.textContent = piece;
                sq.appendChild(sp);
            }
            sq.onclick = () => {
                if(isGameOver || currentTurn !== myColor) return;
                if(selected && hints.some(h => h.r === r && h.c === c)) handleActualMove(selected, {r,c}, true);
                else { selected = getTeam(piece) === currentTurn ? {r,c} : null; render(); }
            };
            boardEl.appendChild(sq);
        }
    }
    bCont.appendChild(boardEl); gameArea.appendChild(bCont);
    gameArea.appendChild(createBar(myColor === 'white' ? whiteName : blackName, myColor === 'white' ? 'white' : 'black'));
    layout.appendChild(gameArea);

    // COLUMN 3: INFO
    const side = document.createElement('div'); side.id = 'side-panel';
    side.innerHTML = `
        <div id="status-box">${forcedStatus || (isGameOver ? "GAME OVER" : currentTurn.toUpperCase()+"'S TURN")}</div>
        <div id="notification-area"></div>
        <div id="history-container"></div>
        <div class="btn-row">
            <button class="action-btn" onclick="offerDraw()" ${isGameOver ? 'disabled' : ''}>Draw</button>
            <button class="action-btn" onclick="resignGame()" ${isGameOver ? 'disabled' : ''}>Resign</button>
        </div>`;
    layout.appendChild(side);
    
    updateTimerDisplay();
}

function initGameState() {
    boardState = [
        ['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],
        ['','','','','','','',''],['','','','','','','',''],
        ['','','','','','','',''],['','','','','','','',''],
        ['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']
    ];
    currentTurn = 'white'; hasMoved = {}; moveHistory = []; isGameOver = false; selected = null; rematchRequested = false;

    if (gameSettings) {
        whiteTime = (parseInt(gameSettings.mins) * 60) + parseInt(gameSettings.secs);
        blackTime = whiteTime;
        increment = parseInt(gameSettings.inc) || 0;
        isInfinite = (whiteTime === 0);
    }

    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isInfinite) {
        window.chessIntervalInstance = setInterval(() => {
            if (isGameOver) return;
            if (currentTurn === 'white') whiteTime--; else blackTime--;
            updateTimerDisplay();
            if (whiteTime <= 0 || blackTime <= 0) { 
                isGameOver = true; clearInterval(window.chessIntervalInstance);
                const winMsg = whiteTime <= 0 ? "BLACK WINS ON TIME" : "WHITE WINS ON TIME";
                showResultModal(winMsg);
                render(winMsg); 
            }
        }, 1000);
    }
    render();
}

function updateTimerDisplay() {
    const wT = document.getElementById('timer-white'), bT = document.getElementById('timer-black');
    if (wT) { wT.textContent = formatTime(whiteTime); wT.className = `timer ${currentTurn === 'white' && !isGameOver ? 'active' : ''}`; }
    if (bT) { bT.textContent = formatTime(blackTime); bT.className = `timer ${currentTurn === 'black' && !isGameOver ? 'active' : ''}`; }
}

function formatTime(s) { 
    if(isInfinite) return "∞"; 
    const dS=Math.max(0,s); 
    return `${Math.floor(dS/60)}:${(dS%60).toString().padStart(2,'0')}`; 
}

window.onload = showSetup;
