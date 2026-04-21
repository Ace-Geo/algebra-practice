const socket = io("https://algebra-but-better.onrender.com");
let myColor = null, currentPassword = null, increment = 0;
let whiteName = "White", blackName = "Black"; 
let boardState, currentTurn, hasMoved, enPassantTarget, selected, isGameOver, isInfinite;
let whiteTime, blackTime, moveHistory;

// --- 1. SOCKET LISTENERS ---
socket.on("waiting-for-opponent", () => {
    document.getElementById('setup-overlay').innerHTML = `<div class="setup-card"><h2>Room Created</h2><p>Waiting for an opponent to join with your password...</p></div>`;
});

socket.on("confirm-settings", (data) => {
    const { settings, creatorName } = data;
    const timeStr = settings.mins === 0 && settings.secs === 0 ? "Unlimited" : `${settings.mins}m ${settings.secs}s (+${settings.inc}s inc)`;
    
    document.getElementById('setup-overlay').innerHTML = `
        <div class="setup-card">
            <h2>Match Found!</h2>
            <p><b>Opponent:</b> ${creatorName}</p>
            <p><b>Time Control:</b> ${timeStr}</p>
            <p><b>Your Color:</b> ${settings.creatorColor === 'white' ? 'Black' : 'White'}</p>
            <button class="start-btn" id="confirmJoin">ACCEPT & START</button>
            <button class="secondary-btn" onclick="location.reload()">DECLINE</button>
        </div>`;
    
    document.getElementById('confirmJoin').onclick = () => {
        socket.emit("join-confirmed", { password: currentPassword, name: document.getElementById('uName').value });
    };
});

socket.on("game-start", (data) => {
    const s = data.settings;
    whiteName = data.whiteName; blackName = data.blackName;
    whiteTime = (s.mins * 60) + s.secs; blackTime = whiteTime;
    increment = s.inc;
    isInfinite = (whiteTime === 0);
    const overlay = document.getElementById('setup-overlay');
    if (overlay) overlay.remove();
    initGameState();
});

socket.on("assign-color", (color) => { myColor = color; render(); });

socket.on("receive-move", (data) => {
    whiteTime = data.whiteTime; blackTime = data.blackTime;
    handleActualMove(data.move.from, data.move.to, false);
});

socket.on("opponent-resigned", (data) => { if(!isGameOver){ isGameOver = true; render(`${data.winner.toUpperCase()} WINS BY RESIGNATION`); }});
socket.on("draw-offered", () => {
    if(isGameOver) return;
    const area = document.getElementById('notification-area');
    if(area) area.innerHTML = `<div class="draw-modal">Opponent offers draw<div class="modal-btns">
        <button onclick="respondToDraw(true)" style="background:#779556;color:#fff">Accept</button>
        <button onclick="respondToDraw(false)" style="background:#312e2b;color:#aaa">Decline</button>
    </div></div>`;
});
socket.on("draw-resolved", (data) => { if(data.accepted && !isGameOver){ isGameOver = true; render("DRAW BY AGREEMENT"); }});

// --- 2. CHESS LOGIC ---
const isWhite = (c) => ['♖','♘','♗','♕','♔','♙'].includes(c);
const getTeam = (c) => c === '' ? null : (isWhite(c) ? 'white' : 'black');
const getPieceNotation = (p) => ({'♖':'R','♘':'N','♗':'B','♕':'Q','♔':'K','♜':'R','♞':'N','♝':'B','♛':'Q','♚':'K'}[p] || '');

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
        if (dc === 0 && tar === '') return dr === dir || (dr === 2*dir && fR === (team==='white'?6:1) && b[fR+dir][fC] === '');
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
    const k = team === 'white' ? '♔' : '♚', atk = team==='white'?'black':'white';
    let kr=-1, kc=-1;
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(b[r][c]===k){kr=r;kc=c;}
    if(kr===-1) return false;
    for(let i=0; i<8; i++) for(let j=0; j<8; j++) if(b[i][j]!=='' && getTeam(b[i][j])===atk && validateMoveMechanics(i,j,kr,kc,b[i][j],b[kr][kc],b)) return true;
    return false;
}

function moveIsLegal(fR, fC, tR, tC, p, team) {
    if (!validateMoveMechanics(fR, fC, tR, tC, p, boardState[tR][tC], boardState)) return false;
    const temp = boardState.map(r => [...r]); temp[tR][tC] = p; temp[fR][fC] = '';
    if ((p==='♙'||p==='♟') && enPassantTarget?.r === tR && enPassantTarget?.c === tC) temp[fR][tC] = '';
    return !isInCheck(team, temp);
}

function isCheckmate(team) {
    if (!isInCheck(team, boardState)) return false;
    for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
        const p = boardState[r][c];
        if (p !== '' && getTeam(p) === team) {
            for (let tr=0; tr<8; tr++) for (let tc=0; tc<8; tc++) if (moveIsLegal(r, c, tr, tc, p, team)) return false;
        }
    }
    return true;
}

// --- 3. ACTIONS ---
function handleActualMove(from, to, isLocal) {
    if (isGameOver) return;
    const p = boardState[from.r][from.c];
    const isEP = (p==='♙'||p==='♟') && enPassantTarget?.r === to.r && enPassantTarget?.c === to.c;
    if(isEP) boardState[from.r][to.c] = '';
    if((p==='♔'||p==='♚') && Math.abs(from.c-to.c)===2) {
        const rO=to.c===6?7:0, rN=to.c===6?5:3; boardState[to.r][rN]=boardState[to.r][rO]; boardState[to.r][rO]='';
    }
    const files=['a','b','c','d','e','f','g','h'], rows=['8','7','6','5','4','3','2','1'];
    let note = (getPieceNotation(p) || (boardState[to.r][to.c]!==''||isEP?files[from.c]:'')) + (boardState[to.r][to.c]!==''||isEP?'x':'') + files[to.c] + rows[to.r];
    
    if (isLocal) { if(currentTurn==='white') whiteTime+=increment; else blackTime+=increment; }
    hasMoved[`${from.r},${from.c}`] = 1; 
    boardState[to.r][to.c] = p; boardState[from.r][from.c] = '';
    if(p==='♙'&& to.r===0) boardState[to.r][to.c]='♕'; if(p==='♟'&& to.r===7) boardState[to.r][to.c]='♛';
    if(currentTurn==='white') moveHistory.push({w:note,b:''}); else moveHistory[moveHistory.length-1].b=note;
    enPassantTarget = (p==='♙'||p==='♟') && Math.abs(from.r-to.r)===2 ? {r:(from.r+to.r)/2, c:to.c} : null;
    currentTurn = currentTurn==='white'?'black':'white';
    selected = null;
    if (isLocal) socket.emit("send-move", { password: currentPassword, move: { from, to }, whiteTime, blackTime });
    render();
}

function resignGame() { if(isGameOver) return; const win=myColor==='white'?'black':'white'; socket.emit("resign", { password: currentPassword, winner: win }); isGameOver=true; render(`${win.toUpperCase()} WINS BY RESIGNATION`); }
function offerDraw() { if(!isGameOver) socket.emit("offer-draw", { password: currentPassword }); }
function respondToDraw(acc) { socket.emit("draw-response", { password: currentPassword, accepted: acc }); document.getElementById('notification-area').innerHTML=''; if(acc){ isGameOver=true; render("DRAW BY AGREEMENT"); }}

// --- 4. RENDERER ---
function render(forcedStatus) {
    const layout = document.getElementById('main-layout');
    if (!layout) return;
    layout.replaceChildren();
    const check = isInCheck(currentTurn, boardState), checkmate = isCheckmate(currentTurn);
    if (checkmate) isGameOver = true;
    let sTxt = forcedStatus || (checkmate ? `CHECKMATE! ${currentTurn==='white'?'BLACK':'WHITE'} WINS` : `${currentTurn.toUpperCase()}'S TURN ${check?'(CHECK!)':''}`);

    const gameArea = document.createElement('div'); gameArea.id = 'game-area';
    const createBar = (name, id) => {
        const div = document.createElement('div'); div.className = 'player-bar';
        div.innerHTML = `<span>${name}</span><div id="timer-${id}" class="timer"></div>`;
        return div;
    };

    if(myColor === 'black') gameArea.appendChild(createBar(whiteName, 'white'));
    else gameArea.appendChild(createBar(blackName, 'black'));

    const boardEl = document.createElement('div'); boardEl.id = 'board';
    const range = (myColor === 'black') ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    for(let r of range) {
        for(let c of range) {
            const sq = document.createElement('div'); const piece = boardState[r][c];
            sq.className = `square ${(r+c)%2===0 ? 'white-sq' : 'black-sq'}`;
            if ((piece==='♔'||piece==='♚') && getTeam(piece)===currentTurn && check) sq.classList.add('check-highlight');
            if (selected?.r===r && selected?.c===c) sq.classList.add('selected');
            if (selected && !isGameOver && moveIsLegal(selected.r, selected.c, r, c, boardState[selected.r][selected.c], currentTurn)) {
                const d = document.createElement('div'); d.className = piece===''?'hint-dot':'hint-capture'; sq.appendChild(d);
            }
            if(piece) {
                const sp = document.createElement('span'); sp.className = `piece ${isWhite(piece)?'w-piece':'b-piece'}`;
                sp.textContent = piece; sq.appendChild(sp);
            }
            sq.onclick = () => {
                if(isGameOver || currentTurn !== myColor) return;
                if(selected) {
                    if(selected.r===r && selected.c===c) selected = null;
                    else if(getTeam(piece)===currentTurn) selected = {r,c};
                    else if(moveIsLegal(selected.r, selected.c, r, c, boardState[selected.r][selected.c], currentTurn)) { handleActualMove(selected,{r,c},true); return; }
                    else selected = null;
                } else if(getTeam(piece) === currentTurn) selected = {r,c};
                render();
            };
            boardEl.appendChild(sq);
        }
    }
    gameArea.appendChild(boardEl);
    if(myColor === 'black') gameArea.appendChild(createBar(blackName, 'black'));
    else gameArea.appendChild(createBar(whiteName, 'white'));
    layout.appendChild(gameArea);

    const side = document.createElement('div'); side.id = 'side-panel';
    const btnState = isGameOver ? "disabled" : "";
    side.innerHTML = `<div id="status-box"><div id="status-text">${sTxt}</div></div><div id="notification-area"></div>
        <div class="btn-row"><button class="action-btn" onclick="offerDraw()" ${btnState}>Offer Draw</button><button class="action-btn" onclick="resignGame()" ${btnState}>Resign</button></div>
        <div id="history-container"></div>`;
    const hCont = side.querySelector('#history-container');
    moveHistory.forEach((m, i) => { hCont.innerHTML += `<div class="history-row"><div>${i+1}.</div><div>${m.w}</div><div>${m.b}</div></div>`; });
    layout.appendChild(side);
    updateTimerDisplay();
}

// --- 5. SYSTEM ---
function initGameState() {
    boardState = [['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']];
    currentTurn = 'white'; hasMoved = {}; moveHistory = []; isGameOver = false; selected = null;
    if (window.chessInterval) clearInterval(window.chessInterval);
    if (!isInfinite) {
        window.chessInterval = setInterval(() => {
            if (isGameOver) return;
            if (currentTurn === 'white') whiteTime--; else blackTime--;
            updateTimerDisplay();
            if (whiteTime <= 0 || blackTime <= 0) { isGameOver = true; render(whiteTime <= 0 ? "BLACK WINS ON TIME" : "WHITE WINS ON TIME"); }
        }, 1000);
    }
    render();
}

function updateTimerDisplay() {
    const wT = document.getElementById('timer-white'), bT = document.getElementById('timer-black');
    if (wT) { wT.textContent = formatTime(whiteTime); wT.classList.toggle('active', currentTurn==='white'); }
    if (bT) { bT.textContent = formatTime(blackTime); bT.classList.toggle('active', currentTurn==='black'); }
}
function formatTime(s) { if(isInfinite) return "∞"; const d=Math.max(0,s); return `${Math.floor(d/60)}:${(d%60).toString().padStart(2,'0')}`; }

function showSetup() {
    const overlay = document.createElement('div'); overlay.id = 'setup-overlay';
    document.body.appendChild(overlay);
    
    let activeTab = 'create';
    const renderOverlay = () => {
        overlay.innerHTML = `
        <div class="setup-card">
            <div class="tab-btns">
                <button class="tab-btn ${activeTab==='create'?'active':''}" onclick="setTab('create')">CREATE</button>
                <button class="tab-btn ${activeTab==='join'?'active':''}" onclick="setTab('join')">JOIN</button>
            </div>
            <div class="input-group"><label>Room Password</label><input id="roomPass"></div>
            <div class="input-group"><label>Your Name</label><input id="uName" value="Player"></div>
            
            ${activeTab === 'create' ? `
                <div class="input-group"><label>Time (Min / Sec / Inc)</label>
                    <div class="time-row">
                        <input type="number" id="tMin" value="10">
                        <input type="number" id="tSec" value="0">
                        <input type="number" id="tInc" value="0">
                    </div>
                </div>
                <div class="input-group"><label>Play As</label>
                    <select id="pColor"><option value="white">White</option><option value="black">Black</option><option value="random">Random</option></select>
                </div>
                <button class="start-btn" id="createBtn">CREATE ROOM</button>
            ` : `
                <button class="start-btn" id="joinBtn">JOIN ROOM</button>
            `}
        </div>`;

        if(activeTab === 'create') {
            document.getElementById('createBtn').onclick = () => {
                currentPassword = document.getElementById('roomPass').value;
                if(!currentPassword) return;
                socket.emit("create-room", {
                    password: currentPassword,
                    name: document.getElementById('uName').value,
                    mins: document.getElementById('tMin').value,
                    secs: document.getElementById('tSec').value,
                    inc: document.getElementById('tInc').value,
                    preferredColor: document.getElementById('pColor').value
                });
            };
        } else {
            document.getElementById('joinBtn').onclick = () => {
                currentPassword = document.getElementById('roomPass').value;
                if(!currentPassword) return;
                socket.emit("join-attempt", { password: currentPassword, name: document.getElementById('uName').value });
            };
        }
    };

    window.setTab = (t) => { activeTab = t; renderOverlay(); };
    renderOverlay();
}
window.onload = showSetup;
