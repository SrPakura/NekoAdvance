/**
 * NekoAdvance - Visual On-Screen Debugger & Console Logger
 * Provides mobile-friendly real-time telemetry, HUD overlay, and log inspector.
 */

class DebugLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 300;
    this.isOpen = false;
    this.engine = null;
    this.hudUpdateInterval = null;

    this.initConsoleHook();
    this.initUI();
  }

  setEngine(engine) {
    this.engine = engine;
  }

  initConsoleHook() {
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);
    const origInfo = console.info.bind(console);

    const formatArg = (a) => {
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch (e) {
          return String(a);
        }
      }
      return String(a);
    };

    const addLog = (type, args) => {
      const msg = Array.from(args).map(formatArg).join(' ');
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
      
      this.logs.push({ type, msg, time: timeStr });
      if (this.logs.length > this.maxLogs) {
        this.logs.shift();
      }

      if (this.isOpen) {
        this.renderLogs();
      }
    };

    console.log = (...args) => {
      origLog(...args);
      addLog('log', args);
    };

    console.warn = (...args) => {
      origWarn(...args);
      addLog('warn', args);
    };

    console.error = (...args) => {
      origError(...args);
      addLog('error', args);
    };

    console.info = (...args) => {
      origInfo(...args);
      addLog('info', args);
    };

    window.addEventListener('error', (e) => {
      addLog('error', [`[WindowError] ${e.message} at ${e.filename}:${e.lineno}`]);
    });

    window.addEventListener('unhandledrejection', (e) => {
      addLog('error', [`[UnhandledPromise] ${e.reason}`]);
    });

    console.log('[DebugLogger] Visual On-Screen Logger initialized.');
  }

  initUI() {
    // 1. Floating Toggle Button
    const fab = document.createElement('button');
    fab.id = 'neko-debug-fab';
    fab.innerHTML = '🐞 DEBUG';
    fab.style.cssText = `
      position: fixed;
      bottom: 12px;
      left: 12px;
      z-index: 99999;
      background: rgba(26, 18, 43, 0.9);
      border: 1px solid #00f0ff;
      color: #00f0ff;
      font-family: monospace;
      font-size: 11px;
      font-weight: bold;
      padding: 6px 10px;
      border-radius: 20px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
      user-select: none;
      -webkit-user-select: none;
      touch-action: manipulation;
    `;

    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleModal();
    });

    document.body.appendChild(fab);

    // 2. Full-Screen Debug Modal
    const modal = document.createElement('div');
    modal.id = 'neko-debug-modal';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 100000;
      background: rgba(10, 6, 20, 0.96);
      display: none;
      flex-direction: column;
      font-family: monospace;
      color: #e2e8f0;
      box-sizing: border-box;
      padding: 10px;
      overflow: hidden;
    `;

    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #4a3a69; padding-bottom: 6px; margin-bottom: 8px;">
        <span style="color: #00f0ff; font-weight: bold; font-size: 13px;">🐞 NEKOADVANCE DEBUG CONSOLE</span>
        <button id="neko-debug-close" style="background: #ef4444; border: none; color: #fff; font-weight: bold; padding: 4px 10px; border-radius: 4px; cursor: pointer;">✕ CERRAR</button>
      </div>

      <!-- Quick Telemetry HUD -->
      <div id="neko-debug-hud" style="background: rgba(20, 15, 35, 0.95); border: 1px solid #3d2f5a; border-radius: 6px; padding: 8px; margin-bottom: 8px; font-size: 11px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
        <div><strong>CORE:</strong> <span id="dbg-core" style="color:#38bdf8;">--</span></div>
        <div><strong>FPS:</strong> <span id="dbg-fps" style="color:#4ade80;">--</span></div>
        <div><strong>AUDIO CTX:</strong> <span id="dbg-audio-state" style="color:#fbbf24;">--</span></div>
        <div><strong>PIPELINE:</strong> <span id="dbg-audio-pipe" style="color:#a78bfa;">--</span></div>
        <div><strong>HW / GBA RATE:</strong> <span id="dbg-rates">-- / 32768</span></div>
        <div><strong>SAMPLES TRAFFIC:</strong> <span id="dbg-samples" style="color:#4ade80;">0 /s</span></div>
        <div><strong>PEAK AMPLITUDE:</strong> <span id="dbg-amp" style="color:#f43f5e;">0.0000</span></div>
        <div><strong>BUFFER:</strong> <span id="dbg-buf">0 ms</span></div>
      </div>

      <!-- Actions Bar -->
      <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
        <button id="dbg-btn-tone" style="background:#2b1f44; border:1px solid #38bdf8; color:#fff; padding:5px 8px; border-radius:4px; font-size:11px; cursor:pointer;">🔊 Test Tone</button>
        <button id="dbg-btn-unlock" style="background:#2b1f44; border:1px solid #4ade80; color:#4ade80; padding:5px 8px; border-radius:4px; font-size:11px; cursor:pointer;">⚡ Desbloquear Audio</button>
        <button id="dbg-btn-toggle-worklet" style="background:#2b1f44; border:1px solid #fbbf24; color:#fbbf24; padding:5px 8px; border-radius:4px; font-size:11px; cursor:pointer;">🔄 Alternar Worklet/Script</button>
        <button id="dbg-btn-copy" style="background:#2b1f44; border:1px solid #a78bfa; color:#a78bfa; padding:5px 8px; border-radius:4px; font-size:11px; cursor:pointer;">📋 Copiar Logs</button>
        <button id="dbg-btn-clear" style="background:#2b1f44; border:1px solid #94a3b8; color:#94a3b8; padding:5px 8px; border-radius:4px; font-size:11px; cursor:pointer;">🗑️ Limpiar</button>
      </div>

      <!-- Logs Container -->
      <div id="neko-debug-logs" style="flex: 1; overflow-y: auto; background: #07040d; border: 1px solid #2a1f40; border-radius: 4px; padding: 6px; font-size: 10px; line-height: 1.4; word-break: break-all;"></div>
    `;

    document.body.appendChild(modal);
    this.modal = modal;

    // Bind Controls
    modal.querySelector('#neko-debug-close').addEventListener('click', () => this.toggleModal(false));
    
    modal.querySelector('#dbg-btn-tone').addEventListener('click', () => {
      if (this.engine && this.engine.audioDriver) {
        this.engine.audioDriver.playTestTone();
      }
    });

    modal.querySelector('#dbg-btn-unlock').addEventListener('click', async () => {
      if (this.engine && this.engine.audioDriver) {
        await this.engine.audioDriver.unlockAudio();
      }
    });

    modal.querySelector('#dbg-btn-toggle-worklet').addEventListener('click', async () => {
      if (this.engine && this.engine.audioDriver) {
        await this.engine.audioDriver.toggleEngineMode();
      }
    });

    modal.querySelector('#dbg-btn-copy').addEventListener('click', () => {
      const text = this.logs.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.msg}`).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        alert('¡Logs copiados al portapapeles!');
      }).catch(() => {
        prompt('Copia manualmente:', text);
      });
    });

    modal.querySelector('#dbg-btn-clear').addEventListener('click', () => {
      this.logs = [];
      this.renderLogs();
    });
  }

  toggleModal(forceState) {
    this.isOpen = forceState !== undefined ? forceState : !this.isOpen;
    this.modal.style.display = this.isOpen ? 'flex' : 'none';

    if (this.isOpen) {
      this.renderLogs();
      this.startHUDUpdates();
    } else {
      this.stopHUDUpdates();
    }
  }

  startHUDUpdates() {
    this.stopHUDUpdates();
    this.hudUpdateInterval = setInterval(() => this.updateHUD(), 150);
  }

  stopHUDUpdates() {
    if (this.hudUpdateInterval) {
      clearInterval(this.hudUpdateInterval);
      this.hudUpdateInterval = null;
    }
  }

  updateHUD() {
    if (!this.engine) return;

    const coreEl = document.getElementById('dbg-core');
    const fpsEl = document.getElementById('dbg-fps');
    const stateEl = document.getElementById('dbg-audio-state');
    const pipeEl = document.getElementById('dbg-audio-pipe');
    const ratesEl = document.getElementById('dbg-rates');
    const samplesEl = document.getElementById('dbg-samples');
    const ampEl = document.getElementById('dbg-amp');
    const bufEl = document.getElementById('dbg-buf');

    if (coreEl) coreEl.textContent = this.engine.useMgba ? 'mGBA WASM (C)' : 'gbajs Fallback';
    if (fpsEl) fpsEl.textContent = `${this.engine.currentFPS || 0} fps`;

    if (this.engine.audioDriver) {
      const diag = this.engine.audioDriver.getDiagnostics();
      if (stateEl) {
        stateEl.textContent = (diag.contextState || 'Desconocido').toUpperCase();
        stateEl.style.color = diag.contextState === 'running' ? '#4ade80' : '#fbbf24';
      }
      if (pipeEl) pipeEl.textContent = diag.mode || '--';
      if (ratesEl) ratesEl.textContent = `${diag.hardwareSampleRate || '--'} / ${diag.sourceSampleRate || 32768} Hz`;
      if (samplesEl) samplesEl.textContent = `${diag.writesPerSec || 0} writes/s (underruns: ${diag.underruns || 0})`;
      if (ampEl) {
        const amp = diag.peakVolume || 0;
        ampEl.textContent = amp.toFixed(4);
        ampEl.style.color = amp > 0.001 ? '#4ade80' : '#f43f5e';
      }
      if (bufEl) bufEl.textContent = `${diag.bufferMs || 0} ms (${diag.availableSamples || 0} smp)`;
    }
  }

  renderLogs() {
    const logsContainer = document.getElementById('neko-debug-logs');
    if (!logsContainer) return;

    let html = '';
    for (let i = 0; i < this.logs.length; i++) {
      const l = this.logs[i];
      let color = '#94a3b8';
      if (l.type === 'error') color = '#f87171';
      else if (l.type === 'warn') color = '#fbbf24';
      else if (l.type === 'info') color = '#38bdf8';
      else if (l.msg.includes('🔊') || l.msg.includes('Audio')) color = '#a78bfa';

      html += `<div style="color: ${color}; margin-bottom: 2px;">[${l.time}] ${this.escapeHtml(l.msg)}</div>`;
    }

    logsContainer.innerHTML = html;
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

export const debugLogger = new DebugLogger();
