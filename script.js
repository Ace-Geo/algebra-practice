// 1. Connection
const socket = io("https://your-render-url.onrender.com");
const roomId = "chess-global-room";
socket.emit("join-room", roomId);

// 2. Game Variables (From your script)
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

// 3. Multiplayer Listener
socket.on("receive-move", (data) => {
    // When a move comes from the server, we execute it but DON'T send it back
    applyMoveLogic(data.from.r, data.from.c, data.to.r, data.to.c, false);
});

// 4. Move Execution Logic
function applyMoveLogic(fR, fC, tR, tC, isLocal) {
    const p = boardState[fR][fC];
    let isEP = (p==='♙'||p==='♟') && enPassantTarget?.r === tR && enPassantTarget?.c === tC;
    let castle = null;

    if((p==='♔'||p==='♚') && Math.abs(fC - tC) === 2) {
        castle = tC === 6 ? 'short' : 'long';
        const rO = tC === 6 ? 7 : 0, rN = tC === 6 ? 5 : 3;
        boardState[fR][rN] = boardState[fR][rO]; boardState[fR][rO] = '';
    }

    let note = getNotation(fR, fC, tR, tC, p, boardState[tR][tC], isEP, castle);
    if(isEP) boardState[fR][tC] = '';
    hasMoved[`${fR},${fC}`] = 1; 
    boardState[tR][tC] = p; 
    boardState[fR][fC] = '';

    if(p==='♙'&& tR===0) boardState[tR][tC] = '♕'; 
    if(p==='♟'&& tR===7) boardState[tR][tC] = '♛';
    if(isInCheck(currentTurn==='white'?'black':'white', boardState)) note += '+';

    if(currentTurn === 'white') {
        moveHistory.push({w: note, b: ''});
        if(!isInfinite) whiteTime += increment;
    } else {
        moveHistory[moveHistory.length-1].b = note;
        if(!isInfinite) blackTime += increment;
    }

    enPassantTarget = (p==='♙'||p==='♟') && Math.abs(fR - tR) === 2 ? {r:(fR+tR)/2, c: tC} : null;
    currentTurn = currentTurn === 'white' ? 'black' : 'white';
    selected = null;

    // If I made the move, tell the server
    if (isLocal) {
        socket.emit("send-move", { roomId, move: { from: {r:fR, c:fC}, to: {r:tR, c:tC} } });
    }

    render();
}

// 5. Game Engine Functions (Keep these exactly as you had them)
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
    return !isInCheck(team, temp);
}

function canMove(team) {
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(boardState[r][c]!=='' && getTeam(boardState[r][c])===team)
        for(let tr=0; tr<8; tr++) for(let tc=0; tc<8; tc++) if(moveIsLegal(r,c,tr,tc,boardState[r][c],team)) return true;
    return false;
}

// 6. UI Rendering (Modified to use your existing HTML structure)
function render(forcedStatus) {
    mainLayout.innerHTML = ''; // This clears the black box!
    const check = isInCheck(currentTurn, boardState);
    const playable = canMove(currentTurn);
    let sTxt = forcedStatus || `${currentTurn.toUpperCase()}'S TURN ${check?'(CHECK!)':''}`;
    if (!playable && !forcedStatus) { isGameOver = true; sTxt = check ? `MATE!` : "STALEMATE"; }

    const gArea = document.createElement('div'); gArea.id = 'game-area';
    const bWrap = document.createElement('div'); bWrap.id = 'board-container';
    const bEl = document.createElement('div'); bEl.id = 'board';

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
                    applyMoveLogic(selected.r, selected.c, r, c, true);
                } else { selected = getTeam(char) === currentTurn ? {r,c} : null; render(); }
            } else if(getTeam(char) === currentTurn) { selected = {r,c}; render(); }
        };
        bEl.appendChild(sq);
    }
    bWrap.appendChild(bEl); gArea.appendChild(bWrap);
    mainLayout.appendChild(gArea);
    
    // Add Side Panel (History/Status)
    const side = document.createElement('div'); side.id = 'side-panel';
    side.innerHTML = `<div id="status-box"><div id="status-text">${sTxt}</div></div>`;
    mainLayout.appendChild(side);
}

// 7. Setup & Start
function initGameState() {
    boardState = [['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],...Array(4).fill(null).map(() => Array(8).fill('')),['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']];
    currentTurn = 'white'; hasMoved = {}; moveHistory = []; isGameOver = false;
    render();
}

initGameState();
