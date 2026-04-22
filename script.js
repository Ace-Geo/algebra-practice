const socket = io("https://algebra-but-better.onrender.com");
let myColor = null, currentPassword = null, tempName = ""; 
let whiteName = "White", blackName = "Black"; 
let boardState, currentTurn, hasMoved, enPassantTarget, selected, isGameOver, isInfinite;
let whiteTime, blackTime, increment, moveHistory = [];
let rematchRequested = false;
let gameSettings = null; // Store settings for resets

// --- 1. SOCKET LISTENERS ---
socket.on("player-assignment", (data) => {
    myColor = data.color;
    gameSettings = data.settings; // Save settings globally
    
    if (myColor === 'white') {
        whiteName = tempName || "White";
        blackName = data.oppName;
    } else {
        blackName = tempName || "Black";
        whiteName = data.oppName;
    }
    
    document.getElementById('setup-overlay')?.remove();
    initGameState();
});

socket.on("room-created", (data) => {
    const card = document.querySelector('.setup-card');
    card.innerHTML = `<h2 style="color: #779556">Room Created</h2><p>Waiting for someone to join with password: <br><strong>${data.password}</strong></p><div class="loader"></div><button class="action-btn" onclick="location.reload()">Cancel</button>`;
});

socket.on("preview-settings", (data) => {
    const card = document.querySelector('.setup-card');
    const s = data.settings;
    let displayColor = data.creatorColorPref === 'white' ? "BLACK" : (data.creatorColorPref === 'black' ? "WHITE" : "RANDOM");
    card.innerHTML = `<h2 style="color: #779556">Join Room?</h2><div style="text-align: left; margin-bottom: 20px; background: #1a1a1a; padding: 15px; border-radius: 8px;"><p><strong>Host:</strong> ${data.creatorName}</p><p><strong>Time:</strong> ${s.mins}m ${s.secs}s</p><p><strong>Inc:</strong> ${s.inc}s</p><p><strong>Your Side:</strong> ${displayColor}</p></div><button class="start-btn" onclick="confirmJoin()">CONFIRM & START</button><button class="action-btn" style="margin-top:10px" onclick="location.reload()">Back</button>`;
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
    showResultModal(status);
    render(status);
});

socket.on("draw-offered", () => showDrawOffer());

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
});

socket.on("error-msg", (msg) => alert(msg));

// --- 2. LOBBY UI ---
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

// --- 3. CORE CHESS LOGIC ---
const isWhite = (c) => ['♖', '♘', '♗', '♕', '♔', '♙'].includes(c);
const getTeam = (c) => c === '' ? null : (isWhite(c) ? 'white' : 'black');
const getPieceNotation = (p) => {
    const map = {'♖':'R','♘':'N','♗':'B','♕':'Q','♔':'K','♜':'R','♞':'N','♝':'B','♛':'Q','♚':'K'};
    return map[p] || '';
};

function getNotation(fR, fC, tR, tC, piece, target, isEP, castle) {
    if (castle) return castle === 'short' ? 'O-O' : 'O-O-O';
    const files = ['a','b','c','d','e','f','g','h'], rows = ['8','7','6','5','4','3','2','1'];
    let p = getPieceNotation(piece), cap = (target !== '' || isEP) ? 'x' : '';
    if (p === '' && cap) p = files[fC]; 
    return p + cap + files[tC] + rows[tR];
}

function canAttackSquare(fR, fC, tR, tC, p, b) {
    const dr = tR-fR, dc = tC-fC, adr = Math.abs(dr), adc = Math.abs(dc), team = getTeam(p);
    const clearPath = (r1, c1, r2, c2) => {
        const sr = r2 === r1 ? 0 : (r2-r1)/Math.abs(r2-r1), sc = c2 === c1 ? 0 : (c2-c1)/Math.abs(c2-c1);
        let cr = r1+sr, cc = c1+sc;
        while(cr !== r2 || cc !== c2) { if (b[cr][cc] !== '') return false; cr+=sr; cc+=sc; }
        return true;
    };
    if (p === '♙' || p === '♟') {
        const dir = team === 'white' ? -1 : 1;
        return adc === 1 && dr === dir;
    }
    if (['♖','♜'].includes(p)) return (dr===0 || dc===0) && clearPath(fR,fC,tR,tC);
    if (['♘','♞'].includes(p)) return (adr===2 && adc===1) || (adr===1 && adc===2);
    if (['♗','♝'].includes(p)) return adr===adc && clearPath(fR,fC,tR,tC);
    if (['♕','♛'].includes(p)) return (adr===adc || dr===0 || dc===0) && clearPath(fR,fC,tR,tC);
    if (['♔','♚'].includes(p)) return adr<=1 && adc<=1;
    return false;
}

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
    if (['♔','♚'].includes(p) && adc === 2) {
        if (hasMoved[`${fR},${fC}`] || isSquareAttacked(fR, fC, team === 'white' ? 'black' : 'white', b)) return false;
        const rC = tC === 6 ? 7 : 0, rPiece = b[fR][rC];
        return rPiece !== '' && !hasMoved[`${fR},${rC}`] && clearPath(fR, fC, fR, rC);
    }
    return canAttackSquare(fR, fC, tR, tC, p, b);
}

function isSquareAttacked(r, c, attackerTeam, b) {
    for(let i=0; i<8; i++) {
        for(let j=0; j<8; j++) {
            const p = b[i][j];
            if(p !== '' && getTeam(p) === attackerTeam && canAttackSquare(i, j, r, c, p, b)) return true;
        }
    }
    return false;
}

function getKingPos(team, b) {
    const k = team === 'white' ? '♔' : '♚';
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(b[r][c] === k) return {r, c};
    return null;
}

function isTeamInCheck(team, b) {
    const pos = getKingPos(team, b);
    return pos ? isSquareAttacked(pos.r, pos.c, team === 'white' ? 'black' : 'white', b) : false;
}

function isMoveLegal(fR, fC, tR, tC, team) {
    const p = boardState[fR][fC];
    if (!canMoveTo(fR, fC, tR, tC, p, boardState)) return false;
    const nextBoard = boardState.map(row => [...row]);
    nextBoard[tR][tC] = p;
    nextBoard[fR][fC] = '';
    if ((p==='♙'||p==='♟') && enPassantTarget?.r === tR && enPassantTarget?.c === tC) nextBoard[fR][tC] = '';
    return !isTeamInCheck(team, nextBoard);
}

function getLegalMoves(team) {
    let moves = [];
    for(let r=0; r<8; r++) {
        for(let c=0; c<8; c++) {
            if(getTeam(boardState[r][c]) === team) {
                for(let tr=0; tr<8; tr++) {
                    for(let tc=0; tc<8; tc++) {
                        if(isMoveLegal(r, c, tr, tc, team)) moves.push({from: {r,c}, to: {r:tr, c:tc}});
                    }
                }
            }
        }
    }
    return moves;
}

// --- 4. GAME ACTIONS ---
function handleActualMove(from, to, isLocal) {
    if (isGameOver) return;
    const movingPiece = boardState[from.r][from.c];
    const targetPiece = boardState[to.r][to.c];
    const team = currentTurn;
    const isEP = (movingPiece === '♙' || movingPiece === '♟') && enPassantTarget?.r === to.r && enPassantTarget?.c === to.c;
    
    let castle = null;
    if ((movingPiece === '♔' || movingPiece === '♚') && Math.abs(from.c - to.c) === 2) {
        castle = from.c < to.c ? 'short' : 'long';
        const rO = to.c === 6 ? 7 : 0, rN = to.c === 6 ? 5 : 3;
        boardState[to.r][rN] = boardState[to.r][rO];
        boardState[to.r][rO] = '';
    }

    let note = getNotation(from.r, from.c, to.r, to.c, movingPiece, targetPiece, isEP, castle);

    if (isEP) boardState[from.r][to.c] = '';
    hasMoved[`${from.r},${from.c}`] = 1;
    boardState[to.r][to.c] = movingPiece;
    boardState[from.r][from.c] = '';
    
    if (movingPiece === '♙' && to.r === 0) boardState[to.r][to.c] = '♕'; 
    if (movingPiece === '♟' && to.r === 7) boardState[to.r][to.c] = '♛';

    if (!isInfinite && isLocal) {
        if (team === 'white') whiteTime += increment;
        else blackTime += increment;
    }

    enPassantTarget = (movingPiece === '♙' || movingPiece === '♟') && Math.abs(from.r - to.r) === 2 
        ? { r: (from.r + to.r) / 2, c: to.c } : null;

    currentTurn = (team === 'white' ? 'black' : 'white');
    
    const nextMoves = getLegalMoves(currentTurn);
    const inCheck = isTeamInCheck(currentTurn, boardState);
    let forcedStatus = null;

    if (nextMoves.length === 0) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        if (inCheck) {
            note += '#';
            forcedStatus = `CHECKMATE! ${team.toUpperCase()} WINS`;
        } else {
            forcedStatus = "DRAW BY STALEMATE";
        }
        showResultModal(forcedStatus);
    } else if (inCheck) {
        note += '+';
    }

    if (team === 'white') moveHistory.push({ w: note, b: '' });
    else if (moveHistory.length > 0) moveHistory[moveHistory.length - 1].b = note;

    selected = null;
    if (isLocal) socket.emit("send-move", { password: currentPassword, move: { from, to }, whiteTime, blackTime });
    render(forcedStatus);
}

function resignGame() {
    if (isGameOver) return;
    const winner = myColor === 'white' ? 'black' : 'white';
    const status = `${winner.toUpperCase()} WINS BY RESIGNATION`;
    isGameOver = true;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    socket.emit("resign", { password: currentPassword, winner: winner });
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

// --- GAME OVER MODAL HANDLERS ---
function showResultModal(txt) {
    document.getElementById('game-over-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'game-over-overlay';
    overlay.innerHTML = `
        <div class="result-card">
            <h2>Game Over</h2>
            <p id="result-desc">${txt}</p>
            <div class="modal-btns-vertical">
                <button id="rematch-btn" onclick="requestRematch()">Request Rematch</button>
                <button class="action-btn" onclick="closeModal()">View Position</button>
                <button class="action-btn" style="background:#444" onclick="location.reload()">Exit to Lobby</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
}

function requestRematch() {
    if (rematchRequested) return;
    rematchRequested = true;
    const btn = document.getElementById('rematch-btn');
    if (btn) {
        btn.innerText = "Waiting...";
        btn.disabled = true;
    }
    socket.emit("rematch-request", { password: currentPassword });
}

function closeModal() {
    const overlay = document.getElementById('game-over-overlay');
    if (overlay) overlay.style.display = 'none';
    if (!document.getElementById('reopen-results-btn')) {
        const btn = document.createElement('button');
        btn.id = 'reopen-results-btn';
        btn.className = 'action-btn';
        btn.style.marginTop = '10px';
        btn.textContent = 'View Game Result';
        btn.onclick = () => document.getElementById('game-over-overlay').style.display = 'flex';
        document.getElementById('side-panel').appendChild(btn);
    }
}

// --- 5. RENDERER ---
function render(forcedStatus) {
    const layout = document.getElementById('main-layout');
    if (!layout) return;
    layout.replaceChildren();

    const check = isTeamInCheck(currentTurn, boardState);
    let sTxt = forcedStatus || (isGameOver ? "GAME OVER" : `${currentTurn.toUpperCase()}'S TURN ${check ? '(CHECK!)' : ''}`);

    const gameArea = document.createElement('div'); gameArea.id = 'game-area';
    const createBar = (name, id) => {
        const div = document.createElement('div'); div.className = 'player-bar';
        div.innerHTML = `<span class="player-name">${name} ${myColor === id ? '(YOU)' : ''}</span><div id="timer-${id}" class="timer"></div>`;
        return div;
    };

    if(myColor === 'black') gameArea.appendChild(createBar(whiteName, 'white'));
    else gameArea.appendChild(createBar(blackName, 'black'));

    const boardCont = document.createElement('div'); boardCont.id = 'board-container';
    const boardEl = document.createElement('div'); boardEl.id = 'board';
    
    let hints = [];
    if(selected && !isGameOver) {
        hints = getLegalMoves(currentTurn).filter(m => m.from.r === selected.r && m.from.c === selected.c).map(m => m.to);
    }

    const range = (myColor === 'black') ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    for(let r of range) {
        for(let c of range) {
            const sq = document.createElement('div');
            const piece = boardState[r][c];
            sq.className = `square ${(r+c)%2===0 ? 'white-sq' : 'black-sq'}`;
            if (check && piece === (currentTurn === 'white' ? '♔' : '♚')) sq.classList.add('king-check');
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
                if(selected) {
                    if(selected.r === r && selected.c === c) {
                        selected = null; render();
                    } 
                    else if(hints.some(h => h.r === r && h.c === c)) {
                        handleActualMove(selected, {r,c}, true);
                    }
                    else { 
                        selected = getTeam(piece) === currentTurn ? {r,c} : null; render(); 
                    }
                } else if(getTeam(piece) === currentTurn) { selected = {r,c}; render(); }
            };
            boardEl.appendChild(sq);
        }
    }
    boardCont.appendChild(boardEl); gameArea.appendChild(boardCont);
    if(myColor === 'black') gameArea.appendChild(createBar(blackName, 'black'));
    else gameArea.appendChild(createBar(whiteName, 'white'));
    layout.appendChild(gameArea);

    const side = document.createElement('div'); side.id = 'side-panel';
    side.innerHTML = `<div id="status-box"><div id="status-text">${sTxt}</div></div><div id="notification-area"></div><div class="btn-row"><button class="action-btn" onclick="offerDraw()" ${isGameOver ? 'disabled' : ''}>Offer Draw</button><button class="action-btn" onclick="resignGame()" ${isGameOver ? 'disabled' : ''}>Resign</button></div><div id="history-container"></div>`;
    const hCont = side.querySelector('#history-container');
    moveHistory.forEach((m, i) => {
        hCont.innerHTML += `<div class="history-row"><div class="move-num">${i+1}.</div><div class="move-val">${m.w}</div><div class="move-val">${m.b}</div></div>`;
    });
    layout.appendChild(side);
    updateTimerDisplay();
}

function initGameState() {
    // RESET BOARD & LOGIC
    boardState = [['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']];
    currentTurn = 'white'; 
    hasMoved = {}; 
    moveHistory = []; 
    isGameOver = false; 
    selected = null; 
    rematchRequested = false;

    // RESET CLOCKS BASED ON ORIGINAL SETTINGS
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
function formatTime(s) { if(isInfinite) return "∞"; const dS=Math.max(0,s); return `${Math.floor(dS/60)}:${(dS%60).toString().padStart(2,'0')}`; }

window.onload = showSetup;
