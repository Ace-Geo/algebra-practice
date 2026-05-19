const socket = io("https://algebra-but-better.onrender.com", {
    transports: ["websocket", "polling"],
    rememberUpgrade: true
});
socket.on("connect", () => {
    try {
        const saved = JSON.parse(localStorage.getItem("chessSession") || "null");
        if (saved?.password && saved?.name) socket.emit("rejoin-room", saved);
    } catch (_) {}
});

let myColor = null;
let currentPassword = null;
let tempName = "";
let whiteName = "White";
let blackName = "Black";
let spectatorName = "";
let spectatorId = null;
let isSpectator = false;
let boardPerspective = "white";
let lobbySpectateEnabled = false;
let activeGames = [];
let spectateVariantPreference = "standard";
let spectateSilent = false;
let spectateListPoll = null;

let isOpeningPractice = false;
let openingRepertoireLines = [];
let openingCurrentLine = [];
let openingIndex = 0;
let openingPlayerColor = 'white';

let spectatorRoster = [];
let setupView = "menu";
let selectedGame = null;
let coupLobby = null;
let coupGameState = null;

let boardState;
let currentTurn;
let hasMoved;
let enPassantTarget;
let selected;
let isGameOver;
let isInfinite;

let whiteTime;
let blackTime;
let increment;
let moveHistory = [];
let rematchRequested = false;
let gameSettings = null;
let currentVariant = "standard";
let positionCounts = {};
let halfmoveClock = 0;
let lastMoveHighlight = null;
let isBotGame = false;
let botColor = null;
let botElo = 1200;
let pendingBotVariant = "standard";
let botPlayAsChoice = "random";
let botEngineWorker = null;
let standardBotWorker = null;

// --- ADMIN & COMMAND STATE ---
let isAdmin = false;
let isOpponentAdmin = false;
let keyBuffer = "";
let isPaused = false;
let playerAdmins = { white: false, black: false };

// --- SOCKET LISTENERS ---
socket.on("player-assignment", (data) => {
    isAdmin = false;
    isSpectator = false;
    myColor = data.color;
    gameSettings = data.settings;
    currentVariant = data.settings?.variant || "standard";
    boardPerspective = myColor;
    spectatorRoster = [];
    spectatorId = null;
    playerAdmins = { white: false, black: false };
    if (myColor === 'white') {
        whiteName = tempName || "White";
        blackName = data.oppName;
    } else {
        blackName = tempName || "Black";
        whiteName = data.oppName;
    }
    playerAdmins[myColor] = isAdmin;
    try {
        const myName = myColor === 'white' ? whiteName : blackName;
        localStorage.setItem("chessSession", JSON.stringify({ password: currentPassword, name: myName }));
    } catch (_) {}
    const overlay = document.getElementById('setup-overlay');
    if (overlay) overlay.remove();
    initGameState();
    appendChatMessage("System", `Game started! You are playing as ${myColor.toUpperCase()}.`, true);
});

socket.on("spectator-assignment", (data) => {
    isAdmin = false;
    isSpectator = true;
    spectatorName = data.name;
    spectatorId = data.spectatorId;
    currentPassword = data.password;
    gameSettings = data.settings;
    whiteName = data.whiteName;
    blackName = data.blackName;
    myColor = 'spectator';
    boardPerspective = 'white';

    const overlay = document.getElementById('setup-overlay');
    if (overlay) overlay.remove();
    initGameState();
    showStatusMessage("Waiting for current board state from players...");
    appendChatMessage("System", `You are spectating as ${spectatorName}.`, true);
});

socket.on("room-created", (data) => {
    const card = document.querySelector('.setup-card');
    card.innerHTML = `
        <h2 style="color: #779556">Room Created</h2>
        <p>Waiting for opponent...</p>
        <div style="background: #1a1a1a; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <span style="color: #bababa; font-size: 12px; display: block; margin-bottom: 5px;">ROOM PASSWORD</span>
            <strong style="font-size: 24px; letter-spacing: 2px;">${data.password}</strong>
        </div>
        <button class="action-btn" onclick="location.reload()">Cancel</button>
    `;
});

socket.on("preview-settings", (data) => {
    const card = document.querySelector('.setup-card');
    const s = data.settings;
    let displayColor = "RANDOM";
    if (data.creatorColorPref === 'white') displayColor = "BLACK";
    if (data.creatorColorPref === 'black') displayColor = "WHITE";
    card.innerHTML = `
        <h2 style="color: #779556">Join Room?</h2>
        <div style="text-align: left; margin-bottom: 20px; background: #1a1a1a; padding: 15px; border-radius: 8px;">
            <p style="margin: 5px 0;"><strong>Host:</strong> ${data.creatorName}</p>
            <p style="margin: 5px 0;"><strong>Variant:</strong> ${(s.variant || "standard").toUpperCase()}</p>
            <p style="margin: 5px 0;"><strong>Time:</strong> ${s.mins}m ${s.secs}s</p>
            <p style="margin: 5px 0;"><strong>Increment:</strong> ${s.inc}s</p>
            <p style="margin: 5px 0;"><strong>Your Side:</strong> ${displayColor}</p>
        </div>
        <button class="start-btn" onclick="confirmJoin()">CONFIRM & START</button>
        <button class="action-btn" style="margin-top: 10px; width: 100%;" onclick="location.reload()">Back</button>
    `;
});

socket.on("receive-move", (data) => {
    whiteTime = data.whiteTime;
    blackTime = data.blackTime;
    handleActualMove(data.move.from, data.move.to, false, data.move.promotion || null);
});

socket.on("receive-chat", (data) => {
    appendChatMessage(data.sender, data.message);
});

socket.on("active-games", (data) => {
    activeGames = data.games || [];
    renderSpectateList();
});

socket.on("spectator-list-updated", (data) => {
    spectatorRoster = data.spectators || [];
});

socket.on("admin-list", (data) => {
    let list = `Player List:<br>White (${data.white.name}): Admin=${data.white.isAdmin}<br>Black (${data.black.name}): Admin=${data.black.isAdmin}`;
    (data.spectators || [])
        .slice()
        .sort((a, b) => a.id - b.id)
        .forEach((spec) => {
            list += `<br>Spectator ${spec.id} (${spec.name}): Admin=${spec.isAdmin}`;
        });
    appendChatMessage("Console", list, true);
});

socket.on("spectator-sync-needed", (data) => {
    if (isSpectator) return;
    socket.emit("spectator-state-sync", {
        password: currentPassword,
        targetSocketId: data.requesterId,
        state: {
            boardState,
            currentTurn,
            hasMoved,
            enPassantTarget,
            selected: null,
            isGameOver,
            isInfinite,
            isPaused,
            whiteTime,
            blackTime,
            increment,
            moveHistory,
            positionCounts,
            halfmoveClock
        }
    });
});

socket.on("spectator-state-sync", (data) => {
    if (!isSpectator || !data.state) return;
    boardState = data.state.boardState;
    currentTurn = data.state.currentTurn;
    hasMoved = data.state.hasMoved || {};
    enPassantTarget = data.state.enPassantTarget;
    selected = null;
    isGameOver = !!data.state.isGameOver;
    isInfinite = !!data.state.isInfinite;
    isPaused = !!data.state.isPaused;
    whiteTime = data.state.whiteTime;
    blackTime = data.state.blackTime;
    increment = data.state.increment;
    moveHistory = data.state.moveHistory || [];
    positionCounts = data.state.positionCounts || {};
    halfmoveClock = data.state.halfmoveClock || 0;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isInfinite) startTimer();
    render();
    if (isBotGame && !isGameOver && currentTurn === botColor) {
        setTimeout(makeBotMove, 350);
    }
});

socket.on("pause-state-updated", (data) => {
    isPaused = data.isPaused;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isPaused && !isGameOver && !isInfinite) startTimer();
    const status = isPaused ? "Game Paused by Admin" : "Game Resumed by Admin";
    appendChatMessage("Console", status, true);
    render();
    if (isBotGame && !isGameOver && currentTurn === botColor) {
        setTimeout(makeBotMove, 350);
    }
});

socket.on("time-updated", (data) => {
    if (data.color === 'white') whiteTime = data.newTime;
    else blackTime = data.newTime;
    updateTimerDisplay();
    appendChatMessage("Console", `${data.color.toUpperCase()} time set to ${formatTime(data.newTime)} by Admin`, true);
});

socket.on("increment-updated", (data) => {
    increment = data.newInc;
    appendChatMessage("Console", `Increment set to ${increment}s by Admin`, true);
});

socket.on("piece-placed", (data) => {
    boardState[data.r][data.c] = data.piece;
    resetPositionTracking();
    halfmoveClock = 0;
    appendChatMessage("Console", "Board modified by Admin", true);
    render();
    if (isBotGame && !isGameOver && currentTurn === botColor) {
        setTimeout(makeBotMove, 350);
    }
});

socket.on("board-reset-triggered", () => {
    boardState = [
        ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'],
        ['♟', '♟', '♟', '♟', '♟', '♟', '♟', '♟'],
        ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''],
        ['♙', '♙', '♙', '♙', '♙', '♙', '♙', '♙'],
        ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖']
    ];
    enPassantTarget = null;
    selected = null;
    hasMoved = {};
    resetPositionTracking();
    halfmoveClock = 0;
    appendChatMessage("Console", "Board reset to starting position by Admin", true);
    render();
    if (isBotGame && !isGameOver && currentTurn === botColor) {
        setTimeout(makeBotMove, 350);
    }
});

socket.on("permission-updated", (data) => {
    if (data.targetType === "spectator") {
        const existing = spectatorRoster.find((s) => s.id === data.spectatorId);
        if (existing) existing.isAdmin = data.isAdmin;
        if (isSpectator && spectatorId === data.spectatorId) {
            isAdmin = data.isAdmin;
            appendChatMessage("Console", `Your admin permissions have been ${isAdmin ? 'granted' : 'removed'} by Admin.`, true);
        } else {
            appendChatMessage("Console", `Spectator ${data.spectatorId} admin permissions set to ${data.isAdmin}.`, true);
        }
        return;
    }

    if (data.targetColor === myColor) {
        isAdmin = data.isAdmin;
        playerAdmins[data.targetColor] = data.isAdmin;
        appendChatMessage("Console", `Your admin permissions have been ${isAdmin ? 'granted' : 'removed'} by Admin.`, true);
    } else {
        isOpponentAdmin = data.isAdmin;
        playerAdmins[data.targetColor] = data.isAdmin;
        appendChatMessage("Console", `${data.targetColor.toUpperCase()} admin permissions set to ${data.isAdmin} by Admin.`, true);
    }
});

socket.on("opponent-resigned", (data) => {
    const status = `${data.winner.toUpperCase()} WINS BY RESIGNATION`;
    isGameOver = true;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    showResultModal(status);
    render(status);
});

socket.on("draw-offered", () => { if (!isSpectator) showDrawOffer(); });

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

socket.on("rematch-canceled", () => {
    const btn = document.getElementById('rematch-btn');
    if (btn) {
        btn.innerText = "Request Rematch";
        btn.classList.remove('rematch-ready');
    }
});

socket.on("rematch-start", () => {
    if (isSpectator) {
        initGameState();
        appendChatMessage("System", "Rematch started!", true);
        return;
    }
    rematchRequested = false;
    myColor = (myColor === 'white' ? 'black' : 'white');
    let oldWhite = whiteName;
    whiteName = blackName;
    blackName = oldWhite;
    const overlay = document.getElementById('game-over-overlay');
    if (overlay) overlay.remove();
    const reopenBtn = document.getElementById('reopen-results-btn');
    if (reopenBtn) reopenBtn.remove();
    initGameState();
    appendChatMessage("System", "Rematch started! Colors have been swapped.", true);
});

socket.on("error-msg", (msg) => { alert(msg); });
socket.on("room-closed", (data) => {
    alert(data?.message || "The room closed because a player disconnected.");
    location.reload();
});
socket.on("opponent-disconnected", (data) => {
    showStatusMessage(data?.message || "Opponent disconnected. Waiting for reconnection...");
});
socket.on("opponent-reconnected", (data) => {
    showStatusMessage(data?.message || "Opponent reconnected.");
});
socket.on("chess-state-sync-request", (data) => {
    if (isSpectator || !currentPassword) return;
    socket.emit("chess-state-sync", {
        password: currentPassword,
        targetSocketId: data.requesterId,
        state: {
            boardState,
            currentTurn,
            hasMoved,
            enPassantTarget,
            selected: null,
            isGameOver,
            isInfinite,
            isPaused,
            whiteTime,
            blackTime,
            increment,
            moveHistory,
            positionCounts,
            halfmoveClock,
            lastMoveHighlight
        }
    });
});
socket.on("chess-state-sync", (data) => {
    if (!data?.state) return;
    boardState = data.state.boardState;
    currentTurn = data.state.currentTurn;
    hasMoved = data.state.hasMoved || {};
    enPassantTarget = data.state.enPassantTarget;
    selected = null;
    isGameOver = !!data.state.isGameOver;
    isInfinite = !!data.state.isInfinite;
    isPaused = !!data.state.isPaused;
    whiteTime = data.state.whiteTime;
    blackTime = data.state.blackTime;
    increment = data.state.increment;
    moveHistory = data.state.moveHistory || [];
    positionCounts = data.state.positionCounts || {};
    halfmoveClock = data.state.halfmoveClock || 0;
    lastMoveHighlight = data.state.lastMoveHighlight || null;
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isInfinite && !isGameOver && !isPaused) startTimer();
    render();
    if (isBotGame && !isGameOver && currentTurn === botColor) {
        setTimeout(makeBotMove, 350);
    }
});

socket.on("coup-lobby-update", (data) => {
    selectedGame = "coup";
    setupView = "coup-lobby";
    currentPassword = data.password;
    coupLobby = data;
    renderSetupCard();
});

socket.on("coup-kicked", () => {
    alert("You were removed from the Coup room.");
    selectedGame = "coup";
    setupView = "coup-menu";
    coupLobby = null;
    currentPassword = null;
    renderSetupCard();
});

socket.on("coup-start-placeholder", (data) => {
    alert(data.message || "Coup gameplay is coming soon.");
});

socket.on("coup-game-started", () => {
    selectedGame = "coup";
    setupView = "coup-game";
    const overlay = document.getElementById('setup-overlay');
    if (overlay) overlay.remove();
});

socket.on("coup-game-state", (data) => {
    coupGameState = data;
    selectedGame = "coup";
    setupView = "coup-game";
    const overlay = document.getElementById('setup-overlay');
    if (overlay) overlay.remove();
    render();
    if (isBotGame && !isGameOver && currentTurn === botColor) {
        setTimeout(makeBotMove, 350);
    }
});

function appendChatMessage(sender, message, isSystem = false) {
    const msgContainer = document.getElementById('chat-messages');
    if (!msgContainer) return;
    const div = document.createElement('div');
    div.className = isSystem ? 'chat-msg system' : 'chat-msg';
    div.innerHTML = isSystem ? message : `<b>${sender}:</b> ${message}`;
    msgContainer.appendChild(div);
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg || !currentPassword) return;

    if (msg.startsWith("/") && isAdmin) {
        handleAdminCommand(msg);
        input.value = '';
        return;
    }

    const myName = isSpectator ? `${spectatorName} (spectator)` : (myColor === 'white' ? whiteName : blackName);
    socket.emit("send-chat", { password: currentPassword, message: msg, senderName: myName });
    appendChatMessage("You", msg);
    input.value = '';
}

const COMMANDS_HELP = {
    "pause": {
        desc: "Pauses or resumes the game clocks.",
        usage: "/pause <true/false>",
        args: "Use true to pause the game, or false to resume it."
    },
    "time": {
        desc: "Sets the remaining time for a specific player.",
        usage: "/time <white/black> <minutes> <seconds>",
        args: "Provide target color first, then minutes and seconds (for example: /time white 5 30)."
    },
    "place": {
        desc: "Replaces a square's content.",
        usage: "/place <square> <white/black/empty> <piece (if not empty)>",
        args: "Square is chess notation like e4. Color is white, black, or empty. Piece is pawn/knight/bishop/rook/queen/king when color is not empty."
    },
    "increment": {
        desc: "Changes the bonus seconds added after each move.",
        usage: "/increment <seconds>",
        args: "Provide the number of seconds to use as increment (for example: /increment 2)."
    },
    "reset": {
        desc: "Resets pieces to starting position (keeps time/turn).",
        usage: "/reset",
        args: "No arguments required."
    },
    "admin": {
        desc: "Lists admin status or toggles permissions for a color or spectator id.",
        usage: "/admin <list or color or spectator-id> <true/false (if not list)>",
        args: "Use /admin list to view permissions, /admin white true or /admin black false for players, or /admin <spectator-id> true/false for spectators."
    },
    "help": {
        desc: "Lists all commands or shows usage for one.",
        usage: "/help <command name (optional)>",
        args: "Optional command name (for example: /help pause)."
    }
};

function handleAdminCommand(cmd) {
    const args = cmd.split(' ');
    const baseCmd = args[0].toLowerCase().substring(1);

    if (baseCmd === "help") {
        const sub = args[1]?.toLowerCase();
        if (sub && COMMANDS_HELP[sub]) {
            appendChatMessage("Console", `<b>/${sub}</b><br>Usage: ${COMMANDS_HELP[sub].usage}<br>Arguments: ${COMMANDS_HELP[sub].args}`, true);
        } else {
            appendChatMessage("Console", "Available Commands:", true);
            for (const key in COMMANDS_HELP) {
                appendChatMessage("Console", `/${key} - ${COMMANDS_HELP[key].desc}`, true);
            }
        }
    }
    else if (baseCmd === "admin") {
        const subAction = args[1]?.toLowerCase();
        if (subAction === "list") {
            socket.emit("request-admin-list", { password: currentPassword });
        } else if ((subAction === 'white' || subAction === 'black') && (args[2] === 'true' || args[2] === 'false')) {
            socket.emit("admin-permission-toggle", {
                password: currentPassword,
                targetType: "player",
                targetColor: subAction,
                isAdmin: args[2] === 'true'
            });
        } else if (!isNaN(parseInt(subAction)) && (args[2] === 'true' || args[2] === 'false')) {
            socket.emit("admin-permission-toggle", {
                password: currentPassword,
                targetType: "spectator",
                spectatorId: parseInt(subAction),
                isAdmin: args[2] === 'true'
            });
        } else {
            appendChatMessage("Console", `Usage: ${COMMANDS_HELP.admin.usage}`, true);
        }
    }
    else if (baseCmd === "pause") {
        const val = args[1]?.toLowerCase();
        if (val === "true" || val === "false") {
            socket.emit("admin-pause-toggle", { password: currentPassword, isPaused: val === "true" });
        } else {
            appendChatMessage("Console", `Command missing arguments. Usage: ${COMMANDS_HELP.pause.usage}`, true);
        }
    }
    else if (baseCmd === "time") {
        const targetColor = args[1]?.toLowerCase();
        const mins = parseInt(args[2]);
        const secs = parseInt(args[3]);
        if ((targetColor === 'white' || targetColor === 'black') && !isNaN(mins) && !isNaN(secs)) {
            socket.emit("admin-set-time", {
                password: currentPassword,
                color: targetColor,
                newTime: (mins * 60) + secs
            });
        } else {
            appendChatMessage("Console", `Command missing arguments. Usage: ${COMMANDS_HELP.time.usage}`, true);
        }
    }
    else if (baseCmd === "increment") {
        const newInc = parseInt(args[1]);
        if (!isNaN(newInc)) {
            socket.emit("admin-set-increment", {
                password: currentPassword,
                newInc: newInc
            });
        } else {
            appendChatMessage("Console", `Usage: ${COMMANDS_HELP.increment.usage}`, true);
        }
    }
    else if (baseCmd === "reset") {
        socket.emit("admin-reset-board", { password: currentPassword });
    }
    else if (baseCmd === "place") {
        const sqName = args[1]?.toLowerCase();
        const color = args[2]?.toLowerCase();
        const pieceType = args[3]?.toLowerCase();

        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const fileIdx = files.indexOf(sqName?.[0]);
        const rowIdx = 8 - parseInt(sqName?.[1]);

        if (fileIdx !== -1 && !isNaN(rowIdx) && color) {
            let finalPiece = '';
            if (color !== 'empty') {
                const map = {
                    'white': { 'pawn': '♙', 'knight': '♘', 'bishop': '♗', 'rook': '♖', 'queen': '♕', 'king': '♔' },
                    'black': { 'pawn': '♟', 'knight': '♞', 'bishop': '♝', 'rook': '♜', 'queen': '♛', 'king': '♚' }
                };
                finalPiece = map[color]?.[pieceType] || '';
            }
            socket.emit("admin-place-piece", { password: currentPassword, r: rowIdx, c: fileIdx, piece: finalPiece });
        } else {
            appendChatMessage("Console", `Usage: ${COMMANDS_HELP.place.usage}`, true);
        }
    }
    else {
        appendChatMessage("Console", `Unknown command. Type /help to see all.`, true);
    }
}

window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;
    keyBuffer += e.key;
    if (keyBuffer.length > 2) keyBuffer = keyBuffer.slice(-2);
    if (keyBuffer === "[]") {
        isAdmin = true;
        if (myColor === 'white' || myColor === 'black') playerAdmins[myColor] = true;
        if (isSpectator && spectatorId) {
            const spec = spectatorRoster.find((s) => s.id === spectatorId);
            if (spec) spec.isAdmin = true;
        }
        if (document.getElementById('setup-overlay')) {
            lobbySpectateEnabled = true;
            renderSetupCard();
        } else {
            if (currentPassword) socket.emit("self-admin-enabled", { password: currentPassword });
            appendChatMessage("Console", "Admin mode enabled.", true);
        }
        keyBuffer = "";
    }
});

const isWhite = (piece) => ['♖', '♘', '♗', '♕', '♔', '♙'].includes(piece);
const getTeam = (piece) => piece === '' ? null : (isWhite(piece) ? 'white' : 'black');

function getPieceNotation(piece) {
    const map = { '♖': 'R', '♘': 'N', '♗': 'B', '♕': 'Q', '♔': 'K', '♜': 'R', '♞': 'N', '♝': 'B', '♛': 'Q', '♚': 'K' };
    return map[piece] || '';
}

function getNotation(fromR, fromC, toR, toC, piece, target, isEP, castle) {
    if (castle) return castle === 'short' ? 'O-O' : 'O-O-O';
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const rows = ['8', '7', '6', '5', '4', '3', '2', '1'];
    let moveStr = getPieceNotation(piece);
    let capture = (target !== '' || isEP) ? 'x' : '';
    if (moveStr === '' && capture) moveStr = files[fromC];
    return moveStr + capture + files[toC] + rows[toR];
}

function canAttackSquare(fromR, fromC, toR, toC, piece, board) {
    const dr = toR - fromR; const dc = toC - fromC;
    const adr = Math.abs(dr); const adc = Math.abs(dc);
    const team = getTeam(piece);
    const clearPath = (r1, c1, r2, c2) => {
        const stepR = r2 === r1 ? 0 : (r2 - r1) / Math.abs(r2 - r1);
        const stepC = c2 === c1 ? 0 : (c2 - c1) / Math.abs(c2 - c1);
        let currR = r1 + stepR; let currC = c1 + stepC;
        while (currR !== r2 || currC !== c2) {
            if (board[currR][currC] !== '') return false;
            currR += stepR; currC += stepC;
        }
        return true;
    };
    if (piece === '♙' || piece === '♟') {
        const dir = team === 'white' ? -1 : 1;
        return adc === 1 && dr === dir;
    }
    if (piece === '♖' || piece === '♜') return (dr === 0 || dc === 0) && clearPath(fromR, fromC, toR, toC);
    if (piece === '♘' || piece === '♞') return (adr === 2 && adc === 1) || (adr === 1 && adc === 2);
    if (piece === '♗' || piece === '♝') return adr === adc && clearPath(fromR, fromC, toR, toC);
    if (piece === '♕' || piece === '♛') return (adr === adc || dr === 0 || dc === 0) && clearPath(fromR, fromC, toR, toC);
    if (piece === '♔' || piece === '♚') return adr <= 1 && adc <= 1;
    return false;
}

function canMoveTo(fromR, fromC, toR, toC, piece, board) {
    const dr = toR - fromR; const dc = toC - fromC;
    const adr = Math.abs(dr); const adc = Math.abs(dc);
    const team = getTeam(piece); const target = board[toR][toC];
    if (target !== '' && getTeam(target) === team) return false;
    const clearPath = (r1, c1, r2, c2) => {
        const stepR = r2 === r1 ? 0 : (r2 - r1) / Math.abs(r2 - r1);
        const stepC = c2 === c1 ? 0 : (c2 - c1) / Math.abs(c2 - c1);
        let currR = r1 + stepR; let currC = c1 + stepC;
        while (currR !== r2 || currC !== c2) {
            if (board[currR][currC] !== '') return false;
            currR += stepR; currC += stepC;
        }
        return true;
    };
    if (piece === '♙' || piece === '♟') {
        const dir = team === 'white' ? -1 : 1;
        if (dc === 0 && target === '') {
            if (dr === dir) return true;
            if (dr === 2 * dir && fromR === (team === 'white' ? 6 : 1) && board[fromR + dir][fromC] === '') return true;
        }
        if (adc === 1 && dr === dir) {
            if (target !== '') return true;
            if (enPassantTarget && enPassantTarget.r === toR && enPassantTarget.c === toC) return true;
        }
        return false;
    }
    if ((piece === '♔' || piece === '♚') && adc === 2) {
        if (adr !== 0 || toR !== fromR) return false;
        if (!(toC === 2 || toC === 6)) return false;
        if (hasMoved[`${fromR},${fromC}`]) return false;
        if (isSquareAttacked(fromR, fromC, team === 'white' ? 'black' : 'white', board)) return false;
        const rookCol = toC === 6 ? 7 : 0;
        if (board[fromR][rookCol] === '' || hasMoved[`${fromR},${rookCol}`]) return false;
        return clearPath(fromR, fromC, fromR, rookCol);
    }
    return canAttackSquare(fromR, fromC, toR, toC, piece, board);
}

function isSquareAttacked(r, c, attackerTeam, board) {
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            const piece = board[i][j];
            if (piece !== '' && getTeam(piece) === attackerTeam) {
                if (currentVariant === "atomic" && (piece === '♔' || piece === '♚')) continue;
                if (canAttackSquare(i, j, r, c, piece, board)) return true;
            }
        }
    }
    return false;
}

function getKingPos(team, board) {
    const king = team === 'white' ? '♔' : '♚';
    for (let r = 0; r < 8; r++) { for (let c = 0; c < 8; c++) { if (board[r][c] === king) return { r, c }; } }
    return null;
}

function isTeamInCheck(team, board) {
    const pos = getKingPos(team, board);
    if (!pos) return false;
    return isSquareAttacked(pos.r, pos.c, team === 'white' ? 'black' : 'white', board);
}

function isMoveLegal(fromR, fromC, toR, toC, team) {
    const piece = boardState[fromR][fromC];
    if (currentVariant === "atomic" && (piece === '♔' || piece === '♚') && boardState[toR][toC] !== '') return false;
    if (!canMoveTo(fromR, fromC, toR, toC, piece, boardState)) return false;
    if ((piece === '♔' || piece === '♚') && Math.abs(toC - fromC) === 2) {
        const enemy = team === 'white' ? 'black' : 'white';
        const step = toC > fromC ? 1 : -1;
        if (isSquareAttacked(fromR, fromC + step, enemy, boardState)) return false;
        if (isSquareAttacked(toR, toC, enemy, boardState)) return false;
    }
    const nextBoard = boardState.map(row => [...row]);
    nextBoard[toR][toC] = piece;
    nextBoard[fromR][fromC] = '';
    if ((piece === '♙' || piece === '♟') && enPassantTarget && enPassantTarget.r === toR && enPassantTarget.c === toC) nextBoard[fromR][toC] = '';
    if (currentVariant === "atomic" && (boardState[toR][toC] !== '' || ((piece === '♙' || piece === '♟') && enPassantTarget && enPassantTarget.r === toR && enPassantTarget.c === toC))) {
        applyAtomicExplosion(nextBoard, toR, toC);
    }
    if (currentVariant === "atomic" && !getKingPos(team, nextBoard)) return false;
    if (currentVariant === "atomic") {
        const enemy = team === "white" ? "black" : "white";
        if (!getKingPos(enemy, nextBoard)) return true;
    }
    return !isTeamInCheck(team, nextBoard);
}

function getLegalMoves(team) {
    let moves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (getTeam(boardState[r][c]) === team) {
                for (let tr = 0; tr < 8; tr++) {
                    for (let tc = 0; tc < 8; tc++) {
                        if (isMoveLegal(r, c, tr, tc, team)) moves.push({ from: { r, c }, to: { r: tr, c: tc } });
                    }
                }
            }
        }
    }
    return moves;
}

function getCastlingRights() {
    const whiteKingMoved = !!hasMoved['7,4'];
    const blackKingMoved = !!hasMoved['0,4'];
    const wShort = !whiteKingMoved && !hasMoved['7,7'] && boardState[7][4] === '♔' && boardState[7][7] === '♖';
    const wLong = !whiteKingMoved && !hasMoved['7,0'] && boardState[7][4] === '♔' && boardState[7][0] === '♖';
    const bShort = !blackKingMoved && !hasMoved['0,7'] && boardState[0][4] === '♚' && boardState[0][7] === '♜';
    const bLong = !blackKingMoved && !hasMoved['0,0'] && boardState[0][4] === '♚' && boardState[0][0] === '♜';
    return `${wShort ? 'K' : ''}${wLong ? 'Q' : ''}${bShort ? 'k' : ''}${bLong ? 'q' : ''}` || '-';
}

function getPositionKey() {
    const boardKey = boardState.map((row) => row.map((p) => p || '.').join('')).join('/');
    const ep = enPassantTarget ? `${enPassantTarget.r},${enPassantTarget.c}` : '-';
    return `${boardKey}|${currentTurn}|${getCastlingRights()}|${ep}`;
}

function resetPositionTracking() {
    positionCounts = {};
    const key = getPositionKey();
    positionCounts[key] = 1;
}

function isInsufficientMaterial() {
    const extras = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = boardState[r][c];
            if (!piece || piece === '♔' || piece === '♚') continue;
            extras.push(piece);
        }
    }

    if (extras.length === 0) return true; // K vs K

    const isMinor = (p) => ['♗', '♘', '♝', '♞'].includes(p);
    const hasMajorOrPawn = extras.some((p) => !isMinor(p));
    if (hasMajorOrPawn) return false;

    if (extras.length <= 2) return true; // K+minor vs K or K+minor vs K+minor

    // K+NN vs K
    if (extras.length === 2 && extras.every((p) => p === '♘' || p === '♞')) return true;

    return false;
}

function handleActualMove(from, to, isLocal, promotionChoice = null) {
    if (isGameOver) return;
    const movingPiece = boardState[from.r][from.c];
    const targetPiece = boardState[to.r][to.c];
    const team = currentTurn;
    const isEP = (movingPiece === '♙' || movingPiece === '♟') && enPassantTarget && enPassantTarget.r === to.r && enPassantTarget.c === to.c;
    let castleType = null;
    if ((movingPiece === '♔' || movingPiece === '♚') && Math.abs(from.c - to.c) === 2) {
        castleType = from.c < to.c ? 'short' : 'long';
        const rookOldCol = to.c === 6 ? 7 : 0; const rookNewCol = to.c === 6 ? 5 : 3;
        boardState[to.r][rookNewCol] = boardState[to.r][rookOldCol]; boardState[to.r][rookOldCol] = '';
    }
    let notation = getNotation(from.r, from.c, to.r, to.c, movingPiece, targetPiece, isEP, castleType);
    if (isEP) boardState[from.r][to.c] = '';
    hasMoved[`${from.r},${from.c}`] = true;
    lastMoveHighlight = { from: { r: from.r, c: from.c }, to: { r: to.r, c: to.c } };
    boardState[to.r][to.c] = movingPiece; boardState[from.r][from.c] = '';
    if (currentVariant === "atomic" && (targetPiece !== '' || isEP)) {
        applyAtomicExplosion(boardState, to.r, to.c);
    }
    let promotedTo = null;
    if (movingPiece === '♙' && to.r === 0) {
        promotedTo = promotionChoice || '♕';
        boardState[to.r][to.c] = promotedTo;
    }
    if (movingPiece === '♟' && to.r === 7) {
        promotedTo = promotionChoice || '♛';
        boardState[to.r][to.c] = promotedTo;
    }
    const isPawnMove = movingPiece === '♙' || movingPiece === '♟';
    const isCapture = targetPiece !== '' || isEP;
    halfmoveClock = (isPawnMove || isCapture) ? 0 : (halfmoveClock + 1);
    if (!isInfinite && isLocal) { if (team === 'white') whiteTime += increment; else blackTime += increment; }
    enPassantTarget = (movingPiece === '♙' || movingPiece === '♟') && Math.abs(from.r - to.r) === 2 ? { r: (from.r + to.r) / 2, c: to.c } : null;
    currentTurn = (team === 'white' ? 'black' : 'white');
    if (currentVariant === "atomic") {
        const whiteKingAlive = !!getKingPos('white', boardState);
        const blackKingAlive = !!getKingPos('black', boardState);
        if (!whiteKingAlive && !blackKingAlive) {
            if (isLocal && !isBotGame) socket.emit("send-move", { password: currentPassword, move: { from, to, promotion: promotedTo }, whiteTime, blackTime });
            isGameOver = true;
            if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
            showResultModal("DRAW - BOTH KINGS EXPLODED");
            render("DRAW - BOTH KINGS EXPLODED");
            return;
        }
        if (!whiteKingAlive || !blackKingAlive) {
            const winner = whiteKingAlive ? "WHITE" : "BLACK";
            if (isLocal && !isBotGame) socket.emit("send-move", { password: currentPassword, move: { from, to, promotion: promotedTo }, whiteTime, blackTime });
            isGameOver = true;
            if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
            showResultModal(`${winner} WINS BY ATOMIC EXPLOSION`);
            render(`${winner} WINS BY ATOMIC EXPLOSION`);
            return;
        }
    }
    const positionKey = getPositionKey();
    positionCounts[positionKey] = (positionCounts[positionKey] || 0) + 1;
    const nextMoves = getLegalMoves(currentTurn); const inCheck = isTeamInCheck(currentTurn, boardState);
    let forcedStatus = null;
    if (positionCounts[positionKey] >= 3) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        forcedStatus = "DRAW BY THREEFOLD REPETITION";
        showResultModal(forcedStatus);
    } else if (halfmoveClock >= 100) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        forcedStatus = "DRAW BY FIFTY-MOVE RULE";
        showResultModal(forcedStatus);
    } else if (isInsufficientMaterial()) {
        isGameOver = true;
        if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        forcedStatus = "DRAW BY INSUFFICIENT MATERIAL";
        showResultModal(forcedStatus);
    } else if (nextMoves.length === 0) {
        isGameOver = true; if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
        if (inCheck) { notation += '#'; forcedStatus = `CHECKMATE! ${team.toUpperCase()} WINS`; }
        else forcedStatus = "DRAW BY STALEMATE";
        showResultModal(forcedStatus);
    } else if (inCheck) notation += '+';
    if (team === 'white') moveHistory.push({ w: notation, b: '' });
    else if (moveHistory.length > 0) moveHistory[moveHistory.length - 1].b = notation;
    selected = null;
    if (isLocal && !isBotGame) socket.emit("send-move", { password: currentPassword, move: { from, to, promotion: promotedTo }, whiteTime, blackTime });
    if (isLocal && isBotGame && !isGameOver && currentTurn === botColor) {
        setTimeout(makeBotMove, 350);
    }
    render(forcedStatus);
}

function makeBotMove() {
    if (!isBotGame || isGameOver || currentTurn !== botColor) return;
    if (currentVariant === "atomic") {
        makeEngineBotMove("atomic");
        return;
    }
    makeEngineBotMove("standard");
}

function makeEngineBotMove(variant) {
    const legal = getLegalMoves(botColor);
    if (!legal.length) return;
    const workerPromise = ensureStockfishWorker();
    workerPromise.then((worker) => {
        if (!worker) {
            appendChatMessage("System", "Could not load Stockfish.", true);
            return;
        }
        requestEngineMove(worker, variant).then((uciMove) => {
            const parsed = parseUciMove(uciMove);
            if (!parsed) {
                appendChatMessage("System", "Engine returned an invalid move.", true);
                return;
            }
            const found = legal.find((m) => m.from.r === parsed.from.r && m.from.c === parsed.from.c && m.to.r === parsed.to.r && m.to.c === parsed.to.c);
            if (!found) {
                appendChatMessage("System", "Engine move was not legal in current position.", true);
                return;
            }
            handleActualMove(found.from, found.to, false, null);
        }).catch(() => {
            appendChatMessage("System", "Engine is still thinking; please wait a moment and try again if needed.", true);
        });
    });
}

async function ensureStockfishWorker() {
    if (standardBotWorker) return standardBotWorker;
    const urls = [
        'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.asm.js',
        'https://unpkg.com/stockfish.js@10.0.2/stockfish.asm.js',
        'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js',
        'https://unpkg.com/stockfish.js@10.0.2/stockfish.js'
    ];
    for (const url of urls) {
        try {
            const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
            if (!response.ok) continue;
            const source = await response.text();
            if (!source || source.length < 1000) continue;
            const blob = new Blob([source], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            const worker = new Worker(blobUrl);
            const ok = await probeEngineWorker(worker);
            if (!ok) {
                try { worker.terminate(); } catch (_) {}
                URL.revokeObjectURL(blobUrl);
                continue;
            }
            standardBotWorker = worker;
            return standardBotWorker;
        } catch (_) {
            // Try next source
        }
    }
    return null;
}


function probeEngineWorker(worker, timeoutMs = 6000) {
    return new Promise((resolve) => {
        let done = false;
        const t = setTimeout(() => {
            if (done) return;
            done = true;
            worker.removeEventListener('message', onMsg);
            resolve(false);
        }, timeoutMs);
        const onMsg = (e) => {
            const line = String(e.data || '');
            if (!/uciok|readyok|Stockfish|Fairy/i.test(line)) return;
            if (done) return;
            done = true;
            clearTimeout(t);
            worker.removeEventListener('message', onMsg);
            resolve(true);
        };
        worker.addEventListener('message', onMsg);
        try {
            worker.postMessage('uci');
            worker.postMessage('isready');
        } catch (_) {
            clearTimeout(t);
            worker.removeEventListener('message', onMsg);
            resolve(false);
        }
    });
}

async function ensureFairyStockfishWorker() {
    if (botEngineWorker) return botEngineWorker;
    const urls = [
        'https://cdn.jsdelivr.net/npm/fairy-stockfish@16.1.0/src/ffish.js',
        'https://unpkg.com/fairy-stockfish@16.1.0/src/ffish.js'
    ];
    for (const url of urls) {
        try {
            const directWorker = new Worker(url);
            const directOk = await probeEngineWorker(directWorker, 10000);
            if (directOk) {
                botEngineWorker = directWorker;
                return botEngineWorker;
            }
            try { directWorker.terminate(); } catch (_) {}
        } catch (_) {
            // Try fetch/blob fallback
        }

        try {
            const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
            if (!response.ok) continue;
            const source = await response.text();
            if (!source || source.length < 1000) continue;
            const blob = new Blob([source], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            const worker = new Worker(blobUrl);
            const ok = await probeEngineWorker(worker, 10000);
            if (!ok) {
                try { worker.terminate(); } catch (_) {}
                URL.revokeObjectURL(blobUrl);
                continue;
            }
            botEngineWorker = worker;
            return botEngineWorker;
        } catch (_) {
            // Try next source
        }
    }
    return null;
}

function requestEngineMove(worker, variant) {
    return new Promise((resolve, reject) => {
        const fen = boardToFen(boardState, currentTurn);
        let settled = false;
        let stopTimer = null;
        const cleanup = () => {
            if (stopTimer) clearTimeout(stopTimer);
            worker.removeEventListener('message', onMsg);
        };
        const onMsg = (e) => {
            const line = String(e.data || '');
            if (!line.startsWith('bestmove')) return;
            if (settled) return;
            settled = true;
            cleanup();
            const mv = line.split(/\s+/)[1];
            if (!mv || mv === '(none)') reject(new Error('no move'));
            else resolve(mv);
        };

        worker.addEventListener('message', onMsg);
        worker.postMessage('uci');
        if (variant === 'atomic') worker.postMessage('setoption name UCI_Variant value atomic');
        const requestedElo = Math.max(400, Math.min(3000, Number(botElo) || 1000));
        worker.postMessage('setoption name UCI_LimitStrength value true');
        worker.postMessage(`setoption name UCI_Elo value ${requestedElo}`);
        const skill = Math.max(0, Math.min(20, Math.round((requestedElo - 400) / 130)));
        worker.postMessage(`setoption name Skill Level value ${skill}`);
        worker.postMessage('isready');
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage('go infinite');

        stopTimer = setTimeout(() => {
            try { worker.postMessage('stop'); } catch (_) {}
            setTimeout(() => {
                try { worker.postMessage('stop'); } catch (_) {}
            }, 2500);
        }, 5000);
    });
}

function parseUciMove(move) {
    if (!move || move.length < 4) return null;
    const files = 'abcdefgh';
    const fromC = files.indexOf(move[0]);
    const toC = files.indexOf(move[2]);
    const fromR = 8 - Number(move[1]);
    const toR = 8 - Number(move[3]);
    if (fromC < 0 || toC < 0 || Number.isNaN(fromR) || Number.isNaN(toR)) return null;
    return { from: { r: fromR, c: fromC }, to: { r: toR, c: toC } };
}

function boardToFen(board, turn) {
    const map = { '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♙': 'P', '♚': 'k', '♛': 'q', '♜': 'r', '♝': 'b', '♞': 'n', '♟': 'p' };
    const ranks = board.map((row) => {
        let out = '';
        let empty = 0;
        row.forEach((piece) => {
            if (!piece) empty++;
            else {
                if (empty) out += empty;
                empty = 0;
                out += map[piece] || '';
            }
        });
        if (empty) out += empty;
        return out;
    });
    return `${ranks.join('/')} ${turn === 'white' ? 'w' : 'b'} - - 0 1`;
}

function render(forcedStatus) {
    const layout = document.getElementById('main-layout');
    if (!layout) return;

    if (selectedGame === "coup" && setupView === "coup-game" && coupGameState) {
        renderCoupGame(layout);
        return;
    }
    document.body.classList.remove("coup-mode");
    const coupPrompt = document.getElementById('coup-prompt-area');
    if (coupPrompt) coupPrompt.remove();
    layout.className = "";

    if (!document.getElementById('chat-panel')) {
        const chatPanel = document.createElement('div');
        chatPanel.id = 'chat-panel';
        chatPanel.innerHTML = `
            <div id="chat-header">GAME CHAT</div>
            <div id="chat-messages"></div>
            <div id="chat-input-area">
                <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off">
                <button id="chat-send-btn">Send</button>
            </div>
        `;
        const newInp = chatPanel.querySelector('#chat-input');
        newInp.addEventListener('keydown', (e) => e.stopPropagation());
        newInp.onkeypress = (e) => { e.stopPropagation(); if (e.key === 'Enter') sendChatMessage(); };
        chatPanel.querySelector('#chat-send-btn').onclick = sendChatMessage;
        layout.appendChild(chatPanel);
    }

    const oldGame = document.getElementById('game-area');
    const oldSide = document.getElementById('side-panel');
    if(oldGame) oldGame.remove();
    if(oldSide) oldSide.remove();

    const gameArea = document.createElement('div');
    gameArea.id = 'game-area';
    const createPlayerBar = (name, id) => {
        const bar = document.createElement('div');
        const isYou = !isSpectator && myColor === id;
        bar.className = 'player-bar';
        bar.innerHTML = `<span class="player-name">${name} ${isYou ? '(YOU)' : ''}</span><div id="timer-${id}" class="timer">--:--</div>`;
        return bar;
    };

    const topColor = boardPerspective === 'black' ? 'white' : 'black';
    const bottomColor = boardPerspective === 'black' ? 'black' : 'white';
    gameArea.appendChild(createPlayerBar(topColor === 'white' ? whiteName : blackName, topColor));

    const boardCont = document.createElement('div');
    boardCont.id = 'board-container';
    const boardEl = document.createElement('div');
    boardEl.id = 'board';

    const check = isTeamInCheck(currentTurn, boardState);
    let hints = (selected && !isGameOver) ? getLegalMoves(currentTurn).filter(m => m.from.r === selected.r && m.from.c === selected.c).map(m => m.to) : [];
    const range = (boardPerspective === 'black') ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

    for (let r of range) {
        for (let c of range) {
            const sq = document.createElement('div'); sq.className = `square ${(r + c) % 2 === 0 ? 'white-sq' : 'black-sq'}`;
            if (check && boardState[r][c] === (currentTurn === 'white' ? '♔' : '♚')) sq.classList.add('king-check');
            if (selected && selected.r === r && selected.c === c) sq.classList.add('selected');
            if (lastMoveHighlight && lastMoveHighlight.from.r === r && lastMoveHighlight.from.c === c) sq.classList.add('last-from');
            if (lastMoveHighlight && lastMoveHighlight.to.r === r && lastMoveHighlight.to.c === c) sq.classList.add('last-to');
            if (hints.some(h => h.r === r && h.c === c)) {
                const hint = document.createElement('div'); hint.className = boardState[r][c] === '' ? 'hint-dot' : 'hint-capture';
                sq.appendChild(hint);
            }
            if (boardState[r][c] !== '') {
                const span = document.createElement('span');
                const pieceClass = getPieceTextureClass(boardState[r][c]);
                span.className = `piece textured-piece ${pieceClass}`;
                sq.appendChild(span);
            }
            sq.onclick = async () => {
                if (isSpectator || isGameOver || currentTurn !== myColor) return;
                if (selected) {
                    if (hints.some(h => h.r === r && h.c === c)) {
                        const piece = boardState[selected.r][selected.c];
                        const team = getTeam(piece);
                        let promotionChoice = null;
                        const isPromotionMove = (piece === '♙' && team === 'white' && r === 0) || (piece === '♟' && team === 'black' && r === 7);
                        if (isPromotionMove) promotionChoice = await choosePromotionPiece(team);
                        handleOpeningPracticePlayerMove(selected, { r, c }, promotionChoice);
                    } else if (getTeam(boardState[r][c]) === currentTurn) {
                        selected = (selected.r === r && selected.c === c) ? null : { r, c };
                        render();
                    } else {
                        selected = null;
                        render();
                    }
                } else if (getTeam(boardState[r][c]) === currentTurn) {
                    selected = { r, c };
                    render();
                }
            };
            boardEl.appendChild(sq);
        }
    }
    boardCont.appendChild(boardEl); gameArea.appendChild(boardCont);

    gameArea.appendChild(createPlayerBar(bottomColor === 'white' ? whiteName : blackName, bottomColor));

    layout.appendChild(gameArea);

    const sidePanel = document.createElement('div');
    sidePanel.id = 'side-panel';
    let statusDisplay = forcedStatus || (isGameOver ? "GAME OVER" : `${currentTurn.toUpperCase()}'S TURN ${check ? '(CHECK!)' : ''}`);
    sidePanel.innerHTML = `
        <div id="status-box"><div id="status-text">${statusDisplay}</div></div>
        <div id="notification-area"></div>
        <div class="btn-row">
            ${isSpectator
                ? `<button class="action-btn" onclick="flipBoard()">Flip Board</button>
                   <button class="action-btn" onclick="returnToLobby()">Return</button>`
                : `<button class="action-btn" onclick="offerDraw()" ${isGameOver ? 'disabled' : ''}>Offer Draw</button>
                   <button class="action-btn" onclick="resignGame()" ${isGameOver ? 'disabled' : ''}>Resign</button>`}
        </div>
        <button class="action-btn" style="width:100%;" onclick="showRulesPopup()">Game Rules</button>
        <div id="history-container"></div>
    `;
    const hist = sidePanel.querySelector('#history-container');
    moveHistory.forEach((m, i) => {
        const row = document.createElement('div'); row.className = 'history-row';
        row.innerHTML = `<div class="move-num">${i + 1}.</div><div>${m.w}</div><div>${m.b}</div>`;
        hist.appendChild(row);
    });
    layout.appendChild(sidePanel);

    updateTimerDisplay();
}

function updateTimerDisplay() {
    const wT = document.getElementById('timer-white'); const bT = document.getElementById('timer-black');
    if (wT) { wT.textContent = formatTime(whiteTime); wT.className = `timer ${currentTurn === 'white' && !isGameOver ? 'active' : ''}`; }
    if (bT) { bT.textContent = formatTime(blackTime); bT.className = `timer ${currentTurn === 'black' && !isGameOver ? 'active' : ''}`; }
}

function formatTime(seconds) {
    if (isInfinite) return "∞";
    const s = Math.max(0, seconds); const m = Math.floor(s / 60); const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

function startTimer() {
    window.chessIntervalInstance = setInterval(() => {
        if (isGameOver || isPaused) return;
        if (currentTurn === 'white') whiteTime--; else blackTime--;
        updateTimerDisplay();
        if (whiteTime <= 0 || blackTime <= 0) {
            isGameOver = true; clearInterval(window.chessIntervalInstance);
            const msg = whiteTime <= 0 ? "BLACK WINS ON TIME" : "WHITE WINS ON TIME";
            showResultModal(msg); render(msg);
        }
    }, 1000);
}

function initGameState() {
    boardState = [
        ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'], ['♟', '♟', '♟', '♟', '♟', '♟', '♟', '♟'],
        ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''],
        ['♙', '♙', '♙', '♙', '♙', '♙', '♙', '♙'], ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖']
    ];
    currentTurn = 'white'; hasMoved = {}; moveHistory = []; isGameOver = false; selected = null; rematchRequested = false; isPaused = false;
    lastMoveHighlight = null;
    halfmoveClock = 0;
    boardPerspective = isSpectator ? 'white' : myColor;
    if (gameSettings) {
        whiteTime = (parseInt(gameSettings.mins) * 60) + parseInt(gameSettings.secs);
        blackTime = whiteTime; increment = parseInt(gameSettings.inc) || 0;
        isInfinite = (whiteTime === 0);
    }
    resetPositionTracking();
    if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    if (!isInfinite) startTimer();
    render();
    if (isBotGame && !isGameOver && currentTurn === botColor) {
        setTimeout(makeBotMove, 350);
    }
}

function showSetup() {
    const overlay = document.createElement('div'); overlay.id = 'setup-overlay';
    overlay.innerHTML = `
        <div class="setup-card">
            <div id="setup-card-content"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    renderSetupCard();
}

function renderSetupCard() {
    const content = document.getElementById('setup-card-content');
    if (!content) return;
    if (setupView === "game-select") {
        content.innerHTML = `
            <h1 style="color:#779556; margin-top:0;">Choose a Game</h1>
            <p style="color:#bababa; margin-bottom:20px;">Select what you want to play.</p>
            <button class="start-btn" onclick="setSetupView('chess-menu')">Play Chess</button>
            <button class="start-btn" style="margin-top:10px;" onclick="setSetupView('atomic-menu')">Play Atomic Chess</button>
            <button class="start-btn" style="margin-top:10px;" onclick="setSetupView('coup-menu')">Play Coup</button>
        `;
        return;
    }

    if (setupView === "chess-menu") {
        content.innerHTML = `
            <h1 style="color:#779556; margin-top:0;">Chess</h1>
            <p style="color:#bababa; margin-bottom:20px;">Choose an option</p>
            <button class="start-btn" onclick="setSetupView('chess-create')">Create New Game</button>
            <button class="start-btn" style="margin-top:10px;" onclick="setSetupView('chess-join')">Join Game</button>
            <button class="action-btn" style="margin-top:10px; width:100%; padding:12px; font-size:14px;" onclick="showRulesPopup()">Game Rules</button>
            ${lobbySpectateEnabled ? '<button class="action-btn" style="margin-top:10px; width:100%; padding:12px; font-size:14px;" onclick="openSpectateMenu()">Spectate Games</button>' : ''}
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="startBotGameSetup('standard')">Play vs Bot</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('chess-opening-practice')">Practice Opening Repertoire</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('game-select')">Play a Different Game</button>
        `;
        return;
    }

    if (setupView === "chess-create") {
        content.innerHTML = `
            <h2 style="color:#779556; margin-top:0;">Create New Game</h2>
            <div class="input-group"><label>Room Password</label><input id="roomPass" placeholder="Secret Code"></div>
            <div class="input-group"><label>Your Name</label><input id="uName" value="Player 1"></div>
            <div class="input-group"><label>Time Control</label><div style="display:flex; gap:5px;"><input type="number" id="tMin" value="10"><input type="number" id="tSec" value="0"><input type="number" id="tInc" value="0"></div></div>
            <div class="input-group"><label>Play As</label><select id="colorPref"><option value="random">Random</option><option value="white">White</option><option value="black">Black</option></select></div>
            <button class="start-btn" onclick="createRoom()">CREATE</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('chess-menu')">Return to Menu</button>
        `;
        return;
    }

    if (setupView === "chess-join") {
        content.innerHTML = `
            <h2 style="color:#779556; margin-top:0;">Join Game</h2>
            <div class="input-group"><label>Room Password</label><input id="joinPass" placeholder="Enter Password"></div>
            <div class="input-group"><label>Your Name</label><input id="joinName" value="Player 2"></div>
            <button class="start-btn" onclick="joinRoom()">FIND ROOM</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('chess-menu')">Return to Menu</button>
        `;
        return;
    }



    if (setupView === "chess-opening-practice") {
        content.innerHTML = `
            <h2 style="color:#779556; margin-top:0;">Opening Practice</h2>
            <div class="input-group"><label>Built-in Repertoire</label>
                <select id="openingPreset"><option value="london">London System</option></select>
            </div>
            <div class="input-group"><label>Or Upload PGN</label><input id="openingPgnFile" type="file" accept=".pgn,text/plain"></div>
            <div class="input-group"><label>Play As</label><select id="openingColor"><option value="white">White</option><option value="black">Black</option></select></div>
            <button class="start-btn" onclick="startOpeningPractice()">START PRACTICE</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('chess-menu')">Return to Menu</button>
        `;
        return;
    }

    if (setupView === "chess-bot-setup" || setupView === "atomic-bot-setup") {
        const isAtomic = setupView === "atomic-bot-setup";
        content.innerHTML = `
            <h2 style="color:#779556; margin-top:0;">${isAtomic ? "Atomic" : "Chess"} Bot Setup</h2>
            <div class="input-group"><label>Bot Elo</label><input type="number" id="botEloInput" min="400" max="3000" value="1000"></div>
            <div class="input-group"><label>Play As</label><select id="botColorSelect"><option value="random">Random</option><option value="white">White</option><option value="black">Black</option></select></div>
            <button class="start-btn" onclick="startBotGameFromSetup()">START GAME</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('${isAtomic ? "atomic-menu" : "chess-menu"}')">Return to Menu</button>
        `;
        return;
    }

    if (setupView === "atomic-menu") {
        content.innerHTML = `
            <h1 style="color:#779556; margin-top:0;">Atomic Chess</h1>
            <p style="color:#bababa; margin-bottom:20px;">Choose an option</p>
            <button class="start-btn" onclick="setSetupView('atomic-create')">Create New Game</button>
            <button class="start-btn" style="margin-top:10px;" onclick="setSetupView('atomic-join')">Join Game</button>
            <button class="action-btn" style="margin-top:10px; width:100%; padding:12px; font-size:14px;" onclick="showRulesPopup()">Game Rules</button>
            ${lobbySpectateEnabled ? '<button class="action-btn" style="margin-top:10px; width:100%; padding:12px; font-size:14px;" onclick="openSpectateMenu()">Spectate Games</button>' : ''}
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="startBotGameSetup('atomic')">Play vs Bot</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('game-select')">Play a Different Game</button>
        `;
        return;
    }

    if (setupView === "atomic-create") {
        content.innerHTML = `
            <h2 style="color:#779556; margin-top:0;">Create Atomic Game</h2>
            <div class="input-group"><label>Room Password</label><input id="roomPass" placeholder="Secret Code"></div>
            <div class="input-group"><label>Your Name</label><input id="uName" value="Player 1"></div>
            <div class="input-group"><label>Time Control</label><div style="display:flex; gap:5px;"><input type="number" id="tMin" value="3"><input type="number" id="tSec" value="0"><input type="number" id="tInc" value="2"></div></div>
            <div class="input-group"><label>Play As</label><select id="colorPref"><option value="random">Random</option><option value="white">White</option><option value="black">Black</option></select></div>
            <button class="start-btn" onclick="createRoom('atomic')">CREATE</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('atomic-menu')">Return to Menu</button>
        `;
        return;
    }

    if (setupView === "atomic-join") {
        content.innerHTML = `
            <h2 style="color:#779556; margin-top:0;">Join Atomic Game</h2>
            <div class="input-group"><label>Room Password</label><input id="joinPass" placeholder="Enter Password"></div>
            <div class="input-group"><label>Your Name</label><input id="joinName" value="Player 2"></div>
            <button class="start-btn" onclick="joinRoom()">FIND ROOM</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('atomic-menu')">Return to Menu</button>
        `;
        return;
    }

    if (setupView === "coup-menu") {
        content.innerHTML = `
            <h1 style="color:#779556; margin-top:0;">Coup</h1>
            <p style="color:#bababa; margin-bottom:20px;">Choose an option</p>
            <button class="start-btn" onclick="setSetupView('coup-create')">Create New Game</button>
            <button class="start-btn" style="margin-top:10px;" onclick="setSetupView('coup-join')">Join Game</button>
            <button class="action-btn" style="margin-top:10px; width:100%; padding:12px; font-size:14px;" onclick="showCoupRulesPopup()">Game Rules</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('game-select')">Play a Different Game</button>
        `;
        return;
    }

    if (setupView === "coup-create") {
        content.innerHTML = `
            <h2 style="color:#779556; margin-top:0;">Create Coup Game</h2>
            <div class="input-group"><label>Room Password</label><input id="coupCreatePass" placeholder="Secret Code"></div>
            <div class="input-group"><label>Your Username</label><input id="coupCreateName" value="Host"></div>
            <button class="start-btn" onclick="createCoupRoom()">CREATE</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('coup-menu')">Return to Menu</button>
        `;
        return;
    }

    if (setupView === "coup-join") {
        content.innerHTML = `
            <h2 style="color:#779556; margin-top:0;">Join Coup Game</h2>
            <div class="input-group"><label>Room Password</label><input id="coupJoinPass" placeholder="Enter Password"></div>
            <div class="input-group"><label>Your Username</label><input id="coupJoinName" value="Player"></div>
            <button class="start-btn" onclick="joinCoupRoom()">JOIN</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="setSetupView('coup-menu')">Return to Menu</button>
        `;
        return;
    }

    if (setupView === "coup-lobby" && coupLobby) {
        const playersHtml = (coupLobby.players || []).map((player) => {
            const isHost = player.socketId === coupLobby.hostId;
            const canKick = socket.id === coupLobby.hostId && player.socketId !== socket.id;
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#1a1a1a; padding:10px; border-radius:6px; margin-bottom:8px;">
                    <div>${player.name}${isHost ? " <span style='color:#779556'>(Host)</span>" : ""}</div>

                    ${canKick ? `<button class="action-btn" style="padding:6px 10px; width:auto;" onclick="kickCoupPlayer('${player.socketId}')">Kick</button>` : ""}
                </div>
            `;
        }).join('');
        const enoughPlayers = (coupLobby.players || []).length >= 2;
        const iAmHost = socket.id === coupLobby.hostId;
        const statusLabel = iAmHost
            ? (enoughPlayers ? "Start Game" : "Waiting for Players")
            : (enoughPlayers ? "Waiting for Host" : "Waiting for Players");

        content.innerHTML = `
            <h2 style="color:#779556; margin-top:0;">Coup Lobby</h2>
            <div style="background:#1a1a1a; padding:12px; border-radius:8px; margin-bottom:12px; text-align:left;">
                <div style="font-size:12px; color:#bababa;">ROOM PASSWORD</div>
                <div style="font-size:20px; letter-spacing:2px;">${coupLobby.password}</div>
            </div>
            <div style="text-align:left; margin-bottom:10px;"><b>Players</b></div>
            <div style="max-height:220px; overflow-y:auto; text-align:left;">${playersHtml || "<div>No players yet.</div>"}</div>
            <button class="start-btn" style="margin-top:10px;" ${iAmHost && enoughPlayers ? 'onclick="startCoupGame()"' : "disabled"}>${statusLabel}</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="changeCoupName()">Change Name</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="leaveCoupLobby()">Leave Lobby</button>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="returnToCoupTitlePage()">Return to Coup Title Page</button>
        `;
    }
}

function applyAtomicExplosion(board, r, c) {
    const splash = [];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
            const piece = board[rr][cc];
            if (!piece) continue;
            const isPawn = piece === '♙' || piece === '♟';
            if (isPawn && !(rr === r && cc === c)) continue;
            splash.push([rr, cc]);
        }
    }
    splash.forEach(([rr, cc]) => { board[rr][cc] = ''; });
}

function getPieceTextureClass(piece) {
    const map = {
        '♔': 'white-king', '♕': 'white-queen', '♖': 'white-rook', '♗': 'white-bishop', '♘': 'white-knight', '♙': 'white-pawn',
        '♚': 'black-king', '♛': 'black-queen', '♜': 'black-rook', '♝': 'black-bishop', '♞': 'black-knight', '♟': 'black-pawn'
    };
    return map[piece] || '';
}

function setSetupView(view) {
    setupView = view;
    if (view.startsWith("chess-")) selectedGame = "chess";
    if (view.startsWith("atomic-")) selectedGame = "atomic";
    if (view.startsWith("coup-")) selectedGame = "coup";
    renderSetupCard();
}


function getBuiltInLondonPgn() {
    return `1. d4 d5 (1... Nf6 2. Bf4 c5 (2... e6 3. e3 c5 4. c3 b6 5. Nf3 cxd4 (5... Bb7 6. h3 Be7 7. Nbd2 O-O 8. Bd3 d6 9. O-O Nbd7 10. Bh2 a6 11. a4 Qc7 12. Re1 Rfe8 13. e4 cxd4 14. cxd4 e5 15. Rc1 Qb8 16. Bc4 exd4 17. Bxf7+ Kxf7 18. Qb3+ Kf8 19. Ng5) 6. Nxd4 Nd5 (6... a6 7. Qf3 d5 (7... Nd5 8. c4 Nc7 9. Nc3 d6 10. O-O-O) 8. Bxb8 Rxb8 9. Nc6) 7. Bg3 a6 8. Qf3 d6 9. c4 Nc7 10. Nc3) (2... g6 3. e3 Bg7 4. h3 O-O 5. Nf3 d5 (5... d6 6. c3 c5 (6... Nfd7 7. Bh2 e5 8. Be2 Nc6 9. a4 f5 10. a5 a6 11. d5 Ne7 12. c4 e4 13. Nd4 Ne5 14. Nc3 g5 15. O-O N7g6 16. b4 Qe7 17. c5 Kh8 18. Rc1) 7. dxc5 dxc5 8. Qxd8 Rxd8 9. Nbd2 Nc6 10. Bc7 Rd7 11. Bh2 b6 12. Bb5 Bb7 13. Nc4 Rad8 14. a4 Ne4 15. O-O Rd5 16. Bc7 R8d7 17. Bxb6 axb6 18. Nxb6 Rd8 19. Nxd5 Rxd5 20. a5) 6. c3 c5 7. Nbd2 Nc6 8. dxc5 Nd7 9. Nb3 e5 10. Bg3 Ne7 11. Be2 Qc7 12. O-O a5 13. a4 Rd8 14. Rc1 b6 15. c4 Nxc5 16. Nxc5 bxc5 17. cxd5) 3. e3 Nd5 4. Bg3 Qb6 5. c4 Qxb2 6. cxd5 Qxa1 7. Qc2 Na6 8. Bxa6 bxa6 9. Nf3 d6 10. Bxd6 exd6 11. O-O Rb8 12. Nbd2 Qb2 13. Qe4+ Be7 14. Rb1 Qxb1+ 15. Nxb1 O-O 16. dxc5 dxc5 17. Nbd2) 2. Bf4 c5 (2... e6 3. e3 Nf6 4. Nd2 Bd6 (4... c5 5. c3 Nc6 6. Ngf3 Bd6 7. Bg3 O-O 8. Bd3 Qe7 (8... b6 9. e4 dxe4 10. Nxe4 Nxe4 11. Bxe4 Bb7 12. dxc5 Bxc5 13. Qa4 Rc8 14. Rd1 Qe7 15. O-O) 9. Ne5 Nd7 10. Nxd7 Bxd7 11. Bxd6 Qxd6 12. dxc5 Qxc5 13. Bxh7+ Kxh7 14. Qh5+ Kg8 15. Ne4 Qc4 16. Ng5 Rfd8 17. Qxf7+ Kh8 18. Qh5+ Kg8 19. Rd1) 5. Ngf3 O-O 6. Bd3 b6 7. Qe2 Bb7 8. O-O c5 9. c3 Ne4 10. Rfd1 Qe7 11. dxc5 Nxc5 12. Bxh7+ Kxh7 13. Ng5+ Kg6 14. Qg4 f5 15. Qg3 e5 16. Ndf3 exf4 17. exf4) (2... Nf6 3. e3 e6 4. Nd2 Bd6 5. Ngf3 c5 6. c3 Qc7 7. Bxd6 Qxd6 8. Ne5 Nc6 9. f4 O-O 10. Bd3 b6 11. O-O Bb7 12. g4 Ne7 13. Qf3) (2... Bf5 3. c4 e6 4. Nc3 c6 5. Qb3 Qb6 6. c5 Qxb3 7. axb3 Nd7 8. b4 a6 9. Nf3 Rc8 10. Nd2) 3. e3 Qb6 (3... Nf6 4. c3 Nc6 5. Nd2 Bf5 6. Qb3 Qb6 7. dxc5 Qxb3 8. axb3 e5 9. Bg3 Bxc5 10. Ngf3 Nd7 11. b4 Bd6 12. Nd4 Bg6 13. Nxc6 bxc6 14. f3) (3... Nc6 4. c3 Nf6 5. Nd2 cxd4 (5... e6 6. Ngf3 cxd4 7. exd4 Nh5 8. Be3 Bd6 9. g3 O-O 10. Bd3 f5 11. Ne5 Nf6 12. Ndf3 Ne4 13. Bf4 Qc7 14. O-O Bd7 15. Qc1 Be8 16. Nxc6 Bxf4 17. Ne7+) 6. exd4 Bf5 7. Qb3 Qd7 8. Ngf3 e6 9. Ne5 Qc8 10. Bd3 Nxe5 11. Bxf5 Ng6 12. Bxg6 hxg6 13. h3 Be7 14. O-O O-O 15. Nf3 Nd7 16. h4 Qc6 17. g3 Bd6 18. Bxd6 Qxd6 19. Kg2 Rab8 20. Rh1 Nf6 21. Ne5) 4. Nc3 Nf6 5. Nb5 Na6 6. c3 e6 7. a4 Bd7 8. Nf3 Be7 9. a5 Qd8 10. Nd6+ Bxd6 11. Bxd6 Ne4 12. Bf4 *`;
}

function tokenizePgnMoves(pgn) {
    return (pgn || '')
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\r?\n/g, ' ')
        .replace(/\d+\.\.\./g, ' ')
        .replace(/\d+\./g, ' ')
        .replace(/\$/g, ' $')
        .match(/\(|\)|[^\s()]+/g) || [];
}

function extractPracticeLinesFromPgn(pgn) {
    const tokens = tokenizePgnMoves(pgn).filter((t) => !/^\$\d+/.test(t) && !['*', '1-0', '0-1', '1/2-1/2'].includes(t));

    function parseFrom(i, prefix) {
        let current = [...prefix];
        let lines = [];

        while (i < tokens.length) {
            const tok = tokens[i];
            if (tok === ')') {
                return { index: i + 1, lines: lines.length ? lines : [current] };
            }
            if (tok === '(') {
                const branch = parseFrom(i + 1, current);
                lines.push(...branch.lines);
                i = branch.index;
                continue;
            }
            current.push(tok);
            i += 1;
        }

        lines.push(current);
        return { index: i, lines };
    }

    const parsed = parseFrom(0, []);
    const uniq = new Map();
    parsed.lines.forEach((line) => {
        if (!line || line.length < 2) return;
        const key = line.join(' ');
        if (!uniq.has(key)) uniq.set(key, line);
    });
    const values = [...uniq.values()];
    return values.sort((a, b) => b.length - a.length);
}

function normalizeSan(s) {
    return (s || '').replace(/[+#?!]/g, '').trim();
}

function parseSanHints(sanRaw) {
    const san = normalizeSan(sanRaw);
    if (san === 'O-O' || san === '0-0') return { castle: 'short' };
    if (san === 'O-O-O' || san === '0-0-0') return { castle: 'long' };

    let txt = san;
    let promotion = null;
    const promoIdx = txt.indexOf('=');
    if (promoIdx !== -1) {
        promotion = txt.slice(promoIdx + 1, promoIdx + 2).toUpperCase();
        txt = txt.slice(0, promoIdx);
    }

    const pieceMatch = txt.match(/^[KQRBN]/);
    const piece = pieceMatch ? pieceMatch[0] : 'P';
    if (pieceMatch) txt = txt.slice(1);

    txt = txt.replace('x', '');
    const target = txt.slice(-2);
    const prefix = txt.slice(0, -2);
    const fromFile = /[a-h]/.test(prefix) ? prefix.match(/[a-h]/)[0] : null;
    const fromRank = /[1-8]/.test(prefix) ? prefix.match(/[1-8]/)[0] : null;

    return { piece, target, fromFile, fromRank, promotion };
}

function pieceToLetter(piece) {
    const map = { '♔':'K','♕':'Q','♖':'R','♗':'B','♘':'N','♙':'P','♚':'K','♛':'Q','♜':'R','♝':'B','♞':'N','♟':'P' };
    return map[piece] || null;
}

function moveToUci(move) {
    const files = 'abcdefgh';
    return `${files[move.from.c]}${8 - move.from.r}${files[move.to.c]}${8 - move.to.r}`;
}

function findMoveBySan(team, san) {
    const hints = parseSanHints(san);
    const legal = getLegalMoves(team);
    if (hints.castle) {
        return legal.find((m) => {
            const piece = boardState[m.from.r][m.from.c];
            if (!piece || pieceToLetter(piece) !== 'K') return false;
            const diff = m.to.c - m.from.c;
            return hints.castle === 'short' ? diff === 2 : diff === -2;
        }) || null;
    }

    const files = 'abcdefgh';
    const toFile = hints.target ? files.indexOf(hints.target[0]) : -1;
    const toRank = hints.target ? Number(hints.target[1]) : NaN;
    return legal.find((m) => {
        const piece = boardState[m.from.r][m.from.c];
        if (!piece) return false;
        if (pieceToLetter(piece) !== hints.piece) return false;
        if (toFile !== -1 && m.to.c !== toFile) return false;
        if (!Number.isNaN(toRank) && (8 - m.to.r) !== toRank) return false;
        if (hints.fromFile && files[m.from.c] !== hints.fromFile) return false;
        if (hints.fromRank && String(8 - m.from.r) !== hints.fromRank) return false;
        if (hints.promotion) {
            const u = moveToUci(m);
            if (!u.endsWith(hints.promotion.toLowerCase())) return false;
        }
        return true;
    }) || null;
}

async function startOpeningPractice() {
    const color = document.getElementById('openingColor')?.value || 'white';
    const file = document.getElementById('openingPgnFile')?.files?.[0];
    let pgn = getBuiltInLondonPgn();
    if (file) pgn = await file.text();
    const lines = extractPracticeLinesFromPgn(pgn);
    if (!lines.length) return alert('Could not parse any opening lines from PGN.');
    openingRepertoireLines = lines;
    openingCurrentLine = lines[Math.floor(Math.random() * lines.length)];
    openingIndex = 0;
    openingPlayerColor = color;
    isOpeningPractice = true;
    isBotGame = false;
    isSpectator = false;
    myColor = color;
    currentVariant = 'standard';
    gameSettings = { mins: 0, secs: 0, inc: 0, variant: 'standard' };
    whiteName = color === 'white' ? 'You' : 'Repertoire';
    blackName = color === 'black' ? 'You' : 'Repertoire';
    const overlay = document.getElementById('setup-overlay'); if (overlay) overlay.remove();
    initGameState();
    runOpeningPracticeTurn();
}

function runOpeningPracticeTurn() {
    if (!isOpeningPractice || isGameOver) return;
    while (openingIndex < openingCurrentLine.length && currentTurn !== openingPlayerColor) {
        const san = openingCurrentLine[openingIndex];
        const mv = findMoveBySan(currentTurn, san);
        if (!mv) break;
        openingIndex++;
        handleActualMove(mv.from, mv.to, false, null);
        if (isGameOver) return;
    }
    if (openingIndex >= openingCurrentLine.length) {
        appendChatMessage('System', 'Line complete! Loading another variation...', true);
        openingCurrentLine = openingRepertoireLines[Math.floor(Math.random() * openingRepertoireLines.length)];
        openingIndex = 0;
        initGameState();
        runOpeningPracticeTurn();
    }
}

function handleOpeningPracticePlayerMove(from, to, promotionChoice) {
    if (!isOpeningPractice) return handleActualMove(from, to, true, promotionChoice);
    const expected = openingCurrentLine[openingIndex];
    const expectedMove = findMoveBySan(currentTurn, expected);
    if (!expectedMove) return;
    if (from.r !== expectedMove.from.r || from.c !== expectedMove.from.c || to.r !== expectedMove.to.r || to.c !== expectedMove.to.c) {
        appendChatMessage('System', `Mistake. Correct move: ${expected}`, true);
        lastMoveHighlight = { from: expectedMove.from, to: expectedMove.to };
        render();
        return;
    }
    openingIndex++;
    handleActualMove(from, to, true, promotionChoice);
    setTimeout(runOpeningPracticeTurn, 100);
}


function createRoom(variant = "standard") {
    currentPassword = document.getElementById('roomPass').value; tempName = document.getElementById('uName').value;
    if (!currentPassword) return alert("Enter password.");
    try { localStorage.setItem("chessSession", JSON.stringify({ password: currentPassword, name: tempName })); } catch (_) {}
    socket.emit("create-room", { password: currentPassword, name: tempName, mins: document.getElementById('tMin').value, secs: document.getElementById('tSec').value, inc: document.getElementById('tInc').value, colorPref: document.getElementById('colorPref').value, variant });
}

function startBotGameSetup(variant = "standard") {
    pendingBotVariant = variant === "atomic" ? "atomic" : "standard";
    setSetupView(pendingBotVariant === "atomic" ? "atomic-bot-setup" : "chess-bot-setup");
}

function startBotGameFromSetup() {
    const eloRaw = parseInt(document.getElementById('botEloInput')?.value || "1000", 10);
    const colorSel = (document.getElementById('botColorSelect')?.value || "random").toLowerCase();
    botElo = Number.isNaN(eloRaw) ? 1000 : Math.max(400, Math.min(3000, eloRaw));
    botPlayAsChoice = ["white", "black", "random"].includes(colorSel) ? colorSel : "random";
    const playAs = botPlayAsChoice === "random" ? (Math.random() < 0.5 ? "white" : "black") : botPlayAsChoice;
    isBotGame = true;
    botColor = playAs === "white" ? "black" : "white";
    myColor = playAs;
    isSpectator = false;
    currentVariant = pendingBotVariant === "atomic" ? "atomic" : "standard";
    gameSettings = currentVariant === "atomic" ? { mins: 0, secs: 0, inc: 0, variant: "atomic" } : { mins: 0, secs: 0, inc: 0, variant: "standard" };
    const botLabel = currentVariant === "atomic" ? `Fairy Bot (${botElo})` : `Bot (${botElo})`;
    whiteName = playAs === "white" ? "You" : botLabel;
    blackName = playAs === "black" ? "You" : botLabel;
    const overlay = document.getElementById('setup-overlay');
    if (overlay) overlay.remove();
    initGameState();
}

function joinRoom() {
    currentPassword = document.getElementById('joinPass').value; tempName = document.getElementById('joinName').value;
    if (!currentPassword) return alert("Enter password.");
    try { localStorage.setItem("chessSession", JSON.stringify({ password: currentPassword, name: tempName })); } catch (_) {}
    socket.emit("join-attempt", { password: currentPassword });
}

function confirmJoin() { socket.emit("confirm-join", { password: currentPassword, name: tempName }); }

function createCoupRoom() {
    const password = document.getElementById('coupCreatePass').value.trim();
    const name = document.getElementById('coupCreateName').value.trim();
    if (!password || !name) return alert("Enter room password and username.");
    currentPassword = password;
    socket.emit("coup-create-room", { password, name });
}

function joinCoupRoom() {
    const password = document.getElementById('coupJoinPass').value.trim();
    const name = document.getElementById('coupJoinName').value.trim();
    if (!password || !name) return alert("Enter room password and username.");
    currentPassword = password;
    socket.emit("coup-join-room", { password, name });
}

function changeCoupName() {
    if (!coupLobby || !currentPassword) return;
    const nextName = prompt("Enter your new name:");
    if (!nextName || !nextName.trim()) return;
    socket.emit("coup-change-name", { password: currentPassword, name: nextName.trim() });
}

function kickCoupPlayer(targetSocketId) {
    if (!coupLobby || !currentPassword) return;
    socket.emit("coup-kick-player", { password: currentPassword, targetSocketId });
}

function startCoupGame() {
    if (!coupLobby || !currentPassword) return;
    socket.emit("coup-start-game", { password: currentPassword });
}

function leaveCoupLobby() {
    if (currentPassword) {
        socket.emit("coup-leave-room", { password: currentPassword });
    }
    selectedGame = "coup";
    setupView = "coup-menu";
    coupLobby = null;
    currentPassword = null;
    renderSetupCard();
}

function returnToCoupTitlePage() {
    leaveCoupLobby();
}

function renderCoupGame(layout) {
    document.body.classList.add("coup-mode");
    layout.innerHTML = "";
    layout.className = "coup-layout";
    const me = (coupGameState.players || []).find((p) => p.socketId === socket.id);
    const isMyTurn = coupGameState.currentTurnSocketId === socket.id;
    const pending = coupGameState.pending;
    const myCards = coupGameState.myCards || [];
    const isAlive = !!(me && me.alive);
    const aliveCount = (coupGameState.players || []).filter((p) => p.alive).length;
    const phaseText = getCoupPhaseText();

    const main = document.createElement('div');
    main.className = "coup-main-column";

    const topPanel = document.createElement('div');
    topPanel.className = "coup-panel coup-top-panel";
    topPanel.innerHTML = `
        <div class="coup-title-wrap">
            <div class="coup-title">Coup - Standard</div>
            <button class="action-btn coup-rules-btn" onclick="showCoupRulesPopup()">Rules</button>
        </div>
        <div class="coup-top-stats">
            <span>Deck: <b>${coupGameState.deckCount ?? 0}</b></span>
            <span>Alive: <b>${aliveCount}</b></span>
            <span>Status: <b>${phaseText}</b></span>
        </div>
    `;
    main.appendChild(topPanel);

    const playersPanel = document.createElement('div');
    playersPanel.className = "coup-panel";
    const rowsClass = (coupGameState.players || []).length < 4 ? "one-row" : "";
    playersPanel.innerHTML = `
        <div class="coup-players-grid ${rowsClass}">
            ${(coupGameState.players || []).map((player) => renderCoupPlayerPanel(player)).join("")}
        </div>
    `;
    main.appendChild(playersPanel);

    const actionsPanel = document.createElement('div');
    actionsPanel.className = "coup-panel coup-actions-panel";
    const actionDisabled = !isMyTurn || !isAlive || coupGameState.phase !== "turn";
    const targetOptions = (coupGameState.players || [])
        .filter((p) => p.socketId !== socket.id && p.alive)
        .map((p) => `<option value="${p.socketId}">${p.name}</option>`)
        .join("");
    const currentTurnPlayer = (coupGameState.players || []).find((p) => p.socketId === coupGameState.currentTurnSocketId);
    if (!isMyTurn || coupGameState.phase !== "turn") {
        actionsPanel.innerHTML = `
            <div class="coup-waiting-box">
                Waiting for <b>${currentTurnPlayer ? currentTurnPlayer.name : "player"}</b> to take their turn.
            </div>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="location.reload()">Return to Title</button>
        `;
    } else {
        actionsPanel.innerHTML = `
            <div class="coup-section-title">Choose Your Action</div>
            <div class="coup-action-grid">
                ${renderActionCard("income", "+1 coin (safe)", "c-action-income", actionDisabled, false)}
                ${renderActionCard("foreign_aid", "+2 coins (blockable)", "c-action-aid", actionDisabled, false)}
                ${renderActionCard("tax", "+3 coins (challengeable: Duke)", "c-action-tax", actionDisabled, false)}
                ${renderActionCard("exchange", "Swap with deck (challengeable: Ambassador)", "c-action-exchange", actionDisabled, false)}
            </div>
            <div class="coup-section-title" style="margin-top:12px;">Targeted Actions</div>
            <div style="margin-bottom:10px;">
                <select id="coup-target-select" class="coup-target-select">${targetOptions}</select>
            </div>
            <div class="coup-target-grid">
                ${renderActionCard("steal", "Take up to 2 coins (blockable)", "c-action-steal", actionDisabled, true)}
                ${renderActionCard("assassinate", "Pay 3 to remove influence (blockable)", "c-action-assassinate", actionDisabled, true)}
                ${renderActionCard("coup", "Pay 7 to force influence loss (unblockable)", "c-action-coup", actionDisabled, true)}
            </div>
            <button class="action-btn" style="margin-top:10px; width:100%;" onclick="location.reload()">Return to Title</button>
        `;
    }
    main.appendChild(actionsPanel);
    layout.appendChild(main);

    const logPanel = document.createElement('div');
    logPanel.className = "coup-log-column";
    logPanel.innerHTML = `
        <div class="coup-log-header">GAME LOG</div>
        <div class="coup-log-body" id="coup-log-body"></div>
    `;
    layout.appendChild(logPanel);

    const logBox = document.getElementById('coup-log-body');
    (coupGameState.log || []).forEach((entry) => {
        const div = document.createElement('div');
        div.className = 'chat-msg system';
        div.textContent = entry;
        logBox.appendChild(div);
    });
    logBox.scrollTop = logBox.scrollHeight;

    const existingPrompt = document.getElementById('coup-prompt-area');
    if (existingPrompt) existingPrompt.remove();
    const popup = document.createElement('div');
    popup.id = 'coup-prompt-area';
    popup.className = 'coup-bottom-popup';
    document.body.appendChild(popup);

    renderCoupPrompt(pending);
}

function getCoupTarget() {
    const sel = document.getElementById('coup-target-select');
    return sel ? sel.value : null;
}

function sendCoupAction(action, targetSocketId = null) {
    if (!coupGameState || !currentPassword) return;
    const payload = { password: currentPassword, action };
    if (targetSocketId) payload.targetSocketId = targetSocketId;
    socket.emit("coup-action", payload);
}

function sendCoupResponse(response, blockRole = null) {
    if (!coupGameState || !currentPassword) return;
    const payload = { password: currentPassword, response };
    if (blockRole) payload.blockRole = blockRole;
    socket.emit("coup-response", payload);
}

function renderCoupPrompt(pending) {
    const prompt = document.getElementById('coup-prompt-area');
    if (!prompt || !pending || coupGameState.phase !== "resolving") {
        if (prompt) prompt.innerHTML = "";
        return;
    }
    if (pending.kind === "action") {
        const canChallenge = pending.claim && socket.id !== pending.actorId;
        if (socket.id === pending.actorId) {
            prompt.innerHTML = `<div class="draw-modal"><b>Waiting for all players to respond to your action...</b></div>`;
            return;
        }
        const roleClaim = pending.claim ? pending.claim.charAt(0).toUpperCase() + pending.claim.slice(1) : null;
        const allowLabel = pending.targetId === socket.id ? "Pass (Proceed to Block)" : "Allow";
        prompt.innerHTML = `
            <div class="draw-modal">
                <div><b>Challenge Opportunity!</b></div>
                <div style="margin-top:8px;">${pending.actorName} claims to have ${roleClaim || "a required role"}.</div>
                <div style="margin-top:8px;">If you challenge and they don't have ${roleClaim || "it"}, they lose influence.</div>
                <div class="modal-btns">
                    ${canChallenge ? '<button class="decline-btn" onclick="sendCoupResponse(\'challenge\')">Challenge</button>' : ''}
                    <button class="accept-btn" onclick="sendCoupResponse('pass')">${allowLabel}</button>
                </div>
            </div>
        `;
        return;
    }


    if (pending.kind === "block-offer") {
        if (socket.id !== pending.targetId) {
            prompt.innerHTML = `<div class="draw-modal"><b>Waiting for ${pending.targetName} to decide whether to block...</b></div>`;
            return;
        }
        prompt.innerHTML = `
            <div class="draw-modal">
                <div><b>Block Opportunity!</b></div>
                <div style="margin-top:8px;">${pending.actorName} targeted you with <b>${pending.action.replace("_", " ")}</b>.</div>
                <div style="margin-top:8px;">Choose whether to block or allow the action.</div>
                <div class="modal-btns">
                    <button class="decline-btn" onclick="sendCoupResponse('block', '${pending.blockRoles[0]}')">Block</button>
                    <button class="accept-btn" onclick="sendCoupResponse('pass')">Allow</button>
                </div>
            </div>
        `;
        return;
    }
    if (pending.kind === "block") {
        const canChallenge = socket.id !== pending.blockerId;
        prompt.innerHTML = `
            <div class="draw-modal">
                <div><b>${pending.blockerName}</b> blocks with <b>${pending.blockClaim}</b>.</div>
                <div class="modal-btns">
                    <button class="accept-btn" onclick="sendCoupResponse('pass')">Accept Block</button>
                    ${canChallenge ? '<button class="decline-btn" onclick="sendCoupResponse(\'challenge\')">Challenge Block</button>' : ""}
                </div>
            </div>
        `;
    }
}

function getCoupPhaseText() {
    if (!coupGameState) return "Waiting";
    if (coupGameState.phase === "game-over") return "Game Over";
    if (coupGameState.pending?.kind === "action") return "Action / Challenge Window";
    if (coupGameState.pending?.kind === "block-offer") return "Block Opportunity";
    if (coupGameState.pending?.kind === "block") return "Block Window";
    if (coupGameState.phase === "resolving") return "Resolving";
    return "Action";
}

function renderCoupPlayerPanel(player) {
    const me = socket.id === player.socketId;
    const turn = coupGameState.currentTurnSocketId === player.socketId;
    const waitingOnAction = coupGameState.phase === "turn" && turn;
    const waitingOnResponse = coupGameState.phase === "resolving" && coupGameState.pending && player.alive;
    const indicator = waitingOnAction ? "Choosing Action" : (waitingOnResponse ? "Waiting / Respond" : "Idle");
    const myCards = me ? (coupGameState.myCards || []) : [];
    const revealedCards = player.revealedCards || [];
    const hiddenCount = Math.max(0, player.influence);
    const cards = [];

    if (me) {
        myCards.forEach((card) => {
            cards.push(`<div class="coup-card ${card.revealed ? 'revealed' : ''} ${card.revealed ? 'role-' + card.role : 'role-' + card.role}">
                <span>${card.role}</span>
            </div>`);
        });
    } else {
        for (let i = 0; i < hiddenCount; i++) cards.push('<div class="coup-card hidden-card"></div>');
        revealedCards.forEach((role) => cards.push(`<div class="coup-card revealed role-${role}"><span>${role}</span></div>`));
    }

    return `
        <div class="coup-player-panel ${!player.alive ? 'eliminated' : ''}">
            <div class="coup-player-head">
                <div><b>${player.name}</b> ${me ? '<span class="tag-you">YOU</span>' : ''}</div>
                <div class="coins">${player.coins} coins</div>
            </div>
            <div class="coup-indicators">
                ${turn ? '<span class="tag-turn">TURN</span>' : ''}
                ${player.alive ? `<span class="tag-wait">${indicator}</span>` : '<span class="tag-out">OUT</span>'}
            </div>
            <div class="coup-cards-row">${cards.join("")}</div>
        </div>
    `;
}

function renderActionCard(action, desc, cssClass, disabled, targeted) {
    const targetArg = targeted ? ", getCoupTarget()" : "";
    return `
        <button class="coup-action-card ${cssClass} ${targeted ? 'targeted' : ''}" ${disabled ? "disabled" : ""} onclick="sendCoupAction('${action}'${targetArg})">
            <div class="name">${action.replace('_', ' ').toUpperCase()}</div>
            <div class="desc">${desc}</div>
        </button>
    `;
}

function openSpectateMenu() {
    spectateVariantPreference = (selectedGame === 'atomic' || currentVariant === 'atomic') ? 'atomic' : 'standard';
    const content = document.getElementById('setup-card-content');
    if (!content) return;
    content.innerHTML = `
        <h2 style="color: #779556">Active Games</h2>
        <div id="spectate-games-list" style="max-height: 320px; overflow-y: auto; text-align: left;"></div>
        <button class="action-btn" style="margin-top: 10px; width: 100%;" onclick="setSetupView('chess-menu')">Back</button>
    `;
    socket.emit("list-active-games");
    if (spectateListPoll) clearInterval(spectateListPoll);
    spectateListPoll = setInterval(() => {
        if (!document.getElementById('spectate-games-list')) { clearInterval(spectateListPoll); spectateListPoll = null; return; }
        socket.emit('list-active-games');
    }, 2500);
}

function renderSpectateList() {
    const list = document.getElementById('spectate-games-list');
    if (!list) return;
    if (!activeGames.length) {
        list.innerHTML = '<p style="color:#bababa;">No active games right now.</p>';
        return;
    }
    const sorted = [...activeGames].sort((a, b) => {
        const av = (a.settings?.variant || 'standard');
        const bv = (b.settings?.variant || 'standard');
        const ap = av === spectateVariantPreference ? 0 : 1;
        const bp = bv === spectateVariantPreference ? 0 : 1;
        return ap - bp;
    });
    list.innerHTML = sorted.map((game) => {
        const variant = (game.settings?.variant || 'standard').toUpperCase();
        const snap = renderBoardSnapshot(game.boardState);
        return `
        <div style="background:#1a1a1a; padding:12px; border-radius:6px; margin-bottom:10px; display:flex; gap:10px; align-items:flex-start;">
            <div style="flex:1;">
                <strong>${game.whiteName} vs ${game.blackName}</strong><br>
                <small style="color:#bababa;">${variant} • ${game.settings.mins}m ${game.settings.secs}s +${game.settings.inc}</small><br>
                <small style="color:#9e9e9e;">Room: ${game.password}</small>
                <div style="margin-top:8px; display:flex; gap:8px;">
                    <button class="start-btn" onclick="spectateRoom('${game.password}', false)">Spectate</button>
                    <button class="action-btn" onclick="spectateRoom('${game.password}', true)">Silent Spectate</button>
                </div>
            </div>
            <div>${snap}</div>
        </div>`;
    }).join('');
}

function renderBoardSnapshot(board) {
    if (!board || !Array.isArray(board) || !board.length) return '<div style="font-size:11px;color:#888;">No snapshot yet</div>';
    const map={'♔':'K','♕':'Q','♖':'R','♗':'B','♘':'N','♙':'P','♚':'k','♛':'q','♜':'r','♝':'b','♞':'n','♟':'p'};
    let html='<div style="display:grid;grid-template-columns:repeat(8,10px);border:1px solid #555;">';
    for(let r=0;r<8;r++){for(let c=0;c<8;c++){const p=board[r][c]||'';const light=(r+c)%2===0;html+=`<div style="width:10px;height:10px;font-size:8px;line-height:10px;text-align:center;background:${light?'#f0d9b5':'#b58863'};color:${p&&p===p.toLowerCase()?'#111':'#fff'};">${map[p]||''}</div>`;}}
    html+='</div>';
    return html;
}

function spectateRoom(password, silent = false) {
    const chosen = prompt("Enter your spectator username:", "Spectator");
    if (!chosen || !chosen.trim()) return;
    spectatorName = chosen.trim();
    socket.emit("spectate-game", { password, name: spectatorName, silent });
}

function resignGame() {
    if (isGameOver) return;
    const winner = myColor === 'white' ? 'black' : 'white';
    socket.emit("resign", { password: currentPassword, winner: winner });
    isGameOver = true; if (window.chessIntervalInstance) clearInterval(window.chessIntervalInstance);
    showResultModal(`${winner.toUpperCase()} WINS BY RESIGNATION`); render();
}

function offerDraw() { if (!isGameOver) { socket.emit("offer-draw", { password: currentPassword }); showStatusMessage("Draw offer sent..."); } }

function flipBoard() {
    if (!isSpectator) return;
    boardPerspective = boardPerspective === 'white' ? 'black' : 'white';
    render();
    if (isBotGame && !isGameOver && currentTurn === botColor) {
        setTimeout(makeBotMove, 350);
    }
}

function returnToLobby() {
    location.reload();
}

function showDrawOffer() {
    const area = document.getElementById('notification-area');
    area.innerHTML = `<div class="draw-modal">Opponent offers draw<div class="modal-btns"><button class="accept-btn" onclick="respondToDraw(true)">Accept</button><button class="decline-btn" onclick="respondToDraw(false)">Decline</button></div></div>`;
}

function respondToDraw(accepted) { socket.emit("draw-response", { password: currentPassword, accepted: accepted }); document.getElementById('notification-area').innerHTML = ''; }

function showStatusMessage(msg) {
    const area = document.getElementById('notification-area');
    area.innerHTML = `<div style="background:#4b4845; padding:10px; border-radius:4px; font-size:12px; text-align:center;">${msg}</div>`;
    setTimeout(() => { area.innerHTML = ''; }, 3000);
}

function choosePromotionPiece(team) {
    return new Promise((resolve) => {
        const existing = document.getElementById('promotion-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'promotion-overlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.8)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '2600';

        const pieces = team === 'white'
            ? [{ icon: '♕', name: 'Queen' }, { icon: '♖', name: 'Rook' }, { icon: '♗', name: 'Bishop' }, { icon: '♘', name: 'Knight' }]
            : [{ icon: '♛', name: 'Queen' }, { icon: '♜', name: 'Rook' }, { icon: '♝', name: 'Bishop' }, { icon: '♞', name: 'Knight' }];

        overlay.innerHTML = `
            <div class="result-card" style="width:360px;">
                <h2>Choose Promotion</h2>
                <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px; margin-top:15px;">
                    ${pieces.map(p => `<button class="action-btn promotion-choice" data-piece="${p.icon}" style="padding:14px; font-size:16px;">${p.icon} ${p.name}</button>`).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.querySelectorAll('.promotion-choice').forEach((btn) => {
            btn.addEventListener('click', () => {
                const chosen = btn.getAttribute('data-piece');
                overlay.remove();
                resolve(chosen);
            });
        });
    });
}

function showRulesPopup() {
    if (document.getElementById('rules-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'rules-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0, 0, 0, 0.85)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '2500';
    const atomic = selectedGame === "atomic" || currentVariant === "atomic";
    overlay.innerHTML = `
        <div class="result-card" style="max-width:420px; width:90%; text-align:left;">
            <h2 style="text-align:center;">${atomic ? "Atomic Chess Rules" : "Game Rules"}</h2>
            ${atomic ? `
            <ul style="padding-left:18px; line-height:1.5; color:#ddd; font-size:14px;">
                <li>Every capture causes an explosion on the destination square and adjacent squares.</li>
                <li>Pawns are immune to splash unless they are the capturing/captured piece.</li>
                <li>Kings cannot capture in Atomic Chess.</li>
                <li>You win by exploding the opponent king; if both kings explode, it's a draw.</li>
                <li>If your move explodes the opponent king, that winning move is legal even when you are currently in check.</li>
                <li>Standard movement, castling, and en passant rules apply otherwise.</li>
            </ul>` : `
            <ul style="padding-left:18px; line-height:1.5; color:#ddd; font-size:14px;">
                <li>Standard chess movement rules apply to all pieces.</li>
                <li>Win by checkmate, resignation, or opponent running out of time.</li>
                <li>Draws can happen by agreement or stalemate.</li>
                <li>Each move may add increment seconds if set in game settings.</li>
                <li>Use chat for communication during games.</li>
                <li>For further detail/clarification, go to wikipedia.org/wiki/Rules_of_chess.</li>
            </ul>`}
            <button class="action-btn" style="width:100%; margin-top:10px;" onclick="closeRulesPopup()">Close</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

function showCoupRulesPopup() {
    if (document.getElementById('rules-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'rules-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0, 0, 0, 0.85)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '2500';

    overlay.innerHTML = `
        <div class="result-card" style="max-width:420px; width:90%; text-align:left;">
            <h2 style="text-align:center;">Coup Rules</h2>␊
            <ul style="padding-left:18px; line-height:1.5; color:#ddd; font-size:14px;">␊
                <li>Standard mode roles: Duke, Assassin, Captain, Ambassador, Contessa.</li>
                <li>Players begin with 2 coins and 2 influence cards; lose both and you are eliminated.</li>
                <li>If you have 10+ coins at the start of your turn, you must Coup.</li>
            </ul>␊
            <button class="action-btn" style="width:100%; margin-top:10px;" onclick="closeRulesPopup()">Close</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

function closeRulesPopup() {
    const overlay = document.getElementById('rules-overlay');
    if (overlay) overlay.remove();
}

function showResultModal(text) {
    const overlay = document.createElement('div'); overlay.id = 'game-over-overlay';
    const spectatorButtons = `
        <div class="modal-btns-vertical">
            <button class="action-btn" onclick="closeModal()">View Board</button>
            <button class="action-btn" style="background:#444" onclick="returnToLobby()">Return to Lobby</button>
        </div>
    `;
    const playerButtons = `
        <div class="modal-btns-vertical">
            <button id="rematch-btn" onclick="requestRematch()">Request Rematch</button>
            <button class="action-btn" onclick="closeModal()">View Board</button>
            <button class="action-btn" style="background:#444" onclick="location.reload()">New Game</button>
        </div>
    `;
    overlay.innerHTML = `
        <div class="result-card">
            <h2>Game Over</h2><p>${text}</p>
            ${isSpectator ? spectatorButtons : playerButtons}
        </div>
    `;
    document.body.appendChild(overlay);
}

function requestRematch() {
    if (isBotGame) {
        const overlay = document.getElementById('game-over-overlay');
        if (overlay) overlay.remove();
        initGameState();
        return;
    }
    const btn = document.getElementById('rematch-btn');
    if (rematchRequested) {
        rematchRequested = false;
        btn.innerText = "Request Rematch";
        btn.classList.remove('cancel-state');
    } else {
        rematchRequested = true;
        btn.innerText = "Cancel Rematch";
        btn.classList.add('cancel-state');
    }
    socket.emit("rematch-request", { password: currentPassword });
}

function closeModal() {
    document.getElementById('game-over-overlay').style.display = 'none';
    if (!document.getElementById('reopen-results-btn')) {
        const btn = document.createElement('button'); btn.id = 'reopen-results-btn'; btn.className = 'action-btn'; btn.style.marginTop = '10px';
        btn.textContent = 'Show Result'; btn.onclick = () => { document.getElementById('game-over-overlay').style.display = 'flex'; };
        document.getElementById('side-panel').appendChild(btn);
    }
}

window.onload = () => {
    setupView = "game-select";
    showSetup();
};
