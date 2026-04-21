// 1. Connection Logic
const socket = io("https://algebra-but-better.onrender.com");
const roomId = "chess-global-room";
socket.emit("join-room", roomId);

// Listen for moves from your friend
socket.on("receive-move", (data) => {
    // Execute the move but don't send it back (isLocal = false)
    handleActualMove(data.from, data.to, false);
});

// 2. Your Original Console Logic Variables
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

// 3. Game Engine Functions (Required for dots and notation)
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
        if (currentTurn === 'white') { 
            whiteTime--; 
            if (whiteTime <= 0) endGame("BLACK WINS ON TIME"); 
        } else { 
            blackTime--; 
            if (blackTime <= 0) endGame("WHITE WINS ON TIME"); 
        }
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

function getNotation(fR, fC, tR, tC, piece, target, isEP, castle) {
    if (castle) return castle === 'short' ? 'O-O' : 'O-O-O';
    const files = ['a','b','c','d','e','f','g','h'];
    const rows = ['8','7','6','5','4','3','2','1'];
    let p = getPieceNotation(piece);
    let cap = (target !== '' || isEP) ? 'x' : '';
    if (p === '' && cap) p = files[fC]; 
    return p + cap + files[tC] + rows[tR];
}

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
    const k = team === 'white' ? '♔' : '♚';
    let kr = -1, kc = -1;
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(b[r][c]===k){kr=r;kc=c;}
    if (kr === -1) return false;
    const atkTeam = team==='white'?'black':'white';
    for(let i=0; i<8; i++) for(let j=0; j<8; j++) if(b[i][j]!=='' && getTeam(b[i][j])===atkTeam && validateMoveMechanics(i,j,kr,kc,b[i][j],b[kr][kc],b)) return true;
    return false;
}

function moveIsLegal(fR, fC, tR, tC, p, team) {
    if (!validateMoveMechanics(fR, fC, tR, tC, p, boardState[tR][tC], boardState)) return false;
    const temp = boardState.map(r => [...r]); temp[tR][tC] = p; temp[fR][fC] = '';
    if ((p==='♙'||p==='♟') && enPassantTarget?.r === tR && enPassantTarget?.c === tC) temp[fR][tC] = '';
    return !isInCheck(team, temp);
}

function canMove(team) {
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(boardState[r][c]!=='' && getTeam(boardState[r][c])===team)
        for(let tr=0; tr<8; tr++) for(let tc=0; tc<8; tc++) if(moveIsLegal(r,c,tr,tc,boardState[r][c],team)) return true;
    return false;
}

// 4. THE ACTION HANDLER (Multiplayer Integrated)
function handleActualMove(from, to, isLocal) {
    const p = boardState[from.r][from.c];
    let isEP = (p==='♙'||p==='♟') && enPassantTarget?.r === to.r && enPassantTarget?.c === to.c;
    let castle = null;

    if((p==='♔'||p==='♚') && Math.abs(from.c - to.c) === 2) {
        castle = to.c === 6 ? 'short' : 'long';
        const rO = to.c === 6 ? 7 : 0, rN = to.c === 6 ? 5 : 3;
        boardState[to.r][rN] = boardState[to.r][rO]; boardState[to.r][rO] = '';
    }

    let note = getNotation(from.r, from.c, to.r, to.c, p, boardState[to.r][to.c], isEP, castle);
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
    selected = null;

    if (isLocal) {
        socket.emit("send-move", { roomId, move: { from, to } });
    }
    render();
}

// 5. UI Rendering (Including Dots!)
function render(forcedStatus) {
    mainLayout.replaceChildren();
    const check = isInCheck(currentTurn, boardState);
    const playable = canMove(currentTurn);
    let sTxt = forcedStatus || `${currentTurn.toUpperCase()}'S TURN ${check?'(CHECK!)':''}`;
    if (!playable && !forcedStatus) { isGameOver = true; killClocks(); sTxt = check ? `CHECKMATE!` : "STALEMATE"; }

    const gArea = document.createElement('div'); gArea.id = 'game-area';
    
    // Players and Board
    const createBar = (name, id) => {
        const div = document.createElement('div'); div.className = 'player-bar';
        div.innerHTML = `<span class="player-name">${name}</span><div id="timer-${id}" class="timer"></div>`;
        return div;
    };
    gArea.appendChild(createBar(blackName, 'black'));

    const bWrap = document.createElement('div'); bWrap.id = 'board-container';
    const bEl = document.createElement('div'); bEl.id = 'board';

    let possibleMoves = [];
    if(selected && !isGameOver) {
        const p = boardState[selected.r][selected.c];
        for(let r=0; r<8; r++) for(let c=0; c<8; c++) {
            if(moveIsLegal(selected.r, selected.c, r, c, p, currentTurn)) possibleMoves.push({r,c});
        }
    }

    for(let r=0; r<8; r++) for(let c=0; c<8; c++) {
        const sq = document.createElement('div'); const char = boardState[r][c];
        sq.className = `square ${(r+c)%2===0?'white-sq':'black-sq'}`;
        if(selected?.r===r && selected?.c===c) sq.classList.add('selected');
        if(check && (char==='♔'||char==='♚') && getTeam(char)===currentTurn) sq.classList.add('in-check');

        // Draw the Dots/Hints
        if(possibleMoves.some(m => m.r===r && m.c===c)) {
            const h = document.createElement('div');
            h.className = char === '' ? 'hint-dot' : 'hint-capture';
            sq.appendChild(h);
        }

        if(char) {
            const sp = document.createElement('span'); 
            sp.className = `piece ${isWhite(char)?'w-piece':'b-piece'}`; 
            sp.textContent = char; 
            sq.appendChild(sp);
        }

        sq.onclick = () => {
            if(isGameOver) return;
            if(selected) {
                if(moveIsLegal(selected.r, selected.c, r, c, boardState[selected.r][selected.c], currentTurn)) {
                    handleActualMove(selected, {r, c}, true);
                } else { 
                    selected = getTeam(char) === currentTurn ? {r,c} : null; 
                    render(); 
                }
            } else if(getTeam(char) === currentTurn) { 
                selected = {r,c}; 
                render(); 
            }
        };
        bEl.appendChild(sq);
    }
    bWrap.appendChild(bEl); gArea.appendChild(bWrap);
    gArea.appendChild(createBar(whiteName, 'white'));
    mainLayout.appendChild(gArea);

    // Side Panel (History)
    const side = document.createElement('div'); side.id = 'side-panel';
    side.innerHTML = `<div id="status-box"><div id="status-text">${sTxt}</div></div><div id="history-container"></div>`;
    const hCont = side.querySelector('#history-container');
    moveHistory.forEach((m, i) => {
        hCont.innerHTML += `<div class="history-row"><div class="move-num">${i+1}.</div><div class="move-val">${m.w}</div><div class="move-val">${m.b}</div></div>`;
    });
    mainLayout.appendChild(side);
    updateTimerDisplay();
}

// 6. Setup Modal (This is what you were missing!)
function showSetup() {
    const overlay = document.createElement('div');
    overlay.id = 'setup-overlay';
    overlay.innerHTML = `
        <div class="setup-card">
            <h2>Game Setup</h2>
            <div class="input-group"><label>White Player</label><input id="wName" value="White"></div>
            <div class="input-group"><label>Black Player</label><input id="bName" value="Black"></div>
            <div class="input-group"><label>Minutes</label><input type="number" id="tMin" value="10"></div>
            <div class="input-group"><label>Increment (sec)</label><input type="number" id="tInc" value="0"></div>
            <button class="start-btn" id="startBtn">START MATCH</button>
        </div>`;
    document.body.appendChild(overlay);
    document.getElementById('startBtn').onclick = () => {
        whiteName = document.getElementById('wName').value;
        blackName = document.getElementById('bName').value;
        let m = parseInt(document.getElementById('tMin').value);
        increment = parseInt(document.getElementById('tInc').value);
        whiteTime = m * 60; blackTime = whiteTime;
        isInfinite = (m === 0);
        overlay.remove();
        initGameState();
    };
}

function initGameState() {
    boardState = [['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],...Array(4).fill(null).map(() => Array(8).fill('')),['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']];
    currentTurn = 'white'; hasMoved = {}; moveHistory = []; isGameOver = false;
    startTimer();
    render();
}

// Start with the setup screen
showSetup();
