const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require("socket.io")(http, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const rooms = {};
const roomRematchStates = {};
const coupRooms = {};

function getCoupSocketRoom(password) {
    return `coup:${password}`;
}

function emitCoupLobbyUpdate(password) {
    const room = coupRooms[password];
    if (!room) return;
    io.in(getCoupSocketRoom(password)).emit("coup-lobby-update", {
        password: room.password,
        hostId: room.hostId,
        players: room.players.map((player) => ({ socketId: player.socketId, name: player.name }))
    });
}

function removePlayerFromCoupRoom(password, socketId) {
    const room = coupRooms[password];
    if (!room) return;

    const index = room.players.findIndex((player) => player.socketId === socketId);
    if (index === -1) return;

    room.players.splice(index, 1);
    if (!room.players.length) {
        delete coupRooms[password];
        return;
    }

    if (room.hostId === socketId) {
        room.hostId = room.players[0].socketId;
    }

    emitCoupLobbyUpdate(password);
}

function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

function createCoupDeck() {
    const roles = ["duke", "assassin", "captain", "ambassador", "contessa"];
    return shuffle(roles.flatMap((role) => [role, role, role]));
}

function getAliveCoupPlayers(room) {
    return room.game.players.filter((p) => p.alive);
}

function getCoupPublicPlayers(room) {
    return room.game.players.map((player) => {
        const revealedCards = player.cards
            .map((card, idx) => (player.revealed[idx] ? card : null))
            .filter(Boolean);
        return {
            socketId: player.socketId,
            name: player.name,
            coins: player.coins,
            alive: player.alive,
            influence: player.revealed.filter((x) => !x).length,
            revealedCards
        };
    });
}

function emitCoupGameState(password) {
    const room = coupRooms[password];
    if (!room || !room.game) return;
    const game = room.game;
    const publicPlayers = getCoupPublicPlayers(room);
    game.players.forEach((player) => {
        io.to(player.socketId).emit("coup-game-state", {
            password,
            hostId: room.hostId,
            players: publicPlayers,
            deckCount: game.deck.length,
            currentTurnSocketId: game.players[game.turnIndex]?.socketId || null,
            phase: game.phase,
            pending: game.pending,
            myCards: player.cards.map((card, idx) => ({ role: card, revealed: player.revealed[idx] })),
            log: game.log.slice(-30)
        });
    });
}

function appendCoupLog(room, message) {
    room.game.log.push(message);
}

function getNextAliveTurnIndex(room, fromIndex) {
    const players = room.game.players;
    if (!players.length) return 0;
    let idx = fromIndex;
    for (let i = 0; i < players.length; i++) {
        idx = (idx + 1) % players.length;
        if (players[idx].alive) return idx;
    }
    return fromIndex;
}

function loseOneInfluence(room, socketId, reason) {
    const player = room.game.players.find((p) => p.socketId === socketId);
    if (!player || !player.alive) return;
    const cardIndex = player.revealed.findIndex((r) => !r);
    if (cardIndex === -1) return;
    player.revealed[cardIndex] = true;
    appendCoupLog(room, `${player.name} loses influence (${player.cards[cardIndex]})${reason ? ` - ${reason}` : ""}.`);
    if (player.revealed.every(Boolean)) {
        player.alive = false;
        appendCoupLog(room, `${player.name} has been eliminated.`);
    }
}

function checkCoupWinner(room) {
    const alive = getAliveCoupPlayers(room);
    if (alive.length !== 1) return null;
    room.game.phase = "game-over";
    const winner = alive[0];
    appendCoupLog(room, `${winner.name} wins the game!`);
    return winner;
}

function getNextSpectatorId(room) {
    const used = new Set(Object.values(room.spectators).map((s) => s.id));
    let id = 1;
    while (used.has(id)) id++;
    return id;
}

function buildSpectatorList(room) {
    return Object.values(room.spectators)
        .sort((a, b) => a.id - b.id)
        .map((s) => {
            const mute = getMuteState(room, { type: "spectator", id: s.id });
            return { id: s.id, name: s.name, isAdmin: s.isAdmin, muted: mute.muted, fullMuted: mute.fullMuted };
        });
}

function emitSpectatorList(roomPass) {
    const room = rooms[roomPass];
    if (!room) return;
    io.in(roomPass).emit("spectator-list-updated", { spectators: buildSpectatorList(room) });
}


function ensureRoomMutes(room) {
    if (!room.mutes) room.mutes = { white: { muted: false, fullMuted: false }, black: { muted: false, fullMuted: false }, spectators: {} };
    if (!room.mutes.white) room.mutes.white = { muted: false, fullMuted: false };
    if (!room.mutes.black) room.mutes.black = { muted: false, fullMuted: false };
    if (!room.mutes.spectators) room.mutes.spectators = {};
    return room.mutes;
}

function getParticipantKey(room, socketId) {
    if (room.players.white === socketId) return { type: "player", color: "white", key: "white" };
    if (room.players.black === socketId) return { type: "player", color: "black", key: "black" };
    const spectator = room.spectators[socketId];
    if (spectator) return { type: "spectator", id: spectator.id, key: `spectator:${spectator.id}` };
    return null;
}

function getMuteState(room, participant) {
    const mutes = ensureRoomMutes(room);
    if (!participant) return { muted: false, fullMuted: false };
    if (participant.type === "player") return mutes[participant.color] || { muted: false, fullMuted: false };
    return mutes.spectators[participant.id] || { muted: false, fullMuted: false };
}

function setMuteState(room, target, mode, value) {
    const mutes = ensureRoomMutes(room);
    const state = target.type === "player"
        ? mutes[target.color]
        : (mutes.spectators[target.id] ||= { muted: false, fullMuted: false });
    if (mode === "fullmute") state.fullMuted = value;
    else state.muted = value;
    return state;
}

function resolveMuteTarget(room, data) {
    if (data.targetType === "player" && (data.targetColor === "white" || data.targetColor === "black")) {
        return { type: "player", color: data.targetColor, socketId: room.players[data.targetColor], label: data.targetColor.toUpperCase() };
    }
    if (data.targetType === "spectator") {
        const spectatorEntry = Object.entries(room.spectators).find(([, s]) => s.id === data.spectatorId);
        if (!spectatorEntry) return null;
        return { type: "spectator", id: data.spectatorId, socketId: spectatorEntry[0], label: `Spectator ${data.spectatorId}` };
    }
    return null;
}

function isSocketAdmin(room, socketId) {
    if (room.players.white === socketId) return !!room.players.whiteAdmin;
    if (room.players.black === socketId) return !!room.players.blackAdmin;
    return !!room.spectators[socketId]?.isAdmin;
}

function isSocketFullMuted(room, socketId) {
    return !!getMuteState(room, getParticipantKey(room, socketId)).fullMuted;
}

function canRunAdminCommand(socket, password) {
    const room = rooms[password];
    if (!room) return null;
    if (!isSocketAdmin(room, socket.id)) {
        socket.emit("admin-command-denied", { message: "Command denied: you are not an admin." });
        return null;
    }
    if (isSocketFullMuted(room, socket.id)) {
        socket.emit("admin-command-denied", { message: "Command denied: you are full-muted." });
        return null;
    }
    return room;
}

function sendMuteState(room, socketId) {
    const participant = getParticipantKey(room, socketId);
    const state = getMuteState(room, participant);
    io.to(socketId).emit("mute-state", state);
}

function buildActiveGames() {
    return Object.entries(rooms)
        .filter(([, room]) => room.status === "active" && room.players.white && room.players.black)
        .map(([password, room]) => ({
            password,
            whiteName: room.players.whiteName || "White",
            blackName: room.players.blackName || "Black",
            settings: room.settings,
            boardState: room.lastSpectatorState?.boardState || null,
            isBotGame: !!room.isBotGame
        }));
}

io.on("connection", (socket) => {
    socket.on("create-room", (data) => {
        const { password, name, mins, secs, inc, colorPref, variant } = data;
        if (rooms[password]) {
            socket.emit("error-msg", "Room password already in use.");
            return;
        }
        socket.join(password);
        rooms[password] = {
            creatorId: socket.id,
            creatorName: name,
            settings: { mins, secs, inc, colorPref, variant: variant === "atomic" ? "atomic" : "standard" },
            status: "waiting",
            players: { white: null, black: null, whiteName: null, blackName: null, whiteAdmin: false, blackAdmin: false },
            spectators: {},
            mutes: { white: { muted: false, fullMuted: false }, black: { muted: false, fullMuted: false }, spectators: {} },
            reconnectDeadline: null
        };
        socket.emit("room-created", { password });
    });

    socket.on("register-bot-game", (data) => {
        const { password, humanColor, whiteName, blackName, settings, state } = data || {};
        if (!password || (humanColor !== "white" && humanColor !== "black")) return;
        socket.join(password);
        rooms[password] = {
            creatorId: socket.id,
            creatorName: humanColor === "white" ? whiteName : blackName,
            settings: settings || { mins: 0, secs: 0, inc: 0, variant: "standard" },
            status: "active",
            players: {
                white: humanColor === "white" ? socket.id : `bot:${password}:white`,
                black: humanColor === "black" ? socket.id : `bot:${password}:black`,
                whiteName: whiteName || "White",
                blackName: blackName || "Black",
                whiteAdmin: false,
                blackAdmin: false
            },
            spectators: {},
            mutes: { white: { muted: false, fullMuted: false }, black: { muted: false, fullMuted: false }, spectators: {} },
            reconnectDeadline: null,
            isBotGame: true,
            botOwnerId: socket.id,
            lastSpectatorState: state || null
        };
    });

    socket.on("join-attempt", (data) => {
        const { password } = data;
        const room = rooms[password];
        if (!room) {
            socket.emit("error-msg", "Room not found.");
            return;
        }
        if (room.status !== "waiting") {
            socket.emit("error-msg", "Room is already in progress.");
            return;
        }
        socket.emit("preview-settings", {
            creatorName: room.creatorName,
            settings: room.settings,
            creatorColorPref: room.settings.colorPref
        });
    });

    socket.on("confirm-join", (data) => {
        const { password, name, silent } = data;
        const room = rooms[password];
        if (!room || room.status !== "waiting") return;

        socket.join(password);
        room.status = "active";
        const joinerId = socket.id;
        const creatorId = room.creatorId;

        let whiteId, blackId;
        const pref = room.settings.colorPref;
        if (pref === 'white') { whiteId = creatorId; blackId = joinerId; }
        else if (pref === 'black') { whiteId = joinerId; blackId = creatorId; }
        else {
            if (Math.random() < 0.5) { whiteId = creatorId; blackId = joinerId; }
            else { whiteId = joinerId; blackId = creatorId; }
        }

        room.players.white = whiteId;
        room.players.black = blackId;
        room.players.whiteName = whiteId === creatorId ? room.creatorName : name;
        room.players.blackName = blackId === creatorId ? room.creatorName : name;
        room.players.whiteAdmin = false;
        room.players.blackAdmin = false;
        room.reconnectDeadline = null;

        io.to(creatorId).emit("player-assignment", {
            color: creatorId === whiteId ? 'white' : 'black',
            settings: room.settings,
            oppName: name
        });
        io.to(joinerId).emit("player-assignment", {
            color: joinerId === whiteId ? 'white' : 'black',
            settings: room.settings,
            oppName: room.creatorName
        });
        sendMuteState(room, creatorId);
        sendMuteState(room, joinerId);
    });

    socket.on("rejoin-room", (data) => {
        const { password, name } = data || {};
        if (!password || !name) return;
        const room = rooms[password];
        if (!room || room.status !== "active") return;

        let color = null;
        if (room.players.whiteName === name && !room.players.white) {
            room.players.white = socket.id;
            color = "white";
        } else if (room.players.blackName === name && !room.players.black) {
            room.players.black = socket.id;
            color = "black";
        }
        if (!color) return;

        socket.join(password);
        if (room.reconnectDeadline) {
            clearTimeout(room.reconnectDeadline);
            room.reconnectDeadline = null;
        }

        const oppName = color === "white" ? room.players.blackName : room.players.whiteName;
        socket.emit("player-assignment", { color, settings: room.settings, oppName });
        sendMuteState(room, socket.id);
        socket.to(password).emit("opponent-reconnected", { message: `${name} reconnected.` });

        const requesterId = socket.id;
        const targetId = color === "white" ? room.players.black : room.players.white;
        if (targetId) io.to(targetId).emit("chess-state-sync-request", { requesterId });
    });

    socket.on("coup-create-room", (data) => {
        const password = (data.password || "").trim();
        const name = (data.name || "").trim();
        if (!password || !name) {
            socket.emit("error-msg", "Room password and username are required.");
            return;
        }
        if (coupRooms[password]) {
            socket.emit("error-msg", "Room password already in use.");
            return;
        }

        const socketRoom = getCoupSocketRoom(password);
        socket.join(socketRoom);
        coupRooms[password] = {
            password,
            hostId: socket.id,
            status: "lobby",
            players: [{ socketId: socket.id, name }],
            game: null
        };
        emitCoupLobbyUpdate(password);
    });

    socket.on("coup-join-room", (data) => {
        const password = (data.password || "").trim();
        const name = (data.name || "").trim();
        if (!password || !name) {
            socket.emit("error-msg", "Room password and username are required.");
            return;
        }

        const room = coupRooms[password];
        if (!room) {
            socket.emit("error-msg", "Room not found.");
            return;
        }
        if (room.status !== "lobby") {
            socket.emit("error-msg", "Game already started.");
            return;
        }
        if (room.players.some((player) => player.socketId === socket.id)) {
            emitCoupLobbyUpdate(password);
            return;
        }

        socket.join(getCoupSocketRoom(password));
        room.players.push({ socketId: socket.id, name });
        emitCoupLobbyUpdate(password);
    });

    socket.on("coup-change-name", (data) => {
        const password = (data.password || "").trim();
        const nextName = (data.name || "").trim();
        if (!password || !nextName) return;

        const room = coupRooms[password];
        if (!room) return;

        const player = room.players.find((p) => p.socketId === socket.id);
        if (!player) return;
        player.name = nextName;
        emitCoupLobbyUpdate(password);
    });

    socket.on("coup-kick-player", (data) => {
        const password = (data.password || "").trim();
        const targetSocketId = data.targetSocketId;
        const room = coupRooms[password];
        if (!room) return;
        if (room.hostId !== socket.id) return;
        if (!targetSocketId || targetSocketId === socket.id) return;
        if (!room.players.some((player) => player.socketId === targetSocketId)) return;

        removePlayerFromCoupRoom(password, targetSocketId);
        io.to(targetSocketId).emit("coup-kicked");
        io.sockets.sockets.get(targetSocketId)?.leave(getCoupSocketRoom(password));
    });

    socket.on("coup-start-game", (data) => {
        const password = (data.password || "").trim();
        const room = coupRooms[password];
        if (!room) return;
        if (room.hostId !== socket.id) return;
        if (room.players.length < 2) return;
        room.status = "active";
        const deck = createCoupDeck();
        room.game = {
            players: room.players.map((player) => ({
                socketId: player.socketId,
                name: player.name,
                coins: 2,
                cards: [deck.pop(), deck.pop()],
                revealed: [false, false],
                alive: true
            })),
            deck,
            turnIndex: 0,
            phase: "turn",
            pending: null,
            log: ["Game started."]
        };

        appendCoupLog(room, `${room.game.players[0].name} goes first.`);
        io.in(getCoupSocketRoom(password)).emit("coup-game-started", { password });
        emitCoupGameState(password);
    });

    socket.on("coup-action", (data) => {
        const password = (data.password || "").trim();
        const room = coupRooms[password];
        if (!room || !room.game || room.status !== "active") return;
        const game = room.game;
        if (game.phase !== "turn") return;

        const actor = game.players[game.turnIndex];
        if (!actor || actor.socketId !== socket.id || !actor.alive) return;

        const action = data.action;
        const targetId = data.targetSocketId || null;
        const target = targetId ? game.players.find((p) => p.socketId === targetId) : null;
        const actionDefs = {
            income: { coins: 1 },
            foreign_aid: { coins: 2, blockRoles: ["duke"] },
            tax: { coins: 3, claim: "duke" },
            coup: { cost: 7, targetRequired: true, unchallengeable: true },
            assassinate: { cost: 3, targetRequired: true, claim: "assassin", blockRoles: ["contessa"] },
            steal: { targetRequired: true, claim: "captain", blockRoles: ["captain", "ambassador"] },
            exchange: { claim: "ambassador" }
        };
        const def = actionDefs[action];
        if (!def) return;
        if (actor.coins >= 10 && action !== "coup") return;
        if (def.cost && actor.coins < def.cost) return;
        if (def.targetRequired && (!target || !target.alive || target.socketId === actor.socketId)) return;

        game.phase = "resolving";
        game.pending = {
            kind: "action",
            action,
            actorId: actor.socketId,
            actorName: actor.name,
            targetId: target ? target.socketId : null,
            targetName: target ? target.name : null,
            claim: def.claim || null,
            blockRoles: def.blockRoles || [],
            unchallengeable: !!def.unchallengeable,
            passes: []
        };
        appendCoupLog(room, `${actor.name} attempts ${action.replace("_", " ")}${target ? ` targeting ${target.name}` : ""}.`);
        emitCoupGameState(password);
    });

    socket.on("coup-response", (data) => {
        const password = (data.password || "").trim();
        const room = coupRooms[password];
        if (!room || !room.game || room.game.phase !== "resolving" || !room.game.pending) return;
        const game = room.game;
        const pending = game.pending;
        const actor = game.players.find((p) => p.socketId === pending.actorId);
        const responder = game.players.find((p) => p.socketId === socket.id);
        if (!actor || !responder || !responder.alive) return;

        const response = data.response;
        if (pending.kind === "action") {
            if (responder.socketId === actor.socketId) return;
            if (response === "pass") {
                if (!pending.passes.includes(responder.socketId)) pending.passes.push(responder.socketId);
            } else if (response === "challenge" && pending.claim) {
                const actorHasClaim = actor.cards.some((c, idx) => c === pending.claim && !actor.revealed[idx]);
                appendCoupLog(room, `${responder.name} challenges ${actor.name}'s ${pending.claim}.`);
                if (actorHasClaim) {
                    loseOneInfluence(room, responder.socketId, "failed challenge");
                    const revealIndex = actor.cards.findIndex((c, idx) => c === pending.claim && !actor.revealed[idx]);
                    const revealedCard = actor.cards[revealIndex];
                    actor.cards.splice(revealIndex, 1);
                    actor.revealed.splice(revealIndex, 1);
                    game.deck.push(revealedCard);
                    shuffle(game.deck);
                    actor.cards.push(game.deck.pop());
                    actor.revealed.push(false);
                    appendCoupLog(room, `${actor.name} proves ${pending.claim} and redraws a card.`);
                } else {
                    loseOneInfluence(room, actor.socketId, `failed to show ${pending.claim}`);
                    pending.canceled = true;
                }
                pending.passes = game.players.filter((p) => p.alive && p.socketId !== actor.socketId).map((p) => p.socketId);
            }

            const requiredPasses = game.players.filter((p) => p.alive && p.socketId !== actor.socketId).map((p) => p.socketId);
            const allPassed = requiredPasses.every((id) => pending.passes.includes(id));
            if (!allPassed) {
                emitCoupGameState(password);
                return;
            }

            if (!pending.canceled && pending.targetId && pending.blockRoles.length) {
                pending.kind = "block-offer";
                pending.passes = [];
                appendCoupLog(room, `Challenge window closed. Waiting for ${pending.targetName} to block or allow.`);
                emitCoupGameState(password);
                return;
            }

            if (!pending.canceled) {
                const target = pending.targetId ? game.players.find((p) => p.socketId === pending.targetId) : null;
                if (pending.action === "income") actor.coins += 1;
                if (pending.action === "foreign_aid") actor.coins += 2;
                if (pending.action === "tax") actor.coins += 3;
                if (pending.action === "coup") {
                    actor.coins -= 7;
                    if (target) loseOneInfluence(room, target.socketId, "couped");
                }
                if (pending.action === "assassinate") {
                    actor.coins -= 3;
                    if (target) loseOneInfluence(room, target.socketId, "assassinated");
                }
                if (pending.action === "steal" && target) {
                    const amount = Math.min(2, target.coins);
                    target.coins -= amount;
                    actor.coins += amount;
                }
                if (pending.action === "exchange") {
                    const drawA = game.deck.pop();
                    const drawB = game.deck.pop();
                    const available = actor.cards.filter((_, idx) => !actor.revealed[idx]).concat([drawA, drawB]).filter(Boolean);
                    shuffle(available);
                    const kept = available.slice(0, 2);
                    const returning = available.slice(2);
                    const aliveSlots = actor.revealed.map((r, idx) => (!r ? idx : -1)).filter((idx) => idx !== -1);
                    aliveSlots.forEach((slot, idx) => {
                        actor.cards[slot] = kept[idx] || actor.cards[slot];
                    });
                    returning.forEach((card) => game.deck.push(card));
                    shuffle(game.deck);
                }
                appendCoupLog(room, `${actor.name}'s action resolves: ${pending.action.replace("_", " ")}.`);
            } else {
                appendCoupLog(room, `Action ${pending.action.replace("_", " ")} was canceled.`);
            }
        } else if (pending.kind === "block-offer") {
            if (socket.id !== pending.targetId) return;
            if (response === "block") {
                pending.kind = "block";
                pending.blockerId = pending.targetId;
                pending.blockerName = pending.targetName;
                pending.blockClaim = data.blockRole || pending.blockRoles[0];
                pending.passes = [];
                appendCoupLog(room, `${pending.blockerName} blocks with ${pending.blockClaim}.`);
                emitCoupGameState(password);
                return;
            }

            if (response === "pass") {
                appendCoupLog(room, `${pending.targetName} allows the action.`);
                const target = pending.targetId ? game.players.find((p) => p.socketId === pending.targetId) : null;
                if (pending.action === "assassinate") {
                    actor.coins -= 3;
                    if (target) loseOneInfluence(room, target.socketId, "assassinated");
                }
                if (pending.action === "steal" && target) {
                    const amount = Math.min(2, target.coins);
                    target.coins -= amount;
                    actor.coins += amount;
                }
                appendCoupLog(room, `${actor.name}'s action resolves: ${pending.action.replace("_", " ")}.`);
            }
        } else if (pending.kind === "block") {
            if (responder.socketId === pending.blockerId) return;
            if (response === "pass") {
                if (!pending.passes.includes(responder.socketId)) pending.passes.push(responder.socketId);
            } else if (response === "challenge") {
                const blocker = game.players.find((p) => p.socketId === pending.blockerId);
                if (!blocker) return;
                const blockValid = blocker.cards.some((c, idx) => c === pending.blockClaim && !blocker.revealed[idx]);
                appendCoupLog(room, `${responder.name} challenges ${blocker.name}'s block.`);
                if (blockValid) {
                    loseOneInfluence(room, responder.socketId, "failed block challenge");
                    pending.canceled = true;
                } else {
                    loseOneInfluence(room, blocker.socketId, "failed block");
                }
                pending.passes = game.players.filter((p) => p.alive && p.socketId !== pending.blockerId).map((p) => p.socketId);
            }

            const requiredPasses = game.players.filter((p) => p.alive && p.socketId !== pending.blockerId).map((p) => p.socketId);
            const allPassed = requiredPasses.every((id) => pending.passes.includes(id));
            if (!allPassed) {
                emitCoupGameState(password);
                return;
            }

            if (!pending.canceled) {
                const actionPending = {
                    ...pending,
                    kind: "action",
                    passes: game.players.filter((p) => p.alive && p.socketId !== pending.actorId).map((p) => p.socketId)
                };
                game.pending = actionPending;
                emitCoupGameState(password);
                return;
            }
            appendCoupLog(room, "The action was blocked.");
        }

        const winner = checkCoupWinner(room);
        if (!winner) {
            game.turnIndex = getNextAliveTurnIndex(room, game.turnIndex);
            game.phase = "turn";
            game.pending = null;
        }
        emitCoupGameState(password);
    });

    socket.on("coup-leave-room", (data) => {
        const password = (data.password || "").trim();
        if (!password) return;
        removePlayerFromCoupRoom(password, socket.id);
        socket.leave(getCoupSocketRoom(password));
    });

    socket.on("list-active-games", () => {
        socket.emit("active-games", { games: buildActiveGames() });
    });

    socket.on("spectate-game", (data) => {
        const { password, name, silent } = data;
        const room = rooms[password];
        if (!room || room.status !== "active" || !room.players.white || !room.players.black) {
            socket.emit("error-msg", "Game not available for spectating.");
            return;
        }

        socket.join(password);
        const spectatorId = getNextSpectatorId(room);
        room.spectators[socket.id] = { id: spectatorId, name, isAdmin: false };

        socket.emit("spectator-assignment", {
            password,
            spectatorId,
            name,
            settings: room.settings,
            whiteName: room.players.whiteName,
            blackName: room.players.blackName
        });

        sendMuteState(room, socket.id);
        if (room.lastSpectatorState) {
            socket.emit("spectator-state-sync", { state: room.lastSpectatorState });
        }

        emitSpectatorList(password);
        if (!silent) {
            io.in(password).emit("receive-chat", {
                sender: "System",
                message: `${name} is now spectating the game.`
            });
        }

        [room.players.white, room.players.black].forEach((playerId) => {
            if (playerId && !String(playerId).startsWith("bot:")) {
                io.to(playerId).emit("spectator-sync-needed", { requesterId: socket.id });
            }
        });
    });

    socket.on("spectator-state-sync", (data) => {
        const room = rooms[data.password];
        if (room && data.state) room.lastSpectatorState = data.state;
        if (data.targetSocketId) io.to(data.targetSocketId).emit("spectator-state-sync", { state: data.state });
    });

    socket.on("self-admin-enabled", (data) => {
        const room = rooms[data.password];
        if (!room || isSocketFullMuted(room, socket.id)) return;

        if (room.players.white === socket.id) {
            room.players.whiteAdmin = true;
            return;
        }

        if (room.players.black === socket.id) {
            room.players.blackAdmin = true;
            return;
        }

        const spectator = room.spectators[socket.id];
        if (spectator) {
            spectator.isAdmin = true;
        }
    });

    socket.on("request-admin-list", (data) => {
        const room = canRunAdminCommand(socket, data.password);
        if (!room) return;

        const whiteMute = getMuteState(room, { type: "player", color: "white" });
        const blackMute = getMuteState(room, { type: "player", color: "black" });
        socket.emit("admin-list", {
            white: { name: room.players.whiteName || "White", isAdmin: !!room.players.whiteAdmin, muted: whiteMute.muted, fullMuted: whiteMute.fullMuted },
            black: { name: room.players.blackName || "Black", isAdmin: !!room.players.blackAdmin, muted: blackMute.muted, fullMuted: blackMute.fullMuted },
            spectators: buildSpectatorList(room)
        });
    });

    socket.on("bot-game-state-sync", (data) => {
        const room = rooms[data.password];
        if (!room || !room.isBotGame || room.botOwnerId !== socket.id || !data.state) return;
        room.lastSpectatorState = data.state;
    });

    socket.on("send-move", (data) => {
        socket.to(data.password).emit("receive-move", data);
    });

    socket.on("send-chat", (data) => {
        const room = rooms[data.password];
        if (!room) return;
        const mute = getMuteState(room, getParticipantKey(room, socket.id));
        if (mute.muted || mute.fullMuted) {
            socket.emit("chat-denied", { message: "Message blocked: you are muted." });
            return;
        }
        socket.to(data.password).emit("receive-chat", {
            message: data.message,
            sender: data.senderName
        });
    });

    // --- ADMIN COMMANDS ---
    socket.on("admin-pause-toggle", (data) => {
        const room = canRunAdminCommand(socket, data.password);
        if (!room) return;
        io.in(data.password).emit("pause-state-updated", { isPaused: data.isPaused });
    });

    socket.on("admin-set-time", (data) => {
        const room = canRunAdminCommand(socket, data.password);
        if (!room) return;
        io.in(data.password).emit("time-updated", {
            color: data.color,
            newTime: data.newTime
        });
    });

    socket.on("admin-set-increment", (data) => {
        const room = canRunAdminCommand(socket, data.password);
        if (!room) return;
        io.in(data.password).emit("increment-updated", {
            newInc: data.newInc
        });
    });

    socket.on("admin-place-piece", (data) => {
        const room = canRunAdminCommand(socket, data.password);
        if (!room) return;
        io.in(data.password).emit("piece-placed", {
            r: data.r,
            c: data.c,
            piece: data.piece
        });
    });

    socket.on("admin-reset-board", (data) => {
        const room = canRunAdminCommand(socket, data.password);
        if (!room) return;
        io.in(data.password).emit("board-reset-triggered");
    });

    socket.on("admin-mute-toggle", (data) => {
        const room = canRunAdminCommand(socket, data.password);
        if (!room) return;
        if (data.mode !== "mute" && data.mode !== "fullmute") return;
        const target = resolveMuteTarget(room, data);
        if (!target) return;
        const state = setMuteState(room, target, data.mode, !!data.value);
        const message = `${target.label} ${data.mode === "fullmute" ? "full mute" : "mute"} set to ${!!data.value}.`;
        if (target.socketId && !String(target.socketId).startsWith("bot:")) {
            io.to(target.socketId).emit("mute-updated", { ...state, appliesToMe: true, message });
        }
        socket.emit("mute-updated", { ...getMuteState(room, getParticipantKey(room, socket.id)), appliesToMe: false, message });
        emitSpectatorList(data.password);
    });

    socket.on("admin-permission-toggle", (data) => {
        const room = canRunAdminCommand(socket, data.password);
        if (!room) return;

        if (data.targetType === "spectator") {
            const spectator = Object.values(room.spectators).find((s) => s.id === data.spectatorId);
            if (!spectator) return;
            spectator.isAdmin = data.isAdmin;
            io.in(data.password).emit("permission-updated", {
                targetType: "spectator",
                spectatorId: data.spectatorId,
                isAdmin: data.isAdmin
            });
            emitSpectatorList(data.password);
            return;
        }

        if (data.targetColor === "white") room.players.whiteAdmin = data.isAdmin;
        if (data.targetColor === "black") room.players.blackAdmin = data.isAdmin;

        io.in(data.password).emit("permission-updated", {
            targetType: "player",
            targetColor: data.targetColor,
            isAdmin: data.isAdmin
        });
    });

    // --- GAME ACTIONS ---
    socket.on("resign", (data) => {
        socket.to(data.password).emit("opponent-resigned", { winner: data.winner });
    });

    socket.on("offer-draw", (data) => {
        socket.to(data.password).emit("draw-offered");
    });

    socket.on("draw-response", (data) => {
        io.in(data.password).emit("draw-resolved", { accepted: data.accepted });
    });

    socket.on("rematch-request", (data) => {
        const pass = data.password;
        if (!roomRematchStates[pass]) roomRematchStates[pass] = new Set();

        if (roomRematchStates[pass].has(socket.id)) {
            roomRematchStates[pass].delete(socket.id);
            socket.to(pass).emit("rematch-canceled");
        } else {
            roomRematchStates[pass].add(socket.id);
            socket.to(pass).emit("rematch-offered");

            if (roomRematchStates[pass].size === 2) {
                delete roomRematchStates[pass];
                io.in(pass).emit("rematch-start");
            }
        }
    });

    socket.on("disconnecting", () => {
        Object.entries(rooms).forEach(([roomPass, room]) => {
            if (room.spectators[socket.id]) {
                const spectatorId = room.spectators[socket.id].id;
                delete room.spectators[socket.id];
                if (room.mutes?.spectators) delete room.mutes.spectators[spectatorId];
                emitSpectatorList(roomPass);
                return;
            }

            const isPlayer = room.creatorId === socket.id || room.players.white === socket.id || room.players.black === socket.id;
            if (isPlayer) {
                if (room.isBotGame && room.botOwnerId === socket.id) {
                    io.in(roomPass).emit("room-closed", { message: "The bot game ended because the player disconnected." });
                    delete rooms[roomPass];
                    if (roomRematchStates[roomPass]) delete roomRematchStates[roomPass];
                } else if (room.status === "active") {
                    const isWhite = room.players.white === socket.id;
                    const isBlack = room.players.black === socket.id;
                    if (isWhite) room.players.white = null;
                    if (isBlack) room.players.black = null;
                    socket.to(roomPass).emit("opponent-disconnected", {
                        message: "Opponent disconnected. Waiting for reconnection..."
                    });
                    if (room.reconnectDeadline) clearTimeout(room.reconnectDeadline);
                    room.reconnectDeadline = setTimeout(() => {
                        if (!room.players.white || !room.players.black) {
                            io.in(roomPass).emit("room-closed", {
                                message: "A player did not reconnect in time. Room closed."
                            });
                            delete rooms[roomPass];
                            if (roomRematchStates[roomPass]) delete roomRematchStates[roomPass];
                        }
                    }, 30000);
                } else {
                    delete rooms[roomPass];
                    if (roomRematchStates[roomPass]) delete roomRematchStates[roomPass];
                }
            }
        });

        Object.keys(coupRooms).forEach((password) => {
            const room = coupRooms[password];
            if (!room.players.some((player) => player.socketId === socket.id)) return;

            if (room.status === "active" && room.game) {
                const gamePlayer = room.game.players.find((p) => p.socketId === socket.id);
                if (gamePlayer && gamePlayer.alive) {
                    gamePlayer.alive = false;
                    gamePlayer.revealed = [true, true];
                    appendCoupLog(room, `${gamePlayer.name} disconnected and was eliminated.`);
                    const winner = checkCoupWinner(room);
                    if (!winner && room.game.players[room.game.turnIndex]?.socketId === socket.id) {
                        room.game.turnIndex = getNextAliveTurnIndex(room, room.game.turnIndex);
                    }
                    emitCoupGameState(password);
                }
            }

            removePlayerFromCoupRoom(password, socket.id);
        });
    });
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
