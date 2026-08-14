/**
 * NekoAdvance - GBA Emulation Core Engine (Powered by gbajs HLE Engine)
 * Features:
 * - ARM7TDMI CPU (ARM & Thumb instruction sets)
 * - Complete 2D PPU (Modes 0-5, Tiles, Sprites, Alpha Blending, Windows)
 * - Complete Audio synthesis (DirectSound A/B, PSG 1-4)
 * - Built-in High-Level Emulation (HLE) BIOS (No external BIOS file required)
 * - Cartridge Saves: Flash 128KB (Pokémon Emerald/Ruby/Sapphire/FireRed/LeafGreen), Flash 64KB, SRAM, EEPROM & RTC (GPIO)
 * - Save States (freeze / defrost) with Screenshots
 * - Fast-Forward (x1, x2, x4, x8, x16) with audio muting option
 * - Cheats Engine Hook (GameShark, Action Replay, CodeBreaker)
 */

import { storage } from './storage.js';
import { CheatEngine } from './cheat-engine.js';

export const GBA_BUTTONS = {
  A: 0,
  B: 1,
  SELECT: 2,
  START: 3,
  RIGHT: 4,
  LEFT: 5,
  UP: 6,
  DOWN: 7,
  R: 8,
  L: 9
};

export class GBAEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });

    this.cheatEngine = new CheatEngine();
    this.rom = null;
    this.romName = '';
    this.romId = '';
    this.isRunning = false;
    this.isPaused = false;

    this.speed = 1;
    this.currentFPS = 0;
    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.animFrameId = null;

    this.gba = null;

    // Audio Driver interface for UI controls
    this.audioDriver = {
      volume: 0.8,
      muteOnFastForward: true,
      setVolume: (val) => {
        this.audioDriver.volume = Math.max(0, Math.min(1, val));
        if (this.gba && this.gba.audio) {
          this.gba.audio.masterVolume = this.audioDriver.volume;
        }
      }
    };

    this.initGBA();
  }

  initGBA() {
    const GBAClass = window.GameBoyAdvance || (typeof GameBoyAdvance !== 'undefined' ? GameBoyAdvance : null);
    if (typeof GBAClass === 'function') {
      this.gba = new GBAClass();
      this.gba.setCanvas(this.canvas);
      if (this.gba.audio) {
        this.gba.audio.masterVolume = this.audioDriver.volume;
      }
      return true;
    } else {
      console.warn('GameBoyAdvance core class not found on window yet');
      return false;
    }
  }

  async loadROM(arrayBuffer, name) {
    this.stop();

    if (!this.gba) {
      this.initGBA();
    }

    if (!this.gba) {
      throw new Error('No se pudo inicializar el núcleo de emulación de GBA.');
    }

    this.rom = arrayBuffer;
    this.romName = name;

    // Load ROM into MMU
    const success = this.gba.setRom(arrayBuffer);
    if (!success) {
      throw new Error('No se pudo cargar la ROM. Comprueba que sea un archivo de GBA válido (.gba, .bin).');
    }

    // Extract Game Title / Code from Cartridge Header
    const code = this.gba.rom?.code || '';
    const title = this.gba.rom?.title || '';
    this.romId = (code.trim() || title.trim() || name.replace(/\.[^/.]+$/, '')).replace(/[^a-zA-Z0-9_-]/g, '_');

    // Load Saved Battery (.sav / Flash 128K / SRAM) from IndexedDB
    const savedBattery = await storage.loadBattery(this.romId);
    if (savedBattery && savedBattery.byteLength > 0) {
      try {
        this.gba.setSavedata(savedBattery);
      } catch (e) {
        console.warn('Could not restore battery save:', e);
      }
    }

    // Hook battery save flush to automatically save to IndexedDB
    this.gba.storeSavedata = () => {
      if (this.gba.mmu && this.gba.mmu.save && this.gba.mmu.save.buffer) {
        storage.saveBattery(this.romId, this.gba.mmu.save.buffer);
      }
    };

    // Load Cheats for this ROM
    const savedCheats = await storage.getCheats(this.romId);
    this.cheatEngine.setCheats(savedCheats);

    // Ensure Audio Context is ready
    if (this.gba.audio) {
      this.gba.audio.ensureContext();
    }

    this.start();
    return this.romId;
  }

  start() {
    if (!this.gba) return;
    this.isRunning = true;
    this.isPaused = false;

    if (this.gba.audio) {
      this.gba.audio.ensureContext();
      this.gba.audio.pause(false);
    }

    this.lastFpsTime = performance.now();
    this.frameCount = 0;

    this.startTimerLoop();
  }

  startTimerLoop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }

    const FRAME_DURATION = 1000 / 59.7275; // ~16.742 ms per GBA frame
    let lastTime = performance.now();
    let accumulatedTime = 0;

    const step = () => {
      if (this.isRunning && !this.isPaused && this.gba) {
        const now = performance.now();
        let delta = now - lastTime;
        lastTime = now;

        // Clamp delta to prevent huge backlog if tab was minimized or suffered a large lag spike
        if (delta > 200) delta = 200;
        if (delta < 0) delta = 0;

        accumulatedTime += delta * this.speed;

        // Limit maximum frames per single RAF cycle to prevent lag spikes
        const maxFramesPerTick = Math.max(6, Math.ceil(this.speed * 2.5));
        let framesRun = 0;

        while (accumulatedTime >= FRAME_DURATION && framesRun < maxFramesPerTick) {
          accumulatedTime -= FRAME_DURATION;
          framesRun++;

          // Auto-Frameskip: skip heavy canvas drawing on intermediate frames
          const isFinalFrameOfTick = (accumulatedTime < FRAME_DURATION) || (framesRun === maxFramesPerTick);
          if (this.gba.video) {
            this.gba.video.skipDraw = !isFinalFrameOfTick;
          }

          this.gba.advanceFrame();
          this.frameCount++;
        }

        // Ensure skipDraw is reset for next iteration
        if (this.gba.video) {
          this.gba.video.skipDraw = false;
        }

        // If still lagging behind max frames, drop excess accumulated time to stay in real-time
        if (accumulatedTime > FRAME_DURATION * 2) {
          accumulatedTime = 0;
        }

        // Apply active cheats
        if (this.gba.mmu) {
          this.cheatEngine.applyCheats({
            write8: (addr, val) => this.gba.mmu.store8(addr, val),
            write16: (addr, val) => this.gba.mmu.store16(addr, val),
            write32: (addr, val) => this.gba.mmu.store32(addr, val)
          });
        }

        // Check if battery save was marked pending and flush to storage
        if (this.gba.mmu && this.gba.mmu.save && this.gba.mmu.save.writePending) {
          this.gba.mmu.save.writePending = false;
          storage.saveBattery(this.romId, this.gba.mmu.save.buffer);
        }

        // FPS Calculation (Actual internal GBA emulation speed)
        const elapsed = now - this.lastFpsTime;
        if (elapsed >= 1000) {
          this.currentFPS = Math.round((this.frameCount * 1000) / elapsed);
          this.frameCount = 0;
          this.lastFpsTime = now;
        }
      } else {
        lastTime = performance.now();
        accumulatedTime = 0;
      }

      if (this.isRunning) {
        this.animFrameId = requestAnimationFrame(step);
      }
    };

    this.animFrameId = requestAnimationFrame(step);
  }

  pause() {
    this.isPaused = true;
    if (this.gba) {
      this.gba.pause();
    }
  }

  resume() {
    if (!this.isRunning) {
      this.start();
    } else {
      this.isPaused = false;
      if (this.gba && this.gba.audio) {
        if (this.gba.audio.context && this.gba.audio.context.state === 'suspended') {
          this.gba.audio.context.resume().catch(() => {});
        }
        this.gba.audio.pause(false);
      }
    }
  }

  reset() {
    if (this.gba && this.rom) {
      this.stop();
      this.loadROM(this.rom, this.romName);
    }
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.gba) {
      this.gba.pause();
    }
  }

  setSpeed(multiplier) {
    this.speed = Math.max(1, Math.min(16, multiplier));
    if (this.gba && this.gba.audio) {
      if (this.speed > 1 && this.audioDriver.muteOnFastForward) {
        this.gba.audio.masterVolume = 0;
      } else {
        this.gba.audio.masterVolume = this.audioDriver.volume;
      }
    }
  }

  // --- Controls ---
  setButton(button, isPressed) {
    if (!this.gba || !this.gba.keypad) return;
    const mask = 1 << button;
    if (isPressed) {
      this.gba.keypad.currentDown &= ~mask;
    } else {
      this.gba.keypad.currentDown |= mask;
    }
  }

  // --- Save / Load States ---
  async saveState(slot = 1) {
    if (!this.romId || !this.gba) return false;

    const screenshot = this.canvas.toDataURL('image/jpeg', 0.8);
    const state = this.gba.freeze();

    await storage.saveState(this.romId, slot, state, screenshot);
    return true;
  }

  async loadState(slot = 1) {
    if (!this.romId || !this.gba) return false;

    const saved = await storage.loadState(this.romId, slot);
    if (!saved || !saved.data) return false;

    try {
      this.gba.defrost(saved.data);
      return true;
    } catch (e) {
      console.error('Error restoring save state:', e);
      return false;
    }
  }

  exportStateData() {
    if (!this.romId || !this.gba) return "{}";
    return JSON.stringify({
      romId: this.romId,
      romName: this.romName,
      timestamp: Date.now(),
      state: this.gba.freeze()
    });
  }
}
