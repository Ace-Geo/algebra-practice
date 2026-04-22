const socket = io("https://algebra-but-better.onrender.com");
let myColor = null, currentPassword = null;
let whiteName = "White", blackName = "Black"; 
let boardState, currentTurn, hasMoved, enPassantTarget, selected, isGameOver, isInfinite;
let whiteTime, blackTime, moveHistory;

// --- 1. SOCKET LISTENERS ---
socket.on("player-assignment", (data) => {
    myColor = data.color;
    const m = parseInt(data.settings.mins) || 10;
    whiteTime = m * 60; blackTime = whiteTime;
    isInfinite = (m === 0);
    whiteName = data.settings.whiteName || "White";
    if (myColor === "black") {
        const localInput = document.getElementById('uName');
        blackName = localInput ? localInput.value : "Black";
    } else { blackName = "Waiting..."; }
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

socket.on("opponent-resigned", (data) => {
    isGameOver = true;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    render(`${data.winner.toUpperCase()} WINS BY RESIGNATION`);
});

socket.on("draw-offered", () => {
    showDrawOffer();
});

socket.on("draw-resolved", (data) => {
    if (data.accepted) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        render("GAME DRAWN BY AGREEMENT");
    } else {
        showStatusMessage("Draw offer declined");
    }
});

// --- 2. LOGIC HELPERS ---
const isWhite = (char) => ['♖', '♘', '♗', '♕', '♔', '♙'].includes(char);
const getTeam = (char) => char === '' ? null : (isWhite(char) ? 'white' : 'black');
const getPieceNotation = (p) => {
    const map = {'♖':'R','♘':'N','♗':'B','♕':'Q','♔':'K','♜':'R','♞':'N','♝':'B','♛':'Q','♚':'K'};
    return map[p] || '';
};

function validateMoveMechanics(fR, fC, tR, tC, p, tar, b) {
    const dr = tR-fR, dc = tC-fC, adr = Math.abs(dr), adc = Math.abs(dc), team = getTeam(p);
    if (tar !== '' && getTeam(tar) === team) return false;
    const clear = (r1, c1, r2, c2) => {
        const sr = r2 === r1 ? 0 : (r2-r1)/Math.abs(r2-r1), sc = c2 === c1 ? 0 : (c2-c1)/Math.abs(c2-c1);
        let cr = r1+sr, cc = c1+sc;
        while(cr !== r2 || cc !== c2) { if (b[cr][cc] !== '') return false; cr+=sr; cc+=sc; }
        return true;
    };
    if (p === '♙' || p === '♟') {
        const dir = team === 'white' ? -1 : 1;
        if (dc === 0 && tar === '') return dr === dir || (dr === 2*dir && fR === (team === 'white'?6:1) && b[fR+dir][fC] === '');
        if (adc === 1 && dr === dir) return tar !== '' || (enPassantTarget && enPassantTarget.r === tR && enPassantTarget.c === tC);
        return false;
    }
    if (['♖','♜'].includes(p)) return (dr===0 || dc===0) && clear(fR,fC,tR,tC);
    if (['♘','♞'].includes(p)) return (adr===2 && adc===1) || (adr===1 && adc===2);
    if (['♗','♝'].includes(p)) return adr===adc && clear(fR,fC,tR,tC);
    if (['♕','♛'].includes(p)) return (adr===adc || dr===0 || dc===0) && clear(fR,fC,tR,tC);
    if (['♔','♚'].includes(p)) {
        if (adr<=1 && adc<=1) return true;
        if (adc===2 && dr===0 && !hasMoved[`${fR},${fC}`]) {
            const rC = tC===6?7:0; return b[fR][rC]!=='' && !hasMoved[`${fR},${rC}`] && clear(fR,fC,fR,rC);
        }
    }
    return false;
}

function isInCheck(team, b) {
    const k = team === 'white' ? '♔' : '♚', atkTeam = team==='white'?'black':'white';
    let kr = -1, kc = -1;
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(b[r][c]===k){kr=r;kc=c;}
    if(kr === -1) return false;
    for(let i=0; i<8; i++) for(let j=0; j<8; j++) if(b[i][j]!=='' && getTeam(b[i][j])===atkTeam && validateMoveMechanics(i,j,kr,kc,b[i][j],b[kr][kc],b)) return true;
    return false;
}

function moveIsLegal(fR, fC, tR, tC, p, team) {
    if (!validateMoveMechanics(fR, fC, tR, tC, p, boardState[tR][tC], boardState)) return false;
    const temp = boardState.map(r => [...r]); temp[tR][tC] = p; temp[fR][fC] = '';
    if ((p==='♙'||p==='♟') && enPassantTarget?.r === tR && enPassantTarget?.c === tC) temp[fR][tC] = '';
    return !isInCheck(team, temp);
}

function hasLegalMoves(team) {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = boardState[r][c];
            if (p !== '' && getTeam(p) === team) {
                for (let tr = 0; tr < 8; tr++) {
                    for (let tc = 0; tc < 8; tc++) {
                        if (moveIsLegal(r, c, tr, tc, p, team)) return true;
                    }
                }
            }
        }
    }
    return false;
}

function getNotation(fR, fC, tR, tC, piece, target, isEP, castle) {
    if (castle) return castle === 'short' ? 'O-O' : 'O-O-O';
    const files = ['a','b','c','d','e','f','g','h'], rows = ['8','7','6','5','4','3','2','1'];
    let p = getPieceNotation(piece), cap = (target !== '' || isEP) ? 'x' : '';
    if (p === '' && cap) p = files[fC]; 
    return p + cap + files[tC] + rows[tR];
}

// --- 3. GAME ACTIONS ---
function handleActualMove(from, to, isLocal) {
    const movingPiece = boardState[from.r][from.c];
    const targetPiece = boardState[to.r][to.c];
    const isEP = (movingPiece==='♙'||movingPiece==='♟') && enPassantTarget?.r === to.r && enPassantTarget?.c === to.c;
    const movingTeam = currentTurn;
    const opponentTeam = movingTeam === 'white' ? 'black' : 'white';
    
    let castle = null;
    if((movingPiece==='♔'||movingPiece==='♚') && Math.abs(from.c - to.c) === 2) {
        castle = to.c === 6 ? 'short' : 'long';
        const rO = to.c === 6 ? 7 : 0, rN = to.c === 6 ? 5 : 3;
        boardState[to.r][rN] = boardState[to.r][rO]; boardState[to.r][rO] = '';
    }

    let note = getNotation(from.r, from.c, to.r, to.c, movingPiece, targetPiece, isEP, castle);
    
    // 1. Execute the move on the board
    if(isEP) boardState[from.r][to.c] = '';
    hasMoved[`${from.r},${from.c}`] = 1; 
    boardState[to.r][to.c] = movingPiece; boardState[from.r][from.c] = '';
    
    // 2. Promotion check
    if(movingPiece==='♙' && to.r===0) boardState[to.r][to.c] = '♕'; 
    if(movingPiece==='♟' && to.r===7) boardState[to.r][to.c] = '♛';

    // 3. Update En Passant availability
    enPassantTarget = (movingPiece==='♙'||movingPiece==='♟') && Math.abs(from.r - to.r) === 2 ? {r:(from.r+to.r)/2, c: to.c} : null;

    // 4. PRE-ASSESSMENT: Switch turn to opponent to calculate their legal options
    currentTurn = opponentTeam; 
    
    const opponentInCheck = isInCheck(opponentTeam, boardState);
    const opponentHasMoves = hasLegalMoves(opponentTeam);
    let forcedStatus = null;

    if (!opponentHasMoves) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        
        if (opponentInCheck) {
            note += '#'; // Checkmate symbol
            forcedStatus = `CHECKMATE! ${movingTeam.toUpperCase()} WINS`;
        } else {
            forcedStatus = "DRAW BY STALEMATE";
        }
    } else if (opponentInCheck) {
        note += '+'; // Check symbol
    }

    // 5. Update Move History UI
    if(movingTeam === 'white') moveHistory.push({w: note, b: ''}); 
    else moveHistory[moveHistory.length-1].b = note;

    selected = null;
    
    // 6. Sync with Server
    if (isLocal) socket.emit("send-move", { password: currentPassword, move: { from, to }, whiteTime, blackTime });
    
    render(forcedStatus);
}

function resignGame() {
    if (isGameOver) return;
    const winner = myColor === 'white' ? 'black' : 'white';
    socket.emit("resign", { password: currentPassword, winner: winner });
    isGameOver = true;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    render(`${winner.toUpperCase()} WINS BY RESIGNATION`);
}

function offerDraw() {
    if (isGameOver) return;
    socket.emit("offer-draw", { password: currentPassword });
    showStatusMessage("Draw offer sent...");
}

function showDrawOffer() {
    const area = document.getElementById('notification-area');
    if (!area) return;
    area.innerHTML = `
        <div class="draw-modal">
            Opponent offers a draw
            <div class="modal-btns">
                <button class="accept-btn" onclick="respondToDraw(true)">Accept</button>
                <button class="decline-btn" onclick="respondToDraw(false)">Decline</button>
            </div>
        </div>
    `;
}

function respondToDraw(accepted) {
    socket.emit("draw-response", { password: currentPassword, accepted: accepted });
    document.getElementById('notification-area').innerHTML = '';
    if (accepted) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        render("GAME DRAWN BY AGREEMENT");
    }
}

function showStatusMessage(msg) {
    const area = document.getElementById('notification-area');
    if (!area) return;
    area.innerHTML = `<div class="status-msg">${msg}</div>`;
    setTimeout(() => { area.innerHTML = ''; }, 3000);
}

// --- 4. RENDERER ---
function render(forcedStatus) {
    const layout = document.getElementById('main-layout');
    if (!layout) return;
    layout.replaceChildren();

    const check = isInCheck(currentTurn, boardState);
    
    // Status Logic
    let sTxt = "";
    if (isGameOver && forcedStatus) {
        sTxt = forcedStatus;
    } else if (isGameOver) {
        sTxt = "GAME OVER";
    } else {
        sTxt = `${currentTurn.toUpperCase()}'S TURN ${check ? '(CHECK!)' : ''}`;
    }

    const gameArea = document.createElement('div');
    gameArea.id = 'game-area';

    const createBar = (name, id) => {
        const div = document.createElement('div'); div.className = 'player-bar';
        div.innerHTML = `<span class="player-name">${name} ${myColor === id ? '(YOU)' : ''}</span><div id="timer-${id}" class="timer"></div>`;
        return div;
    };

    if(myColor === 'black') gameArea.appendChild(createBar(whiteName, 'white'));
    else gameArea.appendChild(createBar(blackName, 'black'));

    const boardWrap = document.createElement('div'); boardWrap.id = 'board-container';
    const boardEl = document.createElement('div'); boardEl.id = 'board';
    
    let hints = [];
    if(selected && !isGameOver) {
        const p = boardState[selected.r][selected.c];
        for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(moveIsLegal(selected.r, selected.c, r, c, p, currentTurn)) hints.push({r,c});
    }

    const range = (myColor === 'black') ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    for(let r of range) {
        for(let c of range) {
            const sq = document.createElement('div');
            const piece = boardState[r][c];
            sq.className = `square ${(r+c)%2===0 ? 'white-sq' : 'black-sq'}`;
            
            // King Check Highlight
            if (check && (piece === (currentTurn === 'white' ? '♔' : '♚'))) {
                sq.classList.add('king-check');
            }

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
                    if(moveIsLegal(selected.r, selected.c, r, c, boardState[selected.r][selected.c], currentTurn)) handleActualMove(selected, {r,c}, true);
                    else { selected = getTeam(piece) === currentTurn ? {r,c} : null; render(); }
                } else if(getTeam(piece) === currentTurn) { selected = {r,c}; render(); }
            };
            boardEl.appendChild(sq);
        }
    }
    boardWrap.appendChild(boardEl); gameArea.appendChild(boardWrap);

    if(myColor === 'black') gameArea.appendChild(createBar(blackName, 'black'));
    else gameArea.appendChild(createBar(whiteName, 'white'));

    layout.appendChild(gameArea);

    const side = document.createElement('div'); side.id = 'side-panel';
    side.innerHTML = `
        <div id="status-box"><div id="status-text">${sTxt}</div></div>
        <div id="notification-area"></div>
        <div class="btn-row">
            <button class="action-btn" onclick="offerDraw()">Offer Draw</button>
            <button class="action-btn" onclick="resignGame()">Resign</button>
        </div>
        <div id="history-container"></div>
    `;
    const hCont = side.querySelector('#history-container');
    moveHistory.forEach((m, i) => {
        hCont.innerHTML += `<div class="history-row"><div class="move-num">${i+1}.</div><div class="move-val">${m.w}</div><div class="move-val">${m.b}</div></div>`;
    });
    layout.appendChild(side);
    updateTimerDisplay();
}

// --- 5. INIT & TIMERS ---
function initGameState() {
    boardState = [['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']];
    currentTurn = 'white'; hasMoved = {}; moveHistory = []; isGameOver = false; selected = null;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isInfinite) {
        window.chessIntervalInstance = setInterval(() => {
            if (isGameOver) return;
            if (currentTurn === 'white') whiteTime--; else blackTime--;
            updateTimerDisplay();
            if (whiteTime <= 0 || blackTime <= 0) { 
                isGameOver = true; 
                clearInterval(window.chessIntervalInstance);
                render(whiteTime <= 0 ? "BLACK WINS ON TIME" : "WHITE WINS ON TIME"); 
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

function showSetup() {
    const overlay = document.createElement('div'); overlay.id = 'setup-overlay';
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
        if(!currentPassword) return;
        socket.emit("join-room", { password: currentPassword, name: document.getElementById('uName').value, mins: document.getElementById('tMin').value });
        overlay.remove();
    };
}
window.onload = showSetup;
