const socket = io("https://algebra-but-better.onrender.com");

let myColor, currentCode, myName;
let boardState, currentTurn = 'white', selected = null, isGameOver = false;
let moveHistory = [];

const WHITE_PIECES = ['♖','♘','♗','♕','♔','♙'];
const BLACK_PIECES = ['♜','♞','♝','♛','♚','♟'];

// --- CHESS LOGIC ---
const getTeam = (p) => WHITE_PIECES.includes(p) ? 'white' : (BLACK_PIECES.includes(p) ? 'black' : null);

function validateMove(fR, fC, tR, tC, p, target, board) {
    const dr = tR - fR, dc = tC - fC, adr = Math.abs(dr), adc = Math.abs(dc);
    const team = getTeam(p);
    if (target !== '' && getTeam(target) === team) return false;

    const isClear = (r1, c1, r2, c2) => {
        let stepR = r2 === r1 ? 0 : (r2 > r1 ? 1 : -1);
        let stepC = c2 === c1 ? 0 : (c2 > c1 ? 1 : -1);
        let cr = r1 + stepR, cc = c1 + stepC;
        while (cr !== r2 || cc !== c2) {
            if (board[cr][cc] !== '') return false;
            cr += stepR; cc += stepC;
        }
        return true;
    };

    if (p === '♙' || p === '♟') {
        const dir = team === 'white' ? -1 : 1;
        if (dc === 0 && target === '') return dr === dir || (dr === 2*dir && fR === (team==='white'?6:1) && board[fR+dir][fC] === '');
        if (adc === 1 && dr === dir && target !== '') return true;
        return false;
    }
    if (['♖','♜'].includes(p)) return (dr === 0 || dc === 0) && isClear(fR, fC, tR, tC);
    if (['♘','♞'].includes(p)) return (adr === 2 && adc === 1) || (adr === 1 && adc === 2);
    if (['♗','♝'].includes(p)) return adr === adc && isClear(fR, fC, tR, tC);
    if (['♕','♛'].includes(p)) return (adr === adc || dr === 0 || dc === 0) && isClear(fR, fC, tR, tC);
    if (['♔','♚'].includes(p)) return adr <= 1 && adc <= 1;
    return false;
}

function isInCheck(team, board) {
    const kChar = team === 'white' ? '♔' : '♚';
    let kr, kc;
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(board[r][c]===kChar){kr=r; kc=c;}
    const opp = team==='white'?'black':'white';
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) 
        if(getTeam(board[r][c]) === opp && validateMove(r,c,kr,kc,board[r][c],board[kr][kc],board)) return true;
    return false;
}

function isLegalMove(fR, fC, tR, tC, p, team) {
    if(!validateMove(fR, fC, tR, tC, p, boardState[tR][tC], boardState)) return false;
    const temp = boardState.map(r => [...r]);
    temp[tR][tC] = p; temp[fR][fC] = '';
    return !isInCheck(team, temp);
}

// --- RENDERING ---
function render() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';
    const range = myColor === 'black' ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    const check = isInCheck(currentTurn, boardState);

    for (let r of range) {
        for (let c of range) {
            const sq = document.createElement('div');
            const piece = boardState[r][c];
            sq.className = `square ${(r+c)%2===0 ? 'white-sq' : 'black-sq'}`;
            
            if (selected?.r === r && selected?.c === c) sq.classList.add('selected');
            if (check && (piece === '♔' || piece === '♚') && getTeam(piece) === currentTurn) sq.classList.add('check');

            if (selected && isLegalMove(selected.r, selected.c, r, c, boardState[selected.r][selected.c], myColor)) {
                const hint = document.createElement('div');
                hint.className = piece === '' ? 'hint-dot' : 'hint-capture';
                sq.appendChild(hint);
            }

            if (piece) {
                const sp = document.createElement('span');
                sp.className = `piece ${getTeam(piece) === 'white' ? 'w-piece' : 'b-piece'}`;
                sp.textContent = piece;
                sq.appendChild(sp);
            }

            sq.onclick = () => {
                if (currentTurn !== myColor || isGameOver) return;
                if (selected && isLegalMove(selected.r, selected.c, r, c, boardState[selected.r][selected.c], myColor)) {
                    executeMove(selected, {r, c}, true);
                } else {
                    if (getTeam(piece) === myColor) selected = {r, c};
                    else selected = null;
                    render();
                }
            };
            boardEl.appendChild(sq);
        }
    }
}

function executeMove(from, to, isLocal) {
    const piece = boardState[from.r][from.c];
    const target = boardState[to.r][to.c];
    boardState[to.r][to.c] = piece;
    boardState[from.r][from.c] = '';
    
    if (isLocal) socket.emit("send-move", { code: currentCode, from, to });
    
    // Notation
    const files = 'abcdefgh';
    const note = (piece === '♙' || piece === '♟' ? '' : 'N') + files[to.c] + (8-to.r);
    if (currentTurn === 'white') moveHistory.push({ w: note, b: '' });
    else moveHistory[moveHistory.length-1].b = note;

    currentTurn = currentTurn === 'white' ? 'black' : 'white';
    selected = null;
    updateNotation();
    render();
}

function updateNotation() {
    const table = document.getElementById('notation-table');
    table.innerHTML = moveHistory.map((m, i) => `
        <div class="move-row"><span>${i+1}.</span><span>${m.w}</span><span>${m.b}</span></div>
    `).join('');
}

// --- SOCKET EVENTS ---
socket.on("game-start", (data) => {
    document.getElementById('setup-overlay').style.display = 'none';
    document.getElementById('main-layout').style.display = 'flex';
    document.getElementById('white-name').innerText = data.whiteName;
    document.getElementById('black-name').innerText = data.blackName;
    boardState = [
        ['♜','♞','♝','♛','♚','♝','♞','♜'],['♟','♟','♟','♟','♟','♟','♟','♟'],
        ['','','','','','','',''],['','','','','','','',''],
        ['','','','','','','',''],['','','','','','','',''],
        ['♙','♙','♙','♙','♙','♙','♙','♙'],['♖','♘','♗','♕','♔','♗','♘','♖']
    ];
    render();
});

socket.on("assign-color", (c) => myColor = c);
socket.on("receive-move", (d) => executeMove(d.from, d.d, false));
socket.on("error-msg", (m) => alert(m));

socket.on("confirm-join", (d) => {
    if(confirm(`Join ${d.creatorName}'s room? (${d.settings.mins}m | ${d.yourColor})`)) {
        socket.emit("join-confirmed", { code: currentCode, name: myName });
    }
});

// --- UI CONTROLS ---
function showSetup() {
    const overlay = document.getElementById('setup-overlay');
    let mode = 'menu';

    const draw = () => {
        if (mode === 'menu') {
            overlay.innerHTML = `
                <div class="setup-card">
                    <h2>Chess Practice</h2>
                    <button class="btn-primary" onclick="window.setMode('create')">CREATE ROOM</button>
                    <button class="btn-primary" style="background:#3c3a37" onclick="window.setMode('join')">JOIN ROOM</button>
                </div>`;
        } else if (mode === 'create') {
            overlay.innerHTML = `
                <div class="setup-card">
                    <h3>Create Room</h3>
                    <div class="input-group"><label>Room Code</label><input id="cCode"></div>
                    <div class="input-group"><label>Username</label><input id="cName"></div>
                    <div class="input-group"><label>Mins | Secs | Inc</label>
                        <div style="display:flex; gap:5px"><input type="number" id="cM" value="10"><input type="number" id="cS" value="0"><input type="number" id="cI" value="0"></div>
                    </div>
                    <div class="input-group"><label>Color</label><select id="cCol"><option value="white">White</option><option value="black">Black</option><option value="random">Random</option></select></div>
                    <button class="btn-primary" id="finalCreate">CREATE</button>
                </div>`;
            document.getElementById('finalCreate').onclick = () => {
                currentCode = document.getElementById('cCode').value;
                myName = document.getElementById('cName').value;
                socket.emit("create-room", { code: currentCode, name: myName, mins: document.getElementById('cM').value, secs: document.getElementById('cS').value, inc: document.getElementById('cI').value, prefColor: document.getElementById('cCol').value });
                overlay.innerHTML = "<h2>Waiting for opponent...</h2>";
            }
        } else {
            overlay.innerHTML = `
                <div class="setup-card">
                    <h3>Join Room</h3>
                    <div class="input-group"><label>Room Code</label><input id="jCode"></div>
                    <div class="input-group"><label>Username</label><input id="jName"></div>
                    <button class="btn-primary" id="finalJoin">JOIN</button>
                </div>`;
            document.getElementById('finalJoin').onclick = () => {
                currentCode = document.getElementById('jCode').value;
                myName = document.getElementById('jName').value;
                socket.emit("join-attempt", { code: currentCode, name: myName });
            }
        }
    };
    window.setMode = (m) => { mode = m; draw(); };
    draw();
}

window.onload = showSetup;
