/**
 * NekoAdvance - Modern GBA Core Engine (Powered by mGBA WASM & WebGL2 Hardware Blit)
 * Features:
 * - mGBA WebAssembly High-Precision Core Bridge
 * - WebGL2 Zero-Copy Texture Blit with GLSL Shaders (GBA LCD Grid, CRT Scanlines, Pixel Perfect)
 * - Ultra-low-latency AudioDriver with Ring Buffer anti-crackling
 * - Persistent Battery Saves (.sav: Flash 128K, SRAM, EEPROM) & RTC
 * - 6-Slot Instant Save States with WebGL thumbnail generation
 * - Dynamic Fast-Forward (1x to 16x) and live shader swapping
 */

import { storage } from './storage.js';
import { CheatEngine } from './cheat-engine.js';
import { WebGLRenderer } from './renderer/webgl-renderer.js';
import { AudioDriver } from './audio/audio-driver.js';
import { MGBABridge, GBA_KEYS } from './mgba/mgba-bridge.js';

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
    
    // Hardware WebGL2 Renderer with Retro Shaders
    this.renderer = new WebGLRenderer(canvas);
    
    // Audio Subsystem
    this.audioDriver = new AudioDriver(44100, 2048);

    // Core Bridges
    this.mgbaBridge = new MGBABridge();
    this.cheatEngine = new CheatEngine();
    this.gba = null; // Legacy gbajs instance fallback if available

    this.rom = null;
    this.romName = '';
    this.romId = '';
    this.isRunning = false;
    this.isPaused = false;

    this.speed = 1;
    this.frameSkip = 'auto';
    this.frameSkipCounter = 0;
    this.currentFPS = 0;
    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.animFrameId = null;

    // Framebuffer storage (240x160 RGBA = 153,600 bytes)
    this.pixelBuffer = new Uint8Array(240 * 160 * 4);

    this.initSettings();
    this.initCore();
  }

  async initSettings() {
    const savedFrameSkip = await storage.getSetting('frameskip');
    if (savedFrameSkip !== null && savedFrameSkip !== undefined) {
      this.frameSkip = savedFrameSkip;
    }

    const savedShader = await storage.getSetting('video_shader');
    if (savedShader) {
      this.renderer.setShader(savedShader);
    }

    const savedColorCorrection = await storage.getSetting('color_correction');
    if (savedColorCorrection !== null && savedColorCorrection !== undefined) {
      this.renderer.setColorCorrection(savedColorCorrection);
    }
  }

  async initCore() {
    // 1. Try initializing mGBA WASM bridge
    await this.mgbaBridge.init();

    // 2. Initialize legacy fallback core if available on window
    const GBAClass = window.GameBoyAdvance || (typeof GameBoyAdvance !== 'undefined' ? GameBoyAdvance : null);
    if (typeof GBAClass === 'function') {
      this.gba = new GBAClass();
      // Route audio to our central AudioDriver
      if (this.gba.audio) {
        this.gba.audio.masterVolume = this.audioDriver.volume;
      }
    }
  }

  setShader(shaderName) {
    this.renderer.setShader(shaderName);
    storage.setSetting('video_shader', shaderName);
  }

  setColorCorrection(enabled) {
    this.renderer.setColorCorrection(enabled);
    storage.setSetting('color_correction', !!enabled);
  }

  async loadROM(arrayBuffer, name) {
    this.stop();

    this.rom = arrayBuffer;
    this.romName = name;

    // Try loading with mGBA WASM first
    let loadedWithMgba = false;
    try {
      loadedWithMgba = this.mgbaBridge.loadROM(arrayBuffer, name);
    } catch (e) {
      console.warn('[GBAEngine] mGBA WASM loader deferred, falling back to core:', e);
    }

    // If gbajs is present, also prepare it for maximum compatibility
    if (this.gba) {
      try {
        this.gba.setRom(arrayBuffer);
      } catch (e) {
        console.warn('[GBAEngine] Legacy core ROM setup:', e);
      }
    }

    // Extract ROM ID from Title or filename
    let title = '';
    if (this.gba && this.gba.rom) {
      title = (this.gba.rom.code || this.gba.rom.title || '').trim();
    }
    this.romId = (title || name.replace(/\.[^/.]+$/, '')).replace(/[^a-zA-Z0-9_-]/g, '_');

    // Load Saved Battery (.sav / Flash 128K / SRAM) from IndexedDB
    const savedBattery = await storage.loadBattery(this.romId);
    if (savedBattery && savedBattery.byteLength > 0) {
      try {
        if (this.gba) this.gba.setSavedata(savedBattery);
        this.mgbaBridge.loadSaveData(new Uint8Array(savedBattery));
      } catch (e) {
        console.warn('[GBAEngine] Could not restore battery save:', e);
      }
    }

    // Hook battery save flush to automatically save to IndexedDB
    if (this.gba) {
      this.gba.storeSavedata = () => {
        if (this.gba.mmu && this.gba.mmu.save && this.gba.mmu.save.buffer) {
          storage.saveBattery(this.romId, this.gba.mmu.save.buffer);
        }
      };
    }

    // Load Cheats for this ROM
    const savedCheats = await storage.getCheats(this.romId);
    this.cheatEngine.setCheats(savedCheats);

    // Ensure Audio Context is unlocked
    this.audioDriver.ensureContext();

    this.start();
    return this.romId;
  }

  start() {
    this.isRunning = true;
    this.isPaused = false;

    this.audioDriver.ensureContext();
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
      if (this.isRunning && !this.isPaused) {
        const now = performance.now();
        let delta = now - lastTime;
        lastTime = now;

        if (delta > 200) delta = 200;
        if (delta < 0) delta = 0;

        accumulatedTime += delta * this.speed;

        const maxFramesPerTick = Math.max(6, Math.ceil(this.speed * 2.5));
        let framesRun = 0;

        while (accumulatedTime >= FRAME_DURATION && framesRun < maxFramesPerTick) {
          accumulatedTime -= FRAME_DURATION;
          framesRun++;

          // Execute Frame in Core
          if (this.gba) {
            this.gba.advanceFrame();
            
            // Extract Framebuffer from GBA Video Software context
            if (this.gba.video && this.gba.video.softwareRenderer && this.gba.video.softwareRenderer.bufferedData) {
              this.pixelBuffer = this.gba.video.softwareRenderer.bufferedData;
            }
          } else {
            const buf = this.mgbaBridge.runFrame();
            if (buf) this.pixelBuffer = buf;
          }

          this.frameCount++;
        }

        // Render Frame using Hardware WebGL2 with Retro Shaders
        if (this.pixelBuffer) {
          this.renderer.renderFrame(this.pixelBuffer);
        }

        // Read Audio Samples if using WASM core
        const audioSamples = this.mgbaBridge.getAudioSamples();
        if (audioSamples && audioSamples.length > 0) {
          this.audioDriver.writeSamples(audioSamples);
        }

        if (accumulatedTime > FRAME_DURATION * 2) {
          accumulatedTime = 0;
        }

        // Apply active cheats
        if (this.gba && this.gba.mmu) {
          this.cheatEngine.applyCheats({
            write8: (addr, val) => this.gba.mmu.store8(addr, val),
            write16: (addr, val) => this.gba.mmu.store16(addr, val),
            write32: (addr, val) => this.gba.mmu.store32(addr, val)
          });
        }

        // Check if battery save was marked pending and flush to storage
        if (this.gba && this.gba.mmu && this.gba.mmu.save && this.gba.mmu.save.writePending) {
          this.gba.mmu.save.writePending = false;
          storage.saveBattery(this.romId, this.gba.mmu.save.buffer);
        }

        // FPS Calculation
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
    if (this.gba) this.gba.pause();
  }

  resume() {
    if (!this.isRunning) {
      this.start();
    } else {
      this.isPaused = false;
      this.audioDriver.ensureContext();
      if (this.gba && this.gba.audio) {
        this.gba.audio.pause(false);
      }
    }
  }

  reset() {
    if (this.rom) {
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
    if (this.gba) this.gba.pause();
  }

  setSpeed(multiplier) {
    this.speed = Math.max(1, Math.min(16, multiplier));
    
    // Mute on Fast-Forward if enabled
    const shouldMute = (this.speed > 1 && this.audioDriver.muteOnFastForward);
    this.audioDriver.setMute(shouldMute);
    if (this.gba && this.gba.audio) {
      this.gba.audio.masterVolume = shouldMute ? 0 : this.audioDriver.volume;
    }
  }

  setFrameSkip(val) {
    this.frameSkip = val;
    this.frameSkipCounter = 0;
    storage.setSetting('frameskip', val);
  }

  // --- Controls ---
  setButton(button, isPressed) {
    const mask = 1 << button;
    
    // Send to mGBA Bridge
    this.mgbaBridge.setKey(mask, isPressed);

    // Send to legacy GBA keypad
    if (this.gba && this.gba.keypad) {
      if (isPressed) {
        this.gba.keypad.currentDown &= ~mask;
      } else {
        this.gba.keypad.currentDown |= mask;
      }
    }
  }

  // --- Save / Load States ---
  async saveState(slot = 1) {
    if (!this.romId) return false;

    // Capture screenshot directly from WebGL Canvas
    const screenshot = this.renderer.captureScreenshot();

    let stateBlob = null;
    if (this.gba && typeof Serializer !== 'undefined') {
      stateBlob = Serializer.serialize(this.gba.freeze());
    } else {
      const stateData = this.mgbaBridge.saveState();
      if (stateData) {
        stateBlob = new Blob([stateData], { type: 'application/octet-stream' });
      }
    }

    if (stateBlob) {
      await storage.saveState(this.romId, slot, stateBlob, screenshot);
      return true;
    }
    return false;
  }

  async loadState(slot = 1) {
    if (!this.romId) return false;

    const saved = await storage.loadState(this.romId, slot);
    if (!saved || !saved.data) return false;

    try {
      let stateData = saved.data;
      if (this.gba && typeof Serializer !== 'undefined') {
        if (stateData instanceof Blob) {
          stateData = await Serializer.deserializeAsync(stateData);
        } else if (stateData instanceof ArrayBuffer) {
          stateData = await Serializer.deserializeAsync(new Blob([stateData], { type: Serializer.TYPE }));
        }
        this.gba.defrost(stateData);
        return true;
      } else {
        const u8 = stateData instanceof Uint8Array ? stateData : new Uint8Array(await stateData.arrayBuffer());
        return this.mgbaBridge.loadState(u8);
      }
    } catch (e) {
      console.error('[GBAEngine] Error restoring save state:', e);
      return false;
    }
  }

  async exportStateData() {
    if (!this.romId) return "{}";
    const screenshot = this.renderer.captureScreenshot();
    let b64 = '';
    if (this.gba && typeof Serializer !== 'undefined') {
      const blob = Serializer.serialize(this.gba.freeze());
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      b64 = btoa(binary);
    }
    return JSON.stringify({
      romId: this.romId,
      romName: this.romName,
      timestamp: Date.now(),
      state: b64,
      thumbnail: screenshot
    });
  }

  async importStateData(jsonString) {
    try {
      const obj = JSON.parse(jsonString);
      if (!obj.state) return false;
      const binary = atob(obj.state);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      if (this.gba && typeof Serializer !== 'undefined') {
        const blob = new Blob([bytes], { type: Serializer.TYPE });
        const defrosted = await Serializer.deserializeAsync(blob);
        this.gba.defrost(defrosted);
        return true;
      }
      return false;
    } catch (e) {
      console.error('[GBAEngine] Error importing save state:', e);
      return false;
    }
  }
}
