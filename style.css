body {
    margin: 0;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: #272522;
    color: #fff;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    overflow: hidden;
}

#setup-overlay {
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.8);
    display: flex; justify-content: center; align-items: center;
    z-index: 1000;
}

.setup-card {
    background: #312e2b;
    padding: 30px;
    border-radius: 8px;
    width: 350px;
    text-align: center;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
}

.tabs { display: flex; margin-bottom: 20px; background: #262421; border-radius: 5px; padding: 5px; }
.tabs button {
    flex: 1; padding: 10px; border: none; background: none; color: #bababa;
    cursor: pointer; font-weight: bold; transition: 0.2s;
}
.tabs button.active { background: #454241; color: #fff; border-radius: 4px; }

.input-group { text-align: left; margin-bottom: 15px; }
.input-group label { display: block; font-size: 12px; color: #bababa; margin-bottom: 5px; text-transform: uppercase; }
.input-group input, .input-group select {
    width: 100%; padding: 10px; background: #262421; border: 1px solid #403d39;
    color: #fff; border-radius: 4px; box-sizing: border-box;
}

.start-btn {
    width: 100%; padding: 15px; background: #779556; border: none;
    color: #fff; font-weight: bold; font-size: 18px; border-radius: 4px;
    cursor: pointer; margin-top: 10px;
}
.start-btn:hover { background: #8dbb5c; }

.action-btn {
    background: #3c3a39; color: #bababa; border: none; padding: 8px 15px;
    border-radius: 4px; cursor: pointer; font-weight: bold;
}
.action-btn:hover { background: #454241; color: #fff; }

#main-layout { display: flex; gap: 20px; padding: 20px; max-width: 1200px; width: 100%; height: 90vh; }
#game-area { flex: 2; display: flex; flex-direction: column; gap: 10px; }
#board-container { aspect-ratio: 1/1; background: #312e2b; padding: 10px; border-radius: 4px; }
#board { display: grid; grid-template-columns: repeat(8, 1fr); width: 100%; height: 100%; user-select: none; }

.square { position: relative; display: flex; justify-content: center; align-items: center; cursor: pointer; }
.white-sq { background: #ebecd0; }
.black-sq { background: #779556; }
.selected { background: #f6f669 !important; }
.king-check { background: #ff4d4d !important; }

.piece { font-size: 50px; z-index: 10; cursor: grab; }
.w-piece { color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
.b-piece { color: #000; }

.hint-dot { width: 25%; height: 25%; background: rgba(0,0,0,0.1); border-radius: 50%; }
.hint-capture { width: 80%; height: 80%; border: 4px solid rgba(0,0,0,0.1); border-radius: 50%; position: absolute; }

.player-bar { display: flex; justify-content: space-between; align-items: center; background: #262421; padding: 10px 15px; border-radius: 4px; }
.timer { background: #3c3a39; padding: 5px 15px; border-radius: 4px; font-family: monospace; font-size: 20px; font-weight: bold; color: #bababa; }
.timer.active { background: #fff; color: #000; }

#side-panel { flex: 1; display: flex; flex-direction: column; background: #262421; border-radius: 4px; overflow: hidden; }
#status-box { padding: 20px; background: #211f1c; text-align: center; border-bottom: 1px solid #3c3a39; }
#status-text { font-weight: bold; color: #779556; font-size: 18px; }
#history-container { flex: 1; overflow-y: auto; padding: 10px; font-size: 14px; }
.history-row { display: flex; padding: 5px 0; border-bottom: 1px solid #312e2b; }
.move-num { width: 30px; color: #63615e; }
.move-val { flex: 1; font-weight: bold; }
.btn-row { display: flex; gap: 10px; padding: 15px; background: #211f1c; }

/* NEW: RESULT MODAL */
#game-over-overlay {
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.85);
    display: flex; justify-content: center; align-items: center;
    z-index: 2000;
}
.result-card {
    background: #262421; padding: 30px; border-radius: 12px; text-align: center;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 2px solid #779556; width: 320px;
}
.result-card h2 { color: #779556; margin-top: 0; }
.modal-btns { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
#rematch-btn { background: #779556; color: white; border: none; padding: 12px; border-radius: 5px; font-weight: bold; cursor: pointer; }
#rematch-btn:disabled { background: #4a5d36; cursor: not-allowed; }
.rematch-ready { animation: pulse 1.5s infinite; background: #8dbb5c !important; }

@keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
}
