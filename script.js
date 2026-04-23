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

const isWhite = (piece) => ['♖', '♙', '♘', '♗', '♕', '♔'].includes(piece);
const getTeam = (piece) => piece === '' ? null : (isWhite(piece) ? 'white' : 'black');

function canMoveTo(fR, fC, tR, tC, piece, board) {
    const dr = tR - fR, dc = tC - fC, adr = Math.abs(dr), adc = Math.abs(dc), team = getTeam(piece), target = board[tR][tC];
    if (target !== '' && getTeam(target) === team) return false;
    const path = (r1, c1, r2, c2) => {
        const sR = r2 === r1 ? 0 : (r2 - r1) / Math.abs(r2 - r1), sC = c2 === c1 ? 0 : (c2 - c1) / Math.abs(c2 - c1);
        let cR = r1 + sR, cC = c1 + sC;
        while (cR !== r2 || cC !== c2) { if (board[cR][cC] !== '') return false; cR += sR; cC += sC; }
        return true;
    };
    if (piece === '♙' || piece === '♟') {
        const dir = team === 'white' ? -1 : 1;
        if (dc === 0 && target === '') {
            if (dr === dir) return true;
            if (dr === 2 * dir && fR === (team === 'white' ? 6 : 1) && board[fR + dir][fC] === '') return true;
        }
        if (adc === 1 && dr === dir) {
            if (target !== '') return true;
            if (enPassantTarget && enPassantTarget.r === tR && enPassantTarget.c === tC) return true;
        }
        return false;
    }
    if (piece === '♖' || piece === '♜') return (dr === 0 || dc === 0) && path(fR, fC, tR, tC);
    if (piece === '♘' || piece === '♞') return (adr === 2 && adc === 1) || (adr === 1 && adc === 2);
    if (piece === '♗' || piece === '♝') return adr === adc && path(fR, fC, tR, tC);
    if (piece === '♕' || piece === '♛') return (adr === adc || dr === 0 || dc === 0) && path(fR, fC, tR, tC);
    if (piece === '♔' || piece === '♚') {
        if (adc === 2) {
            if (hasMoved[`${fR},${fC}`]) return false;
            const rCol = tC === 6 ? 7 : 0;
            if (board[fR][rCol] === '' || hasMoved[`${fR},${rCol}`]) return false;
            return path(fR, fC, fR, rCol);
        }
        return adr <= 1 && adc <= 1;
    }
    return false;
}

function isSquareAttacked(r, c, atkTeam, board) {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        if (board[i][j] !== '' && getTeam(board[i][j]) === atkTeam) {
            if (canMoveTo(i, j, r, c, board[i][j], board)) return true;
        }
    }
    return false;
}

function isTeamInCheck(team, board) {
    let kR, kC, k = team === 'white' ? '♔' : '♚';
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(board[r][c]===k) { kR=r; kC=c; }
    return isSquareAttacked(kR, kC, team === 'white' ? 'black' : 'white', board);
}

function getLegalMoves(team) {
    let moves = [];
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) {
        if(getTeam(boardState[r][c]) === team) {
            for(let tr=0; tr<8; tr++) for(let tc=0; tc<8; tc++) {
                if(canMoveTo(r, c, tr, tc, boardState[r][c], boardState)) {
                    const b = boardState.map(row => [...row]);
                    b[tr][tc] = b[r][c]; b[r][c] = '';
                    if(!isTeamInCheck(team, b)) moves.push({from:{r,c}, to:{r:tr, c:tc}});
                }
            }
        }
    }
    return moves;
}

function handleActualMove(from, to, isLocal) {
    const p = boardState[from.r][from.c];
    if((p==='♔'||p==='♚') && Math.abs(from.c-to.c)===2) {
        const rO = to.c===6?7:0, rN = to.c===6?5:3;
        boardState[to.r][rN] = boardState[to.r][rO]; boardState[to.r][rO] = '';
    }
    boardState[to.r][to.c] = p; boardState[from.r][from.c] = '';
    if(p==='♙' && to.r===0) boardState[to.r][to.c]='♕';
    if(p==='♟' && to.r===7) boardState[to.r][to.c]='♛';
    
    if(!isInfinite && isLocal) { if(currentTurn==='white') whiteTime+=increment; else blackTime+=increment; }
    currentTurn = currentTurn === 'white' ? 'black' : 'white';
    selected = null;
    if(isLocal) socket.emit("send-move", { password: currentPassword, move: {from, to}, whiteTime, blackTime });
    render();
}

// --- UI & RENDER ---

function render(forcedStatus) {
    const layout = document.getElementById('main-layout');
    if (!layout) return;
    const oldVal = document.getElementById('chat-input')?.value || "";
    const oldHist = document.getElementById('chat-messages')?.innerHTML || "";

    layout.innerHTML = `
        <div id="chat-panel">
            <div id="chat-header">GAME CHAT</div>
            <div id="chat-messages">${oldHist}</div>
            <div id="chat-input-area"><input id="chat-input" value="${oldVal}"><button onclick="sendChatMessage()">Send</button></div>
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
    const legals = (selected && currentTurn === myColor) ? getLegalMoves(myColor).filter(m => m.from.r === selected.r && m.from.c === selected.c) : [];

    for(let r of range) for(let c of range) {
        const sq = document.createElement('div');
        sq.className = `square ${(r+c)%2===0?'white-sq':'black-sq'}`;
        const piece = boardState[r][c];
        if(selected?.r===r && selected?.c===c) sq.classList.add('selected');
        
        const move = legals.find(m => m.to.r === r && m.to.c === c);
        if(move) {
            const hint = document.createElement('div');
            hint.className = piece === '' ? 'hint-dot' : 'hint-capture';
            sq.appendChild(hint);
        }

        if(piece !== '') {
            const s = document.createElement('span');
            s.className = `piece ${isWhite(piece)?'w-piece':'b-piece'}`;
            s.textContent = piece;
            sq.appendChild(s);
        }

        sq.onclick = () => {
            if(isPaused || isGameOver || currentTurn !== myColor) return;
            if(move) handleActualMove(selected, {r,c}, true);
            else if(getTeam(piece) === myColor) { selected = {r,c}; render(); }
            else { selected = null; render(); }
        };
        b.appendChild(sq);
    }
    updateTimerDisplay();
}

function startTimer() {
    window.chessIntervalInstance = setInterval(() => {
        if(isGameOver || isPaused) return;
        if(currentTurn==='white') whiteTime--; else blackTime--;
        updateTimerDisplay();
        if(whiteTime<=0 || blackTime<=0) {
            isGameOver=true; clearInterval(window.chessIntervalInstance);
            showResultModal(whiteTime<=0?"BLACK WINS":"WHITE WINS");
        }
    }, 1000);
}

function updateTimerDisplay() {
    const w = document.getElementById('timer-white'), b = document.getElementById('timer-black');
    if(w) { w.textContent = formatTime(whiteTime); w.className = `timer ${currentTurn==='white'?'active':''}`; }
    if(b) { b.textContent = formatTime(blackTime); b.className = `timer ${currentTurn==='black'?'active':''}`; }
}

function formatTime(s) { if(isInfinite) return "∞"; const m=Math.floor(s/60), sec=s%60; return `${m}:${sec.toString().padStart(2,'0')}`;}

function initGameState() {
    boardState = [
        ['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],
        ['','','','','','','',''],['','','','','','','',''],
        ['','','','','','','',''],['','','','','','','',''],
        ['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']
    ];
    currentTurn='white'; hasMoved={}; isGameOver=false;
    if(gameSettings) { whiteTime=parseInt(gameSettings.mins)*60+parseInt(gameSettings.secs); blackTime=whiteTime; increment=parseInt(gameSettings.inc); isInfinite=(whiteTime===0); }
    if(window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if(!isInfinite) startTimer();
    render();
}

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
                <input id="roomPass" placeholder="Password"><br><br>
                <input id="uName" placeholder="Name" value="Player 1"><br><br>
                <input type="number" id="tMin" value="10" style="width:50px"> : <input type="number" id="tSec" value="0" style="width:50px"><br><br>
                <button class="start-btn" onclick="createRoom()">CREATE</button>
            </div>
            <div id="join-sect" style="display:none;">
                <input id="joinPass" placeholder="Password"><br><br>
                <input id="joinName" placeholder="Name" value="Player 2"><br><br>
                <button class="start-btn" onclick="joinRoom()">JOIN</button>
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
    `;
    document.body.appendChild(ov);
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
function showStatusMessage(msg) { const area = document.getElementById('notification-area'); if(area) area.innerText = msg; }

window.onload = showSetup;
