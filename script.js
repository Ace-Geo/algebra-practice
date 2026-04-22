const socket = io("https://algebra-but-better.onrender.com");
let myColor = null, currentPassword = null, tempName = ""; 
let whiteName = "White", blackName = "Black"; 
let boardState, currentTurn, hasMoved, enPassantTarget, selected, isGameOver, isInfinite;
let whiteTime, blackTime, increment, moveHistory = [];
let rematchRequested = false;

// --- 1. SOCKET LISTENERS ---
socket.on("player-assignment", (data) => {
    myColor = data.color;
    const s = data.settings;
    whiteTime = (parseInt(s.mins) * 60) + parseInt(s.secs);
    blackTime = whiteTime;
    increment = parseInt(s.inc) || 0;
    isInfinite = (whiteTime === 0);
    
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

socket.on("receive-move", (data) => {
    whiteTime = data.whiteTime;
    blackTime = data.blackTime;
    handleActualMove(data.move.from, data.move.to, false);
});

socket.on("opponent-resigned", (data) => {
    isGameOver = true;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    showResultModal(`${data.winner.toUpperCase()} WINS BY RESIGNATION`);
    render(`${data.winner.toUpperCase()} WINS BY RESIGNATION`);
});

socket.on("draw-resolved", (data) => {
    if (data.accepted) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        showResultModal("GAME DRAWN BY AGREEMENT");
        render("GAME DRAWN BY AGREEMENT");
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
    document.getElementById('game-over-overlay')?.remove();
    document.getElementById('reopen-results-btn')?.remove();
    initGameState();
});

// --- 2. LOGIC ---
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
    if (['♔','♚'].includes(p)) {
        if (adc === 2) {
            if (hasMoved[`${fR},${fC}`] || isTeamInCheck(team, b)) return false;
            const rC = tC === 6 ? 7 : 0;
            return b[fR][rC] !== '' && !hasMoved[`${fR},${rC}`] && clearPath(fR, fC, fR, rC);
        }
        return adr<=1 && adc<=1;
    }
    return false;
}

function isTeamInCheck(team, b) {
    const kPos = (function(){
        const k = team === 'white' ? '♔' : '♚';
        for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(b[r][c] === k) return {r,c};
    })();
    if (!kPos) return false;
    for(let r=0; r<8; r++) {
        for(let c=0; c<8; c++) {
            const p = b[r][c];
            if (p !== '' && getTeam(p) !== team) {
                // Simplified canMoveTo for check detection to avoid infinite loops
                const dr = kPos.r-r, dc = kPos.c-c, adr = Math.abs(dr), adc = Math.abs(dc);
                if (['♘','♞'].includes(p)) { if((adr===2 && adc===1)||(adr===1 && adc===2)) return true; }
                else if (canMoveTo(r, c, kPos.r, kPos.c, p, b)) return true;
            }
        }
    }
    return false;
}

function isMoveLegal(fR, fC, tR, tC, team) {
    const p = boardState[fR][fC];
    if (!canMoveTo(fR, fC, tR, tC, p, boardState)) return false;
    const nextBoard = boardState.map(row => [...row]);
    nextBoard[tR][tC] = p; nextBoard[fR][fC] = '';
    return !isTeamInCheck(team, nextBoard);
}

function getLegalMoves(team) {
    let moves = [];
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) {
        if(getTeam(boardState[r][c]) === team) {
            for(let tr=0; tr<8; tr++) for(let tc=0; tc<8; tc++) {
                if(isMoveLegal(r, c, tr, tc, team)) moves.push({from:{r,c}, to:{r:tr, c:tc}});
            }
        }
    }
    return moves;
}

// --- 3. ACTIONS ---
function handleActualMove(from, to, isLocal) {
    if (isGameOver) return;
    const movingPiece = boardState[from.r][from.c];
    const team = currentTurn;

    if (isLocal && !isInfinite) {
        if (team === 'white') whiteTime += increment; else blackTime += increment;
    }

    if ((movingPiece === '♔' || movingPiece === '♚') && Math.abs(from.c - to.c) === 2) {
        const rO = to.c === 6 ? 7 : 0, rN = to.c === 6 ? 5 : 3;
        boardState[to.r][rN] = boardState[to.r][rO]; boardState[to.r][rO] = '';
    }

    boardState[to.r][to.c] = movingPiece;
    boardState[from.r][from.c] = '';
    hasMoved[`${from.r},${from.c}`] = 1;
    currentTurn = (team === 'white' ? 'black' : 'white');

    const nextMoves = getLegalMoves(currentTurn);
    const inCheck = isTeamInCheck(currentTurn, boardState);

    if (nextMoves.length === 0) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        const result = inCheck ? `${team.toUpperCase()} WINS BY CHECKMATE` : "DRAW BY STALEMATE";
        showResultModal(result);
    }

    if (isLocal) socket.emit("send-move", { password: currentPassword, move: { from, to }, whiteTime, blackTime });
    selected = null; render();
}

function requestRematch() {
    if (rematchRequested) return;
    rematchRequested = true;
    document.getElementById('rematch-btn').innerText = "Waiting...";
    document.getElementById('rematch-btn').disabled = true;
    socket.emit("rematch-request", { password: currentPassword });
}

function showResultModal(txt) {
    document.getElementById('game-over-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'game-over-overlay';
    overlay.innerHTML = `
        <div class="result-card">
            <h2>Game Over</h2><p>${txt}</p>
            <div class="modal-btns">
                <button id="rematch-btn" onclick="requestRematch()">Request Rematch</button>
                <button class="action-btn" onclick="closeModal()">View Position</button>
                <button class="action-btn" onclick="location.reload()">Exit to Lobby</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
}

function closeModal() {
    document.getElementById('game-over-overlay').style.display = 'none';
    if (!document.getElementById('reopen-results-btn')) {
        const btn = document.createElement('button');
        btn.id = 'reopen-results-btn'; btn.className = 'action-btn'; btn.style.marginTop = '10px';
        btn.textContent = 'View Result';
        btn.onclick = () => document.getElementById('game-over-overlay').style.display = 'flex';
        document.getElementById('side-panel').appendChild(btn);
    }
}

// --- RENDER & INIT (Simplified for space but complete) ---
function render(forcedStatus) {
    const layout = document.getElementById('main-layout');
    if (!layout) return;
    layout.replaceChildren();

    const check = isTeamInCheck(currentTurn, boardState);
    const gameArea = document.createElement('div'); gameArea.id = 'game-area';
    
    const createBar = (name, id) => {
        const div = document.createElement('div'); div.className = 'player-bar';
        div.innerHTML = `<span class="player-name">${name}</span><div id="timer-${id}" class="timer"></div>`;
        return div;
    };

    if(myColor === 'black') gameArea.appendChild(createBar(whiteName, 'white'));
    else gameArea.appendChild(createBar(blackName, 'black'));

    const boardEl = document.createElement('div'); boardEl.id = 'board-container';
    const board = document.createElement('div'); board.id = 'board';
    
    let hints = (selected && !isGameOver) ? getLegalMoves(currentTurn).filter(m => m.from.r === selected.r && m.from.c === selected.c).map(m => m.to) : [];

    const range = (myColor === 'black') ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    for(let r of range) {
        for(let c of range) {
            const sq = document.createElement('div');
            const p = boardState[r][c];
            sq.className = `square ${(r+c)%2===0 ? 'white-sq' : 'black-sq'}`;
            if (check && p === (currentTurn === 'white' ? '♔' : '♚')) sq.classList.add('king-check');
            if (selected?.r === r && selected?.c === c) sq.classList.add('selected');
            
            if(hints.some(h => h.r === r && h.c === c)) {
                const dot = document.createElement('div'); dot.className = p === '' ? 'hint-dot' : 'hint-capture';
                sq.appendChild(dot);
            }

            if(p) {
                const sp = document.createElement('span'); sp.className = `piece ${isWhite(p)?'w-piece':'b-piece'}`;
                sp.textContent = p; sq.appendChild(sp);
            }

            sq.onclick = () => {
                if(isGameOver || currentTurn !== myColor) return;
                if(selected) {
                    if(selected.r === r && selected.c === c) { selected = null; render(); }
                    else if(hints.some(h => h.r === r && h.c === c)) handleActualMove(selected, {r,c}, true);
                    else { selected = getTeam(p) === currentTurn ? {r,c} : null; render(); }
                } else if(getTeam(p) === currentTurn) { selected = {r,c}; render(); }
            };
            board.appendChild(sq);
        }
    }
    boardEl.appendChild(board); gameArea.appendChild(boardEl);
    if(myColor === 'black') gameArea.appendChild(createBar(blackName, 'black'));
    else gameArea.appendChild(createBar(whiteName, 'white'));
    layout.appendChild(gameArea);

    const side = document.createElement('div'); side.id = 'side-panel';
    side.innerHTML = `<div id="status-box"><div id="status-text">${forcedStatus || (currentTurn.toUpperCase() + (check?' CHECK':' TURN'))}</div></div><div id="history-container"></div><div class="btn-row"><button class="action-btn" onclick="socket.emit('offer-draw', {password:currentPassword})">Draw</button><button class="action-btn" onclick="socket.emit('resign', {password:currentPassword, winner:myColor==='white'?'black':'white'})">Resign</button></div>`;
    layout.appendChild(side);
    updateTimerDisplay();
}

function initGameState() {
    boardState = [['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']];
    currentTurn = 'white'; hasMoved = {}; isGameOver = false; selected = null;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isInfinite) {
        window.chessIntervalInstance = setInterval(() => {
            if (isGameOver) return;
            if (currentTurn === 'white') whiteTime--; else blackTime--;
            updateTimerDisplay();
            if (whiteTime <= 0 || blackTime <= 0) { isGameOver = true; showResultModal("TIME OUT"); }
        }, 1000);
    }
    render();
}

function updateTimerDisplay() {
    const wT = document.getElementById('timer-white'), bT = document.getElementById('timer-black');
    if (wT) wT.textContent = isInfinite ? "∞" : Math.floor(whiteTime/60) + ":" + (whiteTime%60).toString().padStart(2,'0');
    if (bT) bT.textContent = isInfinite ? "∞" : Math.floor(blackTime/60) + ":" + (blackTime%60).toString().padStart(2,'0');
}

// --- TAB/LOBBY UI ---
function showSetup() { /* ... Same UI code from previous versions ... */ }
window.onload = () => {
    // Basic setup HTML injected here
    const overlay = document.createElement('div'); overlay.id = 'setup-overlay';
    overlay.innerHTML = `<div class="setup-card"><h2>Algebra Chess</h2><div class="input-group"><label>Password</label><input id="roomPass"></div><div class="input-group"><label>Name</label><input id="uName" value="Player"></div><button class="start-btn" onclick="createRoom()">CREATE</button><button class="start-btn" style="background:#3c3a39" onclick="joinRoom()">JOIN</button></div>`;
    document.body.appendChild(overlay);
};

function createRoom() {
    currentPassword = document.getElementById('roomPass').value;
    tempName = document.getElementById('uName').value;
    socket.emit("create-room", { password: currentPassword, name: tempName, mins: 10, secs: 0, inc: 5 });
}
function joinRoom() {
    currentPassword = document.getElementById('roomPass').value;
    tempName = document.getElementById('uName').value;
    socket.emit("confirm-join", { password: currentPassword, name: tempName });
}
