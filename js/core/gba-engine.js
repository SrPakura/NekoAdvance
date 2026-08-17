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
  constructor(canvas, hud = null) {
    this.canvas = canvas;
    this.hud = hud;
    
    // Hardware WebGL2 Renderer with Retro Shaders
    this.renderer = new WebGLRenderer(canvas);
    
    // Audio Subsystem (Native GBA ~32,768 Hz Audio Clock)
    this.audioDriver = new AudioDriver(32768, 2048);

    // Core Bridges
    this.mgbaBridge = new MGBABridge();
    this.gba = null; // Fallback instance if needed

    this.rom = null;
    this.romName = '';
    this.romId = '';
    this.isRunning = false;
    this.isPaused = false;
    this.useMgba = true;

    this.speed = 1;
    this.frameSkip = 'auto';
    this.frameSkipCounter = 0;
    this.currentFPS = 0;
    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.lastSaveToastTime = 0;
    this.animFrameId = null;

    // Framebuffer storage (240x160 RGBA = 153,600 bytes)
    this.pixelBuffer = new Uint8Array(240 * 160 * 4);

    this.initSettings();
    this.initCore();
  }

  setHUD(hud) {
    this.hud = hud;
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

    const savedVol = await storage.getSetting('volume');
    if (savedVol !== null && savedVol !== undefined) {
      this.audioDriver.setVolume(savedVol);
    }
  }

  async initCore() {
    try {
      await this.mgbaBridge.init();
    } catch (e) {
      console.warn('[GBAEngine] mGBA WASM init note:', e);
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
    this.romId = name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');

    // Ensure mGBA WASM is ready
    await this.mgbaBridge.init();

    // 1. Primary Engine: mGBA WebAssembly
    const mgbaSuccess = await this.mgbaBridge.loadROM(arrayBuffer, name);
    if (mgbaSuccess) {
      this.useMgba = true;
      console.log('[GBAEngine] Game loaded in mGBA WebAssembly Core:', name);
    } else {
      // 2. Fallback Engine with offscreen buffer
      this.useMgba = false;
      const GBAClass = window.GameBoyAdvance || (typeof GameBoyAdvance !== 'undefined' ? GameBoyAdvance : null);
      if (typeof GBAClass === 'function') {
        this.gba = new GBAClass();
        // Create an offscreen canvas to avoid WebGL2 context collisions
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = 240;
        offscreenCanvas.height = 160;
        this.gba.setCanvas(offscreenCanvas);
        this.gba.setRom(arrayBuffer);
        if (this.gba.audio) {
          this.gba.audio.masterVolume = this.audioDriver.volume;
        }
      }
    }

    // Load Saved Battery (.sav / Flash 128K / SRAM) from IndexedDB
    const savedBattery = await storage.loadBattery(this.romId);
    if (savedBattery && savedBattery.byteLength > 0) {
      try {
        if (this.useMgba) {
          this.mgbaBridge.loadSaveData(new Uint8Array(savedBattery));
        } else if (this.gba) {
          this.gba.setSavedata(savedBattery);
        }
      } catch (e) {
        console.warn('[GBAEngine] Could not restore battery save:', e);
      }
    }

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
          if (this.useMgba && this.mgbaBridge.isRomLoaded) {
            const buf = this.mgbaBridge.runFrame();
            if (buf) this.pixelBuffer = buf;

            const audioSamples = this.mgbaBridge.getAudioSamples();
            if (audioSamples && audioSamples.length > 0) {
              const currentRate = this.mgbaBridge.getAudioSampleRate();
              if (currentRate && currentRate !== this.audioDriver.sourceSampleRate) {
                this.audioDriver.setSourceSampleRate(currentRate);
              }
              this.audioDriver.writeSamples(audioSamples);
            }
          } else if (this.gba) {
            this.gba.advanceFrame();
            if (this.gba.video && this.gba.video.renderPath && this.gba.video.renderPath.pixelData) {
              this.pixelBuffer = this.gba.video.renderPath.pixelData.data;
            }
          }

          this.frameCount++;
        }

        // Render Frame using Hardware WebGL2 with Retro Shaders
        if (this.pixelBuffer) {
          this.renderer.renderFrame(this.pixelBuffer);
        }

        // Instant in-game save detection & persistence
        if (this.useMgba) {
          if (this.mgbaBridge.isSaveDirty()) {
            this.flushSave();
            if (now - this.lastSaveToastTime > 3000) {
              this.lastSaveToastTime = now;
              if (this.hud && typeof this.hud.showToast === 'function') {
                this.hud.showToast('Partida guardada', '💾');
              }
            }
          } else if (this.frameCount % 300 === 0 && this.frameCount > 0) {
            this.flushSave();
          }
        } else if (this.gba && this.gba.mmu && this.gba.mmu.save && this.gba.mmu.save.writePending) {
          this.flushSave();
          if (now - this.lastSaveToastTime > 3000) {
            this.lastSaveToastTime = now;
            if (this.hud && typeof this.hud.showToast === 'function') {
              this.hud.showToast('Partida guardada', '💾');
            }
          }
        }

        if (accumulatedTime > FRAME_DURATION * 2) {
          accumulatedTime = 0;
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

  async flushSave() {
    if (!this.romId) return false;
    try {
      if (this.useMgba && this.mgbaBridge.isRomLoaded) {
        const currentSave = this.mgbaBridge.getSaveData();
        if (currentSave && currentSave.length > 0) {
          await storage.saveBattery(this.romId, currentSave.buffer);
          this.mgbaBridge.clearSaveDirty();
          return true;
        }
      } else if (this.gba && this.gba.mmu && this.gba.mmu.save) {
        this.gba.mmu.save.writePending = false;
        await storage.saveBattery(this.romId, this.gba.mmu.save.buffer);
        return true;
      }
    } catch (e) {
      console.warn('[GBAEngine] flushSave error:', e);
    }
    return false;
  }

  pause() {
    this.isPaused = true;
    this.flushSave();
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

  async reset() {
    if (this.rom) {
      await this.flushSave();
      this.stop();
      await this.loadROM(this.rom, this.romName);
    }
  }

  stop() {
    this.flushSave();
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
    if (isPressed) {
      this.audioDriver.ensureContext();
    }
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
    if (this.useMgba) {
      const stateData = this.mgbaBridge.saveState();
      if (stateData) {
        stateBlob = new Blob([stateData], { type: 'application/octet-stream' });
      }
    } else if (this.gba && typeof Serializer !== 'undefined') {
      stateBlob = Serializer.serialize(this.gba.freeze());
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
      if (this.useMgba) {
        const u8 = stateData instanceof Uint8Array ? stateData : new Uint8Array(await stateData.arrayBuffer());
        return this.mgbaBridge.loadState(u8);
      } else if (this.gba && typeof Serializer !== 'undefined') {
        if (stateData instanceof Blob) {
          stateData = await Serializer.deserializeAsync(stateData);
        } else if (stateData instanceof ArrayBuffer) {
          stateData = await Serializer.deserializeAsync(new Blob([stateData], { type: Serializer.TYPE }));
        }
        this.gba.defrost(stateData);
        return true;
      }
      return false;
    } catch (e) {
      console.error('[GBAEngine] Error restoring save state:', e);
      return false;
    }
  }

  async exportStateData() {
    if (!this.romId) return "{}";
    const screenshot = this.renderer.captureScreenshot();
    let b64 = '';
    if (this.useMgba) {
      const stateData = this.mgbaBridge.saveState();
      if (stateData) {
        let binary = '';
        for (let i = 0; i < stateData.byteLength; i++) {
          binary += String.fromCharCode(stateData[i]);
        }
        b64 = btoa(binary);
      }
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
      if (this.useMgba) {
        return this.mgbaBridge.loadState(bytes);
      }
      return false;
    } catch (e) {
      console.error('[GBAEngine] Error importing save state:', e);
      return false;
    }
  }
}
