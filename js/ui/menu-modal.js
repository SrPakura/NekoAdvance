/**
 * NekoAdvance - In-Screen Retro GBA BIOS / System Menu Controller
 * Full hardware and virtual controller navigation (L/R tabs, D-Pad up/down/left/right, A select, B back).
 */

import { storage } from '../core/storage.js';
import { GBA_BUTTONS } from '../core/gba-engine.js';

// Synthesizer for 8-bit retro sound effects
class RetroAudioSynth {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playCursor() {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.03);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.03);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.03);
    } catch (e) {}
  }

  playTab() {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.linearRampToValueAtTime(640, now + 0.05);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.05);
    } catch (e) {}
  }

  playSelect() {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.04); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.08); // G5
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.15);
    } catch (e) {}
  }

  playCancel() {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(380, now);
      osc.frequency.linearRampToValueAtTime(190, now + 0.07);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.07);
    } catch (e) {}
  }
}

export class MenuModal {
  constructor(engine, inputManager, hud, onRomLoad) {
    this.engine = engine;
    this.inputManager = inputManager;
    this.hud = hud;
    this.onRomLoad = onRomLoad;

    this.menuElement = document.getElementById('retro-menu');
    this.tabs = ['library', 'states', 'cheats', 'settings'];
    this.currentTabIndex = 0;
    this.selectedIndex = 0;
    this.isOpen = false;
    this.currentItemsCount = 0;

    this.synth = new RetroAudioSynth();

    // Cache settings
    this.volume = 0.8;
    this.scanlines = true;
    this.haptic = true;
    this.speeds = [1, 2, 4, 8, 16];
    this.currentSpeedIdx = 0;

    this.frameSkipLabels = ['AUTO', 'OFF (0)', '1', '2', '3', '4'];
    this.frameSkipValues = ['auto', 0, 1, 2, 3, 4];
    this.currentFrameSkipIdx = 0;

    this.init();
  }

  async init() {
    // Tab buttons click support
    const tabBtns = document.querySelectorAll('.retro-tab');
    tabBtns.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        this.setTab(idx);
      });
    });

    const triggerL = document.querySelector('.retro-tab-trigger.tab-l');
    const triggerR = document.querySelector('.retro-tab-trigger.tab-r');
    if (triggerL) triggerL.addEventListener('click', () => this.cycleTab(-1));
    if (triggerR) triggerR.addEventListener('click', () => this.cycleTab(1));

    // File input listener
    const fileInput = document.getElementById('rom-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.handleFile(file);
      });
    }

    // Load initial settings
    const savedVol = await storage.getSetting('volume');
    if (savedVol !== null) this.volume = savedVol;
    const savedScan = await storage.getSetting('scanlines');
    if (savedScan !== null) this.scanlines = savedScan;
    const savedFrameSkip = await storage.getSetting('frameskip');
    if (savedFrameSkip !== null && savedFrameSkip !== undefined) {
      const idx = this.frameSkipValues.indexOf(savedFrameSkip);
      if (idx >= 0) this.currentFrameSkipIdx = idx;
    }
  }

  open(tabName = 'library') {
    const idx = this.tabs.indexOf(tabName);
    this.currentTabIndex = idx >= 0 ? idx : 0;
    this.selectedIndex = 0;
    this.isOpen = true;
    this.menuElement.classList.add('open');
    this.engine.pause();
    this.synth.playSelect();
    this.renderCurrentTab();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.menuElement.classList.remove('open');
    this.synth.playCancel();
    if (this.engine.isRunning) {
      this.engine.resume();
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(this.tabs[this.currentTabIndex]);
    }
  }

  cycleTab(dir) {
    this.currentTabIndex = (this.currentTabIndex + dir + this.tabs.length) % this.tabs.length;
    this.selectedIndex = 0;
    this.synth.playTab();
    this.renderCurrentTab();
  }

  setTab(idx) {
    if (idx >= 0 && idx < this.tabs.length) {
      this.currentTabIndex = idx;
      this.selectedIndex = 0;
      this.synth.playTab();
      this.renderCurrentTab();
    }
  }

  renderCurrentTab() {
    const activeTab = this.tabs[this.currentTabIndex];
    
    // Update tab indicators
    document.querySelectorAll('.retro-tab').forEach((tabEl, i) => {
      tabEl.classList.toggle('active', i === this.currentTabIndex);
    });

    document.querySelectorAll('.retro-tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-panel-${activeTab}`);
    });

    if (activeTab === 'library') this.renderLibrary();
    else if (activeTab === 'states') this.renderStates();
    else if (activeTab === 'cheats') this.renderCheats();
    else if (activeTab === 'settings') this.renderSettings();
  }

  // --- Controller / Hardware Input Router ---
  handleButton(gbaButton, isPressed) {
    if (!this.isOpen || !isPressed) return;

    switch (gbaButton) {
      case GBA_BUTTONS.L:
        this.cycleTab(-1);
        break;

      case GBA_BUTTONS.R:
        this.cycleTab(1);
        break;

      case GBA_BUTTONS.UP:
        this.moveSelection(-1);
        break;

      case GBA_BUTTONS.DOWN:
        this.moveSelection(1);
        break;

      case GBA_BUTTONS.LEFT:
        this.adjustSelection(-1);
        break;

      case GBA_BUTTONS.RIGHT:
        this.adjustSelection(1);
        break;

      case GBA_BUTTONS.A:
        this.activateSelection();
        break;

      case GBA_BUTTONS.B:
        this.close();
        break;

      case GBA_BUTTONS.START:
        this.close();
        break;

      case GBA_BUTTONS.SELECT:
        this.secondaryAction();
        break;
    }
  }

  moveSelection(delta) {
    if (this.currentItemsCount === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.currentItemsCount) % this.currentItemsCount;
    this.synth.playCursor();
    this.updateSelectedRow();
  }

  updateSelectedRow() {
    const rows = document.querySelectorAll('.retro-tab-panel.active .retro-row');
    rows.forEach((row, i) => {
      const isSel = i === this.selectedIndex;
      row.classList.toggle('selected', isSel);
      if (isSel) {
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  // --- TAB 1: JUEGOS (Library) ---
  async renderLibrary() {
    const list = document.getElementById('retro-rom-list');
    if (!list) return;

    const roms = await storage.getAllROMs();
    let html = `
      <div class="retro-row" data-idx="0" data-action="load-file">
        <div class="retro-row-left">
          <span class="retro-cursor">▶</span>
          <span class="retro-row-title">📁 + CARGAR NUEVO ARCHIVO .GBA</span>
        </div>
        <div class="retro-row-right">
          <span class="retro-badge badge-active">NUEVO</span>
        </div>
      </div>
    `;

    if (roms.length === 0) {
      html += `
        <div class="retro-empty-hint">
          NO HAY JUEGOS EN MEMORIA.<br>SELECCIONA "CARGAR ARCHIVO" O ARRASTRA UN .GBA A LA PANTALLA.
        </div>
      `;
      this.currentItemsCount = 1;
    } else {
      roms.forEach((rom, idx) => {
        const itemIdx = idx + 1;
        const sizeMb = (rom.size / (1024 * 1024)).toFixed(1);
        html += `
          <div class="retro-row" data-idx="${itemIdx}" data-action="play-rom" data-id="${rom.id}">
            <div class="retro-row-left">
              <span class="retro-cursor">▶</span>
              <span class="retro-row-title">${rom.name}</span>
            </div>
            <div class="retro-row-right">
              <span class="retro-badge">${sizeMb}MB</span>
              <button class="retro-btn-sub btn-export-sav" data-id="${rom.id}" title="Exportar partida .sav">SAV</button>
              <button class="retro-btn-sub btn-del-rom" data-id="${rom.id}" title="Borrar">✕</button>
            </div>
          </div>
        `;
      });
      this.currentItemsCount = roms.length + 1;
    }

    list.innerHTML = html;
    this.selectedIndex = Math.min(this.selectedIndex, this.currentItemsCount - 1);
    this.updateSelectedRow();

    // Mouse & Touch bindings
    list.querySelectorAll('.retro-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.retro-btn-sub')) return;
        this.selectedIndex = parseInt(row.dataset.idx, 10);
        this.updateSelectedRow();
        this.activateSelection();
      });
    });

    list.querySelectorAll('.btn-export-sav').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = b.dataset.id;
        await this.exportSaveFile(id);
      });
    });

    list.querySelectorAll('.btn-del-rom').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = b.dataset.id;
        if (confirm('¿Eliminar ROM y sus partidas de la memoria?')) {
          await storage.deleteROM(id);
          this.hud.showToast('Juego eliminado', '🗑️');
          this.renderLibrary();
        }
      });
    });
  }

  // --- TAB 2: GUARDAR (Save States) ---
  async renderStates() {
    const list = document.getElementById('retro-states-list');
    if (!list) return;

    if (!this.engine.romId) {
      list.innerHTML = `
        <div class="retro-empty-hint">
          INICIA UN JUEGO PRIMERO PARA GESTIONAR LAS RANURAS DE GUARDADO.
        </div>
      `;
      this.currentItemsCount = 0;
      return;
    }

    const savedStates = await storage.getStatesForROM(this.engine.romId);
    const statesMap = {};
    savedStates.forEach(s => statesMap[s.slot] = s);

    let html = '';
    for (let slot = 1; slot <= 4; slot++) {
      const state = statesMap[slot];
      const hasData = !!state;
      const timeStr = hasData ? new Date(state.timestamp).toLocaleTimeString() : '---';
      const badgeClass = hasData ? 'badge-on' : 'badge-off';
      const badgeText = hasData ? 'GUARDADO' : 'VACÍO';

      html += `
        <div class="retro-row" data-idx="${slot - 1}" data-action="state-slot" data-slot="${slot}" data-has="${hasData}">
          <div class="retro-row-left">
            <span class="retro-cursor">▶</span>
            <span class="retro-row-title">RANURA ${slot}: ${timeStr}</span>
          </div>
          <div class="retro-row-right">
            <span class="retro-badge ${badgeClass}">${badgeText}</span>
            <button class="retro-btn-sub btn-save-now" data-slot="${slot}">GUARDAR</button>
          </div>
        </div>
      `;
    }

    // Item 4: Export states to JSON
    html += `
      <div class="retro-row" data-idx="4" data-action="export-state-json">
        <div class="retro-row-left">
          <span class="retro-cursor">▶</span>
          <span class="retro-row-title">📥 EXPORTAR ESTADO (.JSON)</span>
        </div>
        <div class="retro-row-right">
          <span class="retro-badge badge-active">EXPORT</span>
        </div>
      </div>
    `;

    this.currentItemsCount = 5;
    list.innerHTML = html;
    this.selectedIndex = Math.min(this.selectedIndex, this.currentItemsCount - 1);
    this.updateSelectedRow();

    list.querySelectorAll('.retro-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-save-now')) return;
        this.selectedIndex = parseInt(row.dataset.idx, 10);
        this.updateSelectedRow();
        this.activateSelection();
      });
    });

    list.querySelectorAll('.btn-save-now').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const slot = parseInt(btn.dataset.slot, 10);
        await this.engine.saveState(slot);
        this.hud.showToast(`Guardado en Ranura ${slot}`, '💾');
        this.synth.playSelect();
        this.renderStates();
      });
    });
  }

  // --- TAB 3: TRUCOS (Cheats) ---
  async renderCheats() {
    const list = document.getElementById('retro-cheats-list');
    if (!list) return;

    if (!this.engine.romId) {
      list.innerHTML = `
        <div class="retro-empty-hint">
          INICIA UN JUEGO PARA APLICAR TRUCOS / GAMESHARK.
        </div>
      `;
      this.currentItemsCount = 0;
      return;
    }

    const cheats = await storage.getCheats(this.engine.romId);
    let html = `
      <div class="retro-row" data-idx="0" data-action="add-cheat">
        <div class="retro-row-left">
          <span class="retro-cursor">▶</span>
          <span class="retro-row-title">⚡ + AÑADIR NUEVO TRUCO</span>
        </div>
        <div class="retro-row-right">
          <span class="retro-badge badge-active">NUEVO</span>
        </div>
      </div>
    `;

    cheats.forEach((c, idx) => {
      const itemIdx = idx + 1;
      const badgeClass = c.enabled ? 'badge-on' : 'badge-off';
      const badgeText = c.enabled ? 'ON' : 'OFF';

      html += `
        <div class="retro-row" data-idx="${itemIdx}" data-action="toggle-cheat" data-id="${c.id}" data-enabled="${c.enabled}">
          <div class="retro-row-left">
            <span class="retro-cursor">▶</span>
            <span class="retro-row-title">${c.name}</span>
          </div>
          <div class="retro-row-right">
            <span class="retro-badge ${badgeClass}">${badgeText}</span>
            <button class="retro-btn-sub btn-del-cheat" data-id="${c.id}">✕</button>
          </div>
        </div>
      `;
    });

    this.currentItemsCount = cheats.length + 1;
    list.innerHTML = html;
    this.selectedIndex = Math.min(this.selectedIndex, this.currentItemsCount - 1);
    this.updateSelectedRow();

    list.querySelectorAll('.retro-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.btn-del-cheat')) return;
        this.selectedIndex = parseInt(row.dataset.idx, 10);
        this.updateSelectedRow();
        this.activateSelection();
      });
    });

    list.querySelectorAll('.btn-del-cheat').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(b.dataset.id, 10);
        await storage.deleteCheat(id);
        this.engine.cheatEngine.removeCheat(id);
        this.renderCheats();
      });
    });
  }

  // --- TAB 4: AJUSTES (Settings) ---
  renderSettings() {
    const list = document.getElementById('retro-settings-list');
    if (!list) return;

    const currentSpeed = this.engine.speed;
    const currentFrameSkip = this.frameSkipLabels[this.currentFrameSkipIdx] || 'AUTO';
    const volPercent = Math.round(this.volume * 100);
    const scanText = this.scanlines ? 'ON' : 'OFF';
    const scanBadge = this.scanlines ? 'badge-on' : 'badge-off';
    const hapticText = this.inputManager.hapticEnabled ? 'ON' : 'OFF';
    const hapticBadge = this.inputManager.hapticEnabled ? 'badge-on' : 'badge-off';
    const muteFF = this.engine.audioDriver.muteOnFastForward ? 'ON' : 'OFF';
    const muteFFBadge = this.engine.audioDriver.muteOnFastForward ? 'badge-on' : 'badge-off';

    const items = [
      { id: 'speed', title: 'VELOCIDAD FAST-FORWARD', val: `◄ ${currentSpeed}x ►`, badge: 'SPEED' },
      { id: 'frameskip', title: 'SALTO DE FRAMES (FRAMESKIP)', val: `◄ ${currentFrameSkip} ►`, badge: 'FPS' },
      { id: 'muteFF', title: 'SILENCIAR EN AVANCE RÁPIDO', val: `◄ ${muteFF} ►`, badgeClass: muteFFBadge },
      { id: 'scanlines', title: 'FILTRO SCANLINES CRT', val: `◄ ${scanText} ►`, badgeClass: scanBadge },
      { id: 'volume', title: 'VOLUMEN PRINCIPAL', val: `◄ ${volPercent}% ►`, badge: 'AUDIO' },
      { id: 'haptic', title: 'VIBRACIÓN HÁPTICA', val: `◄ ${hapticText} ►`, badgeClass: hapticBadge },
      { id: 'controls', title: 'GUÍA / ATAJOS DE TECLADO', val: '[INFO]', badge: 'KEYS' },
      { id: 'fullscreen', title: 'PANTALLA COMPLETA', val: '[ENTER]', badge: 'FULL' },
      { id: 'reset', title: 'REINICIAR JUEGO ACTUAL', val: '[RESET]', badgeClass: 'badge-off' },
      { id: 'pwa', title: 'INSTALAR APP (PWA)', val: '[INSTALL]', badgeClass: 'badge-active' }
    ];

    let html = '';
    items.forEach((item, idx) => {
      html += `
        <div class="retro-row" data-idx="${idx}" data-setting="${item.id}">
          <div class="retro-row-left">
            <span class="retro-cursor">▶</span>
            <span class="retro-row-title">${item.title}</span>
          </div>
          <div class="retro-row-right">
            <span class="retro-val-adjust">${item.val}</span>
          </div>
        </div>
      `;
    });

    this.currentItemsCount = items.length;
    list.innerHTML = html;
    this.selectedIndex = Math.min(this.selectedIndex, this.currentItemsCount - 1);
    this.updateSelectedRow();

    list.querySelectorAll('.retro-row').forEach(row => {
      row.addEventListener('click', () => {
        this.selectedIndex = parseInt(row.dataset.idx, 10);
        this.updateSelectedRow();
        this.activateSelection();
      });
    });
  }

  // --- Main Action on Button [A] or Enter ---
  async activateSelection() {
    const activeTab = this.tabs[this.currentTabIndex];
    const activeRow = document.querySelector('.retro-tab-panel.active .retro-row.selected');
    if (!activeRow) return;

    this.synth.playSelect();

    if (activeTab === 'library') {
      const action = activeRow.dataset.action;
      if (action === 'load-file') {
        const fileInput = document.getElementById('rom-file-input');
        if (fileInput) fileInput.click();
      } else if (action === 'play-rom') {
        const id = activeRow.dataset.id;
        const rom = await storage.getROM(id);
        if (rom && this.onRomLoad) {
          await this.onRomLoad(rom.data, rom.name);
          this.close();
        }
      }
    } else if (activeTab === 'states') {
      const action = activeRow.dataset.action;
      if (action === 'state-slot') {
        const slot = parseInt(activeRow.dataset.slot, 10);
        const hasData = activeRow.dataset.has === 'true';
        if (hasData) {
          const success = await this.engine.loadState(slot);
          if (success) {
            this.hud.showToast(`Estado cargado (Ranura ${slot})`, '⚡');
            this.close();
          }
        } else {
          await this.engine.saveState(slot);
          this.hud.showToast(`Estado guardado en Ranura ${slot}`, '💾');
          this.renderStates();
        }
      } else if (action === 'export-state-json') {
        this.exportStateJSON();
      }
    } else if (activeTab === 'cheats') {
      const action = activeRow.dataset.action;
      if (action === 'add-cheat') {
        this.promptAddCheat();
      } else if (action === 'toggle-cheat') {
        const id = parseInt(activeRow.dataset.id, 10);
        const enabled = activeRow.dataset.enabled !== 'true';
        this.engine.cheatEngine.toggleCheat(id, enabled);
        const all = await storage.getCheats(this.engine.romId);
        const found = all.find(c => c.id === id);
        if (found) {
          found.enabled = enabled;
          await storage.saveCheat(found);
        }
        this.renderCheats();
      }
    } else if (activeTab === 'settings') {
      const setting = activeRow.dataset.setting;
      if (setting === 'speed') this.adjustSelection(1);
      else if (setting === 'frameskip') this.adjustSelection(1);
      else if (setting === 'muteFF') this.adjustSelection(1);
      else if (setting === 'scanlines') this.adjustSelection(1);
      else if (setting === 'volume') this.adjustSelection(1);
      else if (setting === 'haptic') this.adjustSelection(1);
      else if (setting === 'controls') this.showControlsInfo();
      else if (setting === 'fullscreen') this.toggleFullscreen();
      else if (setting === 'reset') {
        if (this.engine.romId) {
          this.engine.reset();
          this.hud.showToast('Juego reiniciado', '🔄');
          this.close();
        }
      } else if (setting === 'pwa') {
        this.installPWA();
      }
    }
  }

  // --- Adjust Value on Left / Right Arrows ---
  adjustSelection(dir) {
    const activeTab = this.tabs[this.currentTabIndex];
    if (activeTab !== 'settings') return;

    const activeRow = document.querySelector('.retro-tab-panel.active .retro-row.selected');
    if (!activeRow) return;

    const setting = activeRow.dataset.setting;
    this.synth.playCursor();

    if (setting === 'speed') {
      const currentSpeed = this.engine.speed;
      const idx = this.speeds.indexOf(currentSpeed);
      const nextIdx = (idx + dir + this.speeds.length) % this.speeds.length;
      const newSpeed = this.speeds[nextIdx];
      this.engine.setSpeed(newSpeed);
      this.hud.updateSpeedBadge(newSpeed);
      this.renderSettings();
    } else if (setting === 'frameskip') {
      const nextIdx = (this.currentFrameSkipIdx + dir + this.frameSkipValues.length) % this.frameSkipValues.length;
      this.currentFrameSkipIdx = nextIdx;
      const newSkipVal = this.frameSkipValues[nextIdx];
      this.engine.setFrameSkip(newSkipVal);
      this.hud.showToast(`Frameskip: ${this.frameSkipLabels[nextIdx]}`, '⚡');
      this.renderSettings();
    } else if (setting === 'muteFF') {
      const newMute = !this.engine.audioDriver.muteOnFastForward;
      this.engine.audioDriver.muteOnFastForward = newMute;
      this.renderSettings();
    } else if (setting === 'scanlines') {
      this.scanlines = !this.scanlines;
      const viewport = document.getElementById('screen-viewport');
      if (viewport) {
        viewport.classList.toggle('no-scanlines', !this.scanlines);
      }
      storage.setSetting('scanlines', this.scanlines);
      this.renderSettings();
    } else if (setting === 'volume') {
      this.volume = Math.max(0, Math.min(1, Math.round((this.volume + dir * 0.1) * 10) / 10));
      this.engine.audioDriver.setVolume(this.volume);
      storage.setSetting('volume', this.volume);
      this.renderSettings();
    } else if (setting === 'haptic') {
      const newHaptic = !this.inputManager.hapticEnabled;
      this.inputManager.setHapticEnabled(newHaptic);
      this.renderSettings();
    } else if (setting === 'controls') {
      this.showControlsInfo();
    }
  }

  showControlsInfo() {
    this.hud.showToast('Teclado: D-Pad=Flechas | A=X | B=Z | L=A | R=S | Start=Enter | Select=Backspace', '⌨️');
  }

  // --- Secondary Action on Button [SELECT] ---
  async secondaryAction() {
    const activeTab = this.tabs[this.currentTabIndex];
    const activeRow = document.querySelector('.retro-tab-panel.active .retro-row.selected');
    if (!activeRow) return;

    if (activeTab === 'states') {
      const slot = parseInt(activeRow.dataset.slot, 10);
      if (slot) {
        await this.engine.saveState(slot);
        this.hud.showToast(`Ranura ${slot} sobreescrita`, '💾');
        this.synth.playSelect();
        this.renderStates();
      }
    } else if (activeTab === 'library') {
      const id = activeRow.dataset.id;
      if (id) {
        await this.exportSaveFile(id);
      }
    }
  }

  async handleFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const buffer = e.target.result;
      const id = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      await storage.saveROM(id, file.name, buffer, file.size);
      this.hud.showToast(`Juego guardado: ${file.name}`, '💾');
      this.renderLibrary();
      
      if (this.onRomLoad) {
        await this.onRomLoad(buffer, file.name);
        this.close();
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async exportSaveFile(id) {
    const save = await storage.loadBattery(id);
    if (save) {
      const blob = new Blob([save], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${id}.sav`;
      a.click();
      URL.revokeObjectURL(url);
      this.hud.showToast('Partida .sav descargada', '📥');
    } else {
      this.hud.showToast('No hay datos de guardado para este juego', '⚠️');
    }
  }

  async exportStateJSON() {
    if (!this.engine.romId) {
      this.hud.showToast('No hay juego en ejecución', '⚠️');
      return;
    }
    const stateData = await this.engine.exportStateData();
    const blob = new Blob([stateData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.engine.romId}_state.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.hud.showToast('Estado exportado (.json)', '📥');
  }

  async promptAddCheat() {
    const code = prompt('Introduce el código GameShark / ActionReplay / CodeBreaker:\n(Ej: 82003884 0001)');
    if (!code) return;
    const name = prompt('Nombre o descripción del truco:\n(Ej: Caramelos Raros)') || 'Truco';

    const cheat = {
      romId: this.engine.romId,
      name: name.trim(),
      code: code.trim(),
      format: 'Auto',
      enabled: true
    };

    await storage.saveCheat(cheat);
    this.engine.cheatEngine.addCheat(cheat);
    this.hud.showToast('Truco añadido y activado', '⚡');
    this.renderCheats();
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      this.hud.showToast('Pantalla completa activada', '⛶');
    } else {
      document.exitFullscreen().catch(() => {});
      this.hud.showToast('Pantalla completa desactivada', '⛶');
    }
  }

  installPWA() {
    if (window.deferredInstallPrompt) {
      window.deferredInstallPrompt.prompt();
      window.deferredInstallPrompt = null;
    } else {
      this.hud.showToast('Usa "Añadir a pantalla de inicio" en tu navegador', '💡');
    }
  }
}
