// --- AUTO-INJECTOR ---
function ensureDOM() {
    if (!document.getElementById('setup-overlay')) {
        const ov = document.createElement('div'); ov.id = 'setup-overlay';
        document.body.appendChild(ov);
    }
    if (!document.getElementById('main-layout')) {
        const ml = document.createElement('div'); ml.id = 'main-layout';
        document.body.appendChild(ml);
    }
}

const socket = io("https://algebra-but-better.onrender.com");
let myColor, currentPassword, increment;
let whiteName, blackName, whiteTime, blackTime;
let boardState, currentTurn, selected, isGameOver, isInfinite;
let hasMoved = {}, enPassantTarget = null, moveHistory = [];

// --- CHESS LOGIC ---
const isWhite = (c) => ['♖','♙','♘','♗','♕','♔'].includes(c);
const getTeam = (c) => c === '' ? null : (isWhite(c) ? 'white' : 'black');
const getNotation = (p) => ({'♖':'R','♘':'N','♗':'B','♕':'Q','♔':'K','♜':'R','♞':'N','♝':'B','♛':'Q','♚':'K'}[p] || '');

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
        if (adr <= 1 && adc <= 1) return true;
        if (adc === 2 && dr === 0 && !hasMoved[`${fR},${fC}`]) {
            const rCol = tC === 6 ? 7 : 0;
            return b[fR][rCol] !== '' && !hasMoved[`${fR},${rCol}`] && clear(fR, fC, fR, rCol);
        }
    }
    return false;
}

function moveIsLegal(fR, fC, tR, tC, p, team) {
    if (!validateMoveMechanics(fR, fC, tR, tC, p, boardState[tR][tC], boardState)) return false;
    const temp = boardState.map(r => [...r]);
    temp[tR][tC] = p; temp[fR][fC] = '';
    const k = team === 'white' ? '♔' : '♚';
    let kr, kc;
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(temp[r][c]===k){kr=r;kc=c;}
    const atk = team==='white'?'black':'white';
    for(let i=0; i<8; i++) for(let j=0; j<8; j++) 
        if(temp[i][j]!=='' && getTeam(temp[i][j])===atk && validateMoveMechanics(i,j,kr,kc,temp[i][j],temp[kr][kc],temp)) return false;
    return true;
}

function handleActualMove(from, to, isLocal) {
    const p = boardState[from.r][from.c];
    const files = ['a','b','c','d','e','f','g','h'], rows = ['8','7','6','5','4','3','2','1'];
    
    if ((p==='♙'||p==='♟') && enPassantTarget?.r === to.r && enPassantTarget?.c === to.c) boardState[from.r][to.c] = '';
    if ((p==='♔'||p==='♚') && Math.abs(from.c - to.c) === 2) {
        const rOld = to.c === 6 ? 7 : 0, rNew = to.c === 6 ? 5 : 3;
        boardState[to.r][rNew] = boardState[to.r][rOld]; boardState[to.r][rOld] = '';
    }

    let moveNote = (getNotation(p) || (boardState[to.r][to.c]!==''?files[from.c]:'')) + (boardState[to.r][to.c]!==''?'x':'') + files[to.c] + rows[to.r];
    if (currentTurn === 'white') moveHistory.push({ w: moveNote, b: '' });
    else moveHistory[moveHistory.length-1].b = moveNote;

    boardState[to.r][to.c] = p; boardState[from.r][from.c] = '';
    hasMoved[`${from.r},${from.c}`] = true;
    enPassantTarget = (p==='♙'||p==='♟' && Math.abs(from.r-to.r)===2) ? {r:(from.r+to.r)/2, c:to.c} : null;

    if (isLocal) {
        if(currentTurn==='white') whiteTime+=increment; else blackTime+=increment;
        socket.emit("send-move", { password: currentPassword, move: {from, to}, whiteTime, blackTime });
    }
    currentTurn = currentTurn === 'white' ? 'black' : 'white';
    selected = null; render();
}

function offerDraw() { socket.emit("offer-draw", { password: currentPassword }); }
function resign() { socket.emit("resign", { password: currentPassword, winner: myColor==='white'?'black':'white' }); }

// --- SOCKETS ---
socket.on("game-start", (data) => {
    whiteName = data.whiteName; blackName = data.blackName;
    whiteTime = (data.settings.mins * 60) + data.settings.secs;
    blackTime = whiteTime; increment = data.settings.inc; isInfinite = (whiteTime === 0);
    document.getElementById('setup-overlay').style.display = 'none';
    document.getElementById('main-layout').style.visibility = 'visible';
    initGameState();
});
socket.on("assign-color", (c) => { myColor = c; render(); });
socket.on("receive-move", (d) => { whiteTime = d.whiteTime; blackTime = d.blackTime; handleActualMove(d.move.from, d.move.to, false); });
socket.on("opponent-resigned", (d) => { isGameOver = true; render(`${d.winner.toUpperCase()} WINS (RESIGNATION)`); });
socket.on("draw-offered", () => { if(confirm("Opponent offers a draw. Accept?")) socket.emit("draw-response", {password: currentPassword, accepted: true}); else socket.emit("draw-response", {password: currentPassword, accepted: false}); });
socket.on("draw-result", (acc) => { if(acc) { isGameOver = true; render("DRAW BY AGREEMENT"); } });

// --- UI RENDER ---
function render(statusOverride) {
    const layout = document.getElementById('main-layout');
    if (!layout) return; layout.replaceChildren();

    const gameArea = document.createElement('div');
    const createBar = (name, id) => {
        const div = document.createElement('div'); div.className = 'player-bar';
        div.innerHTML = `<span>${name}</span><div id="timer-${id}" class="timer"></div>`;
        return div;
    };

    gameArea.appendChild(createBar(myColor==='white'?blackName:whiteName, myColor==='white'?'black':'white'));
    const boardEl = document.createElement('div'); boardEl.id = 'board';
    const range = myColor === 'black' ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    
    for(let r of range) {
        for(let c of range) {
            const sq = document.createElement('div');
            const piece = boardState[r][c];
            sq.className = `square ${(r+c)%2===0 ? 'white-sq' : 'black-sq'}`;
            if (selected?.r===r && selected?.c===c) sq.classList.add('selected');
            
            // HINTS
            if (selected && moveIsLegal(selected.r, selected.c, r, c, boardState[selected.r][selected.c], currentTurn)) {
                const hint = document.createElement('div'); 
                hint.className = piece === '' ? 'hint-dot' : 'hint-capture';
                sq.appendChild(hint);
            }
            if(piece) {
                const sp = document.createElement('span'); sp.className = `piece ${isWhite(piece)?'w-piece':'b-piece'}`;
                sp.textContent = piece; sq.appendChild(sp);
            }
            sq.onclick = () => {
                if (currentTurn !== myColor || isGameOver) return;
                if (selected && moveIsLegal(selected.r, selected.c, r, c, boardState[selected.r][selected.c], currentTurn)) handleActualMove(selected, {r,c}, true);
                else { selected = getTeam(piece) === currentTurn ? {r,c} : null; render(); }
            };
            boardEl.appendChild(sq);
        }
    }
    gameArea.appendChild(boardEl);
    gameArea.appendChild(createBar(myColor==='white'?whiteName:blackName, myColor==='white'?'white':'black'));
    layout.appendChild(gameArea);

    const side = document.createElement('div'); side.id = 'side-panel';
    side.innerHTML = `<div id="status-box">${statusOverride || currentTurn.toUpperCase() + "'S TURN"}</div>
        <div id="history-container"></div>
        <div class="btn-group">
            <button class="action-btn" onclick="offerDraw()">DRAW</button>
            <button class="action-btn" onclick="resign()">RESIGN</button>
        </div>`;
    const hist = side.querySelector('#history-container');
    moveHistory.forEach((m, i) => { hist.innerHTML += `<div class="history-row"><span>${i+1}.</span><span>${m.w}</span><span>${m.b}</span></div>`; });
    layout.appendChild(side);
    updateTimerDisplay();
}

function initGameState() {
    boardState = [['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']];
    currentTurn = 'white'; isGameOver = false; moveHistory = []; render();
    setInterval(() => {
        if (isGameOver || isInfinite) return;
        if (currentTurn === 'white') whiteTime--; else blackTime--;
        if (whiteTime <= 0 || blackTime <= 0) { isGameOver = true; render("TIME EXPIRED"); }
        updateTimerDisplay();
    }, 1000);
}

function updateTimerDisplay() {
    const wT = document.getElementById('timer-white'), bT = document.getElementById('timer-black');
    if (wT) { wT.textContent = isInfinite ? "∞" : `${Math.floor(whiteTime/60)}:${(whiteTime%60).toString().padStart(2,'0')}`; wT.classList.toggle('active', currentTurn==='white'); }
    if (bT) { bT.textContent = isInfinite ? "∞" : `${Math.floor(blackTime/60)}:${(blackTime%60).toString().padStart(2,'0')}`; bT.classList.toggle('active', currentTurn==='black'); }
}

function showSetup() {
    ensureDOM();
    const overlay = document.getElementById('setup-overlay');
    let tab = 'create';
    const draw = () => {
        overlay.innerHTML = `
        <div class="setup-card">
            <div class="tab-btns"><button class="tab-btn ${tab==='create'?'active':''}" id="tC">CREATE</button><button class="tab-btn ${tab==='join'?'active':''}" id="tJ">JOIN</button></div>
            <div class="input-group"><label>Room Password</label><input id="roomPass" type="password"></div>
            <div class="input-group"><label>Your Name</label><input id="uName" value="Player"></div>
            ${tab==='create' ? `
                <div class="input-group"><label>Time (Min | Sec | Inc)</label>
                    <div class="time-row"><input type="number" id="tM" value="10"><input type="number" id="tS" value="0"><input type="number" id="tI" value="0"></div>
                </div>
                <div class="input-group"><label>Play As</label><select id="pC"><option value="white">White</option><option value="black">Black</option><option value="random">Random</option></select></div>
            `:''}
            <button class="start-btn" id="go">${tab.toUpperCase()}</button>
        </div>`;
        document.getElementById('tC').onclick = () => { tab='create'; draw(); };
        document.getElementById('tJ').onclick = () => { tab='join'; draw(); };
        document.getElementById('go').onclick = () => {
            currentPassword = document.getElementById('roomPass').value;
            const name = document.getElementById('uName').value;
            if (tab==='create') socket.emit("create-room", { password: currentPassword, name, mins: document.getElementById('tM').value, secs: document.getElementById('tS').value, inc: document.getElementById('tI').value, preferredColor: document.getElementById('pC').value });
            else socket.emit("join-attempt", { password: currentPassword, name });
        };
    };
    draw();
}
window.onload = showSetup;
