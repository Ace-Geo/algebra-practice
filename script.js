// REPLACE with your Render URL (no trailing slash)
const socket = io("https://your-chess-app.onrender.com");

const whiteChars = ['♖', '♘', '♗', '♕', '♔', '♙'];
const isWhite = (char) => whiteChars.includes(char);
const getTeam = (char) => char === '' ? null : (isWhite(char) ? 'white' : 'black');
const getPieceNotation = (p) => {
    const map = {'♖':'R','♘':'N','♗':'B','♕':'Q','♔':'K','♜':'R','♞':'N','♝':'B','♛':'Q','♚':'K'};
    return map[p] || '';
};

let boardState, currentTurn, hasMoved, enPassantTarget, selected, isGameOver, isInfinite;
let whiteName, blackName, whiteTime, blackTime, moveHistory, increment;
const mainLayout = document.getElementById('main-layout');

// --- MULTIPLAYER ROOM LOGIC ---
const roomId = "chess-global-1"; 
socket.emit("join-room", roomId);

// Listen for moves from friend
socket.on("receive-move", (data) => {
    handleActualMove(data.from, data.to, false); 
});

function formatTime(s) {
    if (isInfinite) return "";
    return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
}

function killClocks() {
    if (window.chessIntervalInstance) {
        clearInterval(window.chessIntervalInstance);
        window.chessIntervalInstance = null;
    }
}

function startTimer() {
    killClocks();
    if (isInfinite) return;
    window.chessIntervalInstance = setInterval(() => {
        if (isGameOver) { killClocks(); return; }
        if (currentTurn === 'white') { whiteTime--; if (whiteTime <= 0) endGame("BLACK WINS ON TIME"); } 
        else { blackTime--; if (blackTime <= 0) endGame("WHITE WINS ON TIME"); }
        updateTimerDisplay();
    }, 1000);
}

function updateTimerDisplay() {
    const wT = document.getElementById('timer-white');
    const bT = document.getElementById('timer-black');
    if (wT) {
        wT.textContent = formatTime(whiteTime);
        wT.className = `timer ${currentTurn === 'white' ? 'active' : ''} ${!isInfinite && whiteTime < 30 ? 'low-time' : ''} ${isInfinite ? 'hidden' : ''}`;
    }
    if (bT) {
        bT.textContent = formatTime(blackTime);
        bT.className = `timer ${currentTurn === 'black' ? 'active' : ''} ${!isInfinite && blackTime < 30 ? 'low-time' : ''} ${isInfinite ? 'hidden' : ''}`;
    }
}

function endGame(msg) {
    isGameOver = true;
    killClocks();
    render(msg);
}

function handleActualMove(from, to, isLocal) {
    const p = boardState[from.r][from.c];
    const target = boardState[to.r][to.c];
    let isEP = (p==='♙'||p==='♟') && enPassantTarget?.r === to.r && enPassantTarget?.c === to.c;
    let castle = null;

    if((p==='♔'||p==='♚') && Math.abs(from.c - to.c) === 2) {
        castle = to.c === 6 ? 'short' : 'long';
        const rO = to.c === 6 ? 7 : 0, rN = to.c === 6 ? 5 : 3;
        boardState[to.r][rN] = boardState[to.r][rO]; boardState[to.r][rO] = '';
    }

    let note = getNotation(from.r, from.c, to.r, to.c, p, target, isEP, castle);
    if(isEP) boardState[from.r][to.c] = '';
    hasMoved[`${from.r},${from.c}`] = 1; 
    boardState[to.r][to.c] = p; 
    boardState[from.r][from.c] = '';

    if(p==='♙'&& to.r===0) boardState[to.r][to.c] = '♕'; 
    if(p==='♟'&& to.r===7) boardState[to.r][to.c] = '♛';
    if(isInCheck(currentTurn==='white'?'black':'white', boardState)) note += '+';

    if(currentTurn === 'white') {
        moveHistory.push({w: note, b: ''});
        if(!isInfinite) whiteTime += increment;
    } else {
        moveHistory[moveHistory.length-1].b = note;
        if(!isInfinite) blackTime += increment;
    }

    enPassantTarget = (p==='♙'||p==='♟') && Math.abs(from.r - to.r) === 2 ? {r:(from.r+to.r)/2, c: to.c} : null;
    currentTurn = currentTurn === 'white' ? 'black' : 'white';

    if (isLocal) {
        socket.emit("send-move", { roomId, move: { from, to } });
    }
    
    render();
}

// ... include all your validateMoveMechanics, isInCheck, getNotation, etc. functions here exactly as they were ...

function render(forcedStatus) {
    mainLayout.replaceChildren();
    const check = isInCheck(currentTurn, boardState);
    const playable = canMove(currentTurn);
    let sTxt = forcedStatus || `${currentTurn.toUpperCase()}'S TURN ${check?'(CHECK!)':''}`;
    if (!playable && !forcedStatus) { isGameOver = true; killClocks(); sTxt = check ? `CHECKMATE!` : "STALEMATE"; }

    const gArea = document.createElement('div'); gArea.id = 'game-area';
    const bWrap = document.createElement('div'); bWrap.id = 'board-container';
    const bEl = document.createElement('div'); bEl.id = 'board';

    let moves = []; if(selected && !isGameOver) {
        const p = boardState[selected.r][selected.c];
        for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(moveIsLegal(selected.r, selected.c, r, c, p, currentTurn)) moves.push({r,c});
    }

    for(let r=0; r<8; r++) for(let c=0; c<8; c++) {
        const sq = document.createElement('div'); const char = boardState[r][c];
        sq.className = `square ${(r+c)%2===0?'white-sq':'black-sq'}`;
        if(selected?.r===r && selected?.c===c) sq.classList.add('selected');
        if(char) {
            const sp = document.createElement('span'); sp.className = `piece ${isWhite(char)?'w-piece':'b-piece'}`; sp.textContent = char; sq.appendChild(sp);
        }
        sq.onclick = () => {
            if(isGameOver) return;
            if(selected) {
                 if(moveIsLegal(selected.r, selected.c, r, c, boardState[selected.r][selected.c], currentTurn)) {
                     handleActualMove(selected, {r, c}, true);
                     selected = null;
                 } else { selected = getTeam(char) === currentTurn ? {r,c} : null; render(); }
            } else if(getTeam(char) === currentTurn) { selected = {r,c}; render(); }
        };
        bEl.appendChild(sq);
    }
    // ... complete the rest of your UI building logic ...
}

showSetup();
