const socket = io("https://algebra-but-better.onrender.com");
let myColor = null, currentPassword = null, increment = 0;
let whiteName = "White", blackName = "Black"; 
let boardState, currentTurn, hasMoved = {}, enPassantTarget = null, selected = null, isGameOver = false, isInfinite = false;
let whiteTime, blackTime;

// --- SOCKET LOGIC ---
socket.on("error-msg", (msg) => alert(msg));

socket.on("waiting-for-opponent", () => {
    document.getElementById('setup-overlay').innerHTML = `
        <div class="setup-card">
            <h2>Room Created</h2>
            <p>Waiting for an opponent...</p>
            <p>Password: <b>${currentPassword}</b></p>
            <button class="secondary-btn" onclick="location.reload()">Cancel</button>
        </div>`;
});

socket.on("confirm-settings", (data) => {
    const { settings, creatorName } = data;
    const timeText = (settings.mins == 0 && settings.secs == 0) ? "Unlimited" : `${settings.mins}m ${settings.secs}s + ${settings.inc}s`;
    
    document.getElementById('setup-overlay').innerHTML = `
        <div class="setup-card">
            <h2>Match Found</h2>
            <p>Host: <b>${creatorName}</b></p>
            <p>Time: ${timeText}</p>
            <button class="start-btn" id="confirmJoin">JOIN GAME</button>
            <button class="secondary-btn" onclick="location.reload()">DECLINE</button>
        </div>`;
    
    document.getElementById('confirmJoin').onclick = () => {
        const uName = localStorage.getItem('lastUName') || "Player 2";
        socket.emit("join-confirmed", { password: currentPassword, name: uName });
    };
});

socket.on("game-start", (data) => {
    const s = data.settings;
    whiteName = data.whiteName; blackName = data.blackName;
    whiteTime = (parseInt(s.mins) * 60) + parseInt(s.secs);
    blackTime = whiteTime; increment = parseInt(s.inc);
    isInfinite = (whiteTime === 0);
    document.getElementById('setup-overlay').style.display = 'none';
    initGameState();
});

socket.on("assign-color", (color) => { myColor = color; render(); });

socket.on("receive-move", (data) => {
    whiteTime = data.whiteTime; blackTime = data.blackTime;
    handleActualMove(data.move.from, data.move.to, false);
});

// --- CHESS MECHANICS ---
const isWhite = (c) => ['♖','♙','♘','♗','♕','♔'].includes(c);
const getTeam = (c) => c === '' ? null : (isWhite(c) ? 'white' : 'black');

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
    if (['♔','♚'].includes(p)) return adr<=1 && adc<=1;
    return false;
}

function moveIsLegal(fR, fC, tR, tC, p, team) {
    if (!validateMoveMechanics(fR, fC, tR, tC, p, boardState[tR][tC], boardState)) return false;
    const temp = boardState.map(r => [...r]); temp[tR][tC] = p; temp[fR][fC] = '';
    const k = team === 'white' ? '♔' : '♚';
    let kr, kc;
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(temp[r][c]===k){kr=r;kc=c;}
    const atk = team==='white'?'black':'white';
    for(let i=0; i<8; i++) for(let j=0; j<8; j++) 
        if(temp[i][j]!=='' && getTeam(temp[i][j])===atk && validateMoveMechanics(i,j,kr,kc,temp[i][j],temp[kr][kc],temp)) return false;
    return true;
}

function handleActualMove(from, to, isLocal) {
    if (isGameOver) return;
    const p = boardState[from.r][from.c];
    boardState[to.r][to.c] = p; boardState[from.r][from.c] = '';
    if (isLocal) {
        if(currentTurn==='white') whiteTime+=increment; else blackTime+=increment;
        socket.emit("send-move", { password: currentPassword, move: { from, to }, whiteTime, blackTime });
    }
    currentTurn = currentTurn==='white'?'black':'white';
    selected = null; render();
}

// --- RENDERING ---
function render() {
    const layout = document.getElementById('main-layout');
    if (!layout) return; 
    layout.replaceChildren();

    const gameArea = document.createElement('div');
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
            const sq = document.createElement('div');
            const piece = boardState[r][c];
            sq.className = `square ${(r+c)%2===0 ? 'white-sq' : 'black-sq'}`;
            
            if (selected?.r===r && selected?.c===c) sq.classList.add('selected');

            // Draw Dots
            if (selected && moveIsLegal(selected.r, selected.c, r, c, boardState[selected.r][selected.c], currentTurn)) {
                const hint = document.createElement('div');
                hint.className = piece === '' ? 'hint-dot' : 'hint-capture';
                sq.appendChild(hint);
            }

            if(piece) {
                const sp = document.createElement('span');
                sp.className = `piece ${isWhite(piece)?'w-piece':'b-piece'}`;
                sp.textContent = piece; sq.appendChild(sp);
            }

            sq.onclick = () => {
                if (currentTurn !== myColor || isGameOver) return;
                if (selected) {
                    if (moveIsLegal(selected.r, selected.c, r, c, boardState[selected.r][selected.c], currentTurn)) {
                        handleActualMove(selected, {r,c}, true);
                    } else {
                        selected = getTeam(piece) === currentTurn ? {r,c} : null;
                        render();
                    }
                } else if (getTeam(piece) === currentTurn) {
                    selected = {r,c}; render();
                }
            };
            boardEl.appendChild(sq);
        }
    }
    gameArea.appendChild(boardEl);
    if(myColor === 'black') gameArea.appendChild(createBar(blackName, 'black'));
    else gameArea.appendChild(createBar(whiteName, 'white'));
    
    layout.appendChild(gameArea);
    updateTimerDisplay();
}

function initGameState() {
    boardState = [['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['','','','','','','',''],['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']];
    currentTurn = 'white'; isGameOver = false; render();
    if (window.timerInt) clearInterval(window.timerInt);
    window.timerInt = setInterval(() => {
        if (isGameOver || isInfinite) return;
        if (currentTurn === 'white') whiteTime--; else blackTime--;
        if (whiteTime <= 0 || blackTime <= 0) isGameOver = true;
        updateTimerDisplay();
    }, 1000);
}

function updateTimerDisplay() {
    const wT = document.getElementById('timer-white'), bT = document.getElementById('timer-black');
    if (wT) { wT.textContent = isInfinite ? "∞" : `${Math.floor(whiteTime/60)}:${(whiteTime%60).toString().padStart(2,'0')}`; wT.classList.toggle('active', currentTurn==='white'); }
    if (bT) { bT.textContent = isInfinite ? "∞" : `${Math.floor(blackTime/60)}:${(blackTime%60).toString().padStart(2,'0')}`; bT.classList.toggle('active', currentTurn==='black'); }
}

function showSetup() {
    const overlay = document.getElementById('setup-overlay');
    let tab = 'create';
    const draw = () => {
        overlay.innerHTML = `
        <div class="setup-card">
            <div class="tab-btns">
                <button class="tab-btn ${tab==='create'?'active':''}" id="tC">CREATE</button>
                <button class="tab-btn ${tab==='join'?'active':''}" id="tJ">JOIN</button>
            </div>
            <input id="roomPass" placeholder="Room Password">
            <input id="uName" placeholder="Your Name" value="Player">
            ${tab==='create' ? `
                <div class="time-row">
                    <input type="number" id="tM" value="10" title="Minutes">
                    <input type="number" id="tS" value="0" title="Seconds">
                    <input type="number" id="tI" value="0" title="Increment">
                </div>
                <select id="pC"><option value="white">Play as White</option><option value="black">Play as Black</option><option value="random">Random</option></select>
            `:''}
            <button class="start-btn" id="go">${tab==='create'?'CREATE ROOM':'FIND ROOM'}</button>
        </div>`;
        document.getElementById('tC').onclick = () => { tab='create'; draw(); };
        document.getElementById('tJ').onclick = () => { tab='join'; draw(); };
        document.getElementById('go').onclick = () => {
            currentPassword = document.getElementById('roomPass').value;
            const name = document.getElementById('uName').value;
            localStorage.setItem('lastUName', name);
            if (!currentPassword) return alert("Enter password");
            if (tab==='create') {
                socket.emit("create-room", { password: currentPassword, name, mins: document.getElementById('tM').value, secs: document.getElementById('tS').value, inc: document.getElementById('tI').value, preferredColor: document.getElementById('pC').value });
            } else {
                socket.emit("join-attempt", { password: currentPassword, name });
            }
        };
    };
    draw();
}
window.onload = showSetup;
