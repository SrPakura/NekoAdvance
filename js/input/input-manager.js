/**
 * NekoAdvance - Input Manager
 * Handles multi-touch virtual controls, keyboard events, and Gamepad API polling.
 * Integrates directly with the In-Screen Retro Menu when opened.
 */

import { GBA_BUTTONS } from '../core/gba-engine.js';
import { DEFAULT_KEYBOARD_MAP, DEFAULT_GAMEPAD_MAP } from './keybindings.js';
import { storage } from '../core/storage.js';

export class InputManager {
  constructor(engine, onMenuTrigger) {
    this.engine = engine;
    this.onMenuTrigger = onMenuTrigger;
    this.menuHandler = null;

    this.keyboardMap = { ...DEFAULT_KEYBOARD_MAP };
    this.gamepadMap = { ...DEFAULT_GAMEPAD_MAP };
    this.hapticEnabled = true;

    // Fast-Forward key hold state (Space bar)
    this.isFastForwardHeld = false;
    this.originalSpeed = 1;

    this.init();
  }

  setMenuHandler(handler) {
    this.menuHandler = handler;
  }

  async init() {
    // Load custom keybindings from storage
    const savedKeys = await storage.getSetting('keybindings');
    if (savedKeys) {
      this.keyboardMap = { ...this.keyboardMap, ...savedKeys };
    }

    const savedHaptic = await storage.getSetting('haptic');
    if (savedHaptic !== null) {
      this.hapticEnabled = savedHaptic;
    }

    this.setupKeyboardListeners();
    this.setupGamepadPolling();
  }

  // --- Keyboard Listeners ---
  setupKeyboardListeners() {
    window.addEventListener('keydown', (e) => {
      if (this.engine && this.engine.audioDriver) {
        this.engine.audioDriver.unlockAudio();
      }

      // Avoid handling keys when typing in an input/textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }

      // Fast-forward hold (Space bar)
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (!this.isFastForwardHeld) {
          this.isFastForwardHeld = true;
          this.originalSpeed = this.engine.speed;
          this.engine.setSpeed(4);
        }
        return;
      }

      // Menu Toggle (Escape)
      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.onMenuTrigger) this.onMenuTrigger();
        return;
      }

      // Quick Save (F5) / Quick Load (F8)
      if (e.code === 'F5') {
        e.preventDefault();
        this.engine.saveState(1);
        return;
      }
      if (e.code === 'F8') {
        e.preventDefault();
        this.engine.loadState(1);
        return;
      }

      // If Retro Menu is open, route navigation directly
      if (this.menuHandler && this.menuHandler.isOpen) {
        // Universal Arrow Keys support
        if (e.code === 'ArrowUp') { e.preventDefault(); this.menuHandler.handleButton(GBA_BUTTONS.UP, true); return; }
        if (e.code === 'ArrowDown') { e.preventDefault(); this.menuHandler.handleButton(GBA_BUTTONS.DOWN, true); return; }
        if (e.code === 'ArrowLeft') { e.preventDefault(); this.menuHandler.handleButton(GBA_BUTTONS.LEFT, true); return; }
        if (e.code === 'ArrowRight') { e.preventDefault(); this.menuHandler.handleButton(GBA_BUTTONS.RIGHT, true); return; }
        if (e.code === 'Enter') { e.preventDefault(); this.menuHandler.handleButton(GBA_BUTTONS.A, true); return; }
        if (e.code === 'Backspace') { e.preventDefault(); this.menuHandler.handleButton(GBA_BUTTONS.B, true); return; }
        if (e.code === 'PageUp' || e.code === 'KeyQ') { e.preventDefault(); this.menuHandler.handleButton(GBA_BUTTONS.L, true); return; }
        if (e.code === 'PageDown' || e.code === 'KeyE') { e.preventDefault(); this.menuHandler.handleButton(GBA_BUTTONS.R, true); return; }

        // Check GBA configured keys
        for (const [btn, key] of Object.entries(this.keyboardMap)) {
          if (e.code === key) {
            e.preventDefault();
            const gbaBtn = parseInt(btn, 10);
            this.menuHandler.handleButton(gbaBtn, true);
            this.highlightVirtualButton(gbaBtn, true);
            return;
          }
        }
        return;
      }

      // Normal gameplay input
      for (const [btn, key] of Object.entries(this.keyboardMap)) {
        if (e.code === key) {
          e.preventDefault();
          const gbaBtn = parseInt(btn, 10);
          this.engine.setButton(gbaBtn, true);
          this.highlightVirtualButton(gbaBtn, true);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }

      // Release Fast-forward hold
      if (e.code === 'Space') {
        e.preventDefault();
        this.isFastForwardHeld = false;
        this.engine.setSpeed(this.originalSpeed);
        return;
      }

      for (const [btn, key] of Object.entries(this.keyboardMap)) {
        if (e.code === key) {
          e.preventDefault();
          const gbaBtn = parseInt(btn, 10);
          if (!this.menuHandler || !this.menuHandler.isOpen) {
            this.engine.setButton(gbaBtn, false);
          }
          this.highlightVirtualButton(gbaBtn, false);
        }
      }
    });
  }

  // --- Multi-Touch & Pointer Virtual Controls ---
  bindVirtualButton(element, gbaButton) {
    if (!element) return;

    const press = (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (this.engine && this.engine.audioDriver) {
        this.engine.audioDriver.unlockAudio();
      }

      if (this.menuHandler && this.menuHandler.isOpen) {
        this.menuHandler.handleButton(gbaButton, true);
      } else {
        this.engine.setButton(gbaButton, true);
      }

      element.classList.add('active');
      this.vibrate();
    };

    const release = (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!this.menuHandler || !this.menuHandler.isOpen) {
        this.engine.setButton(gbaButton, false);
      }
      element.classList.remove('active');
    };

    element.addEventListener('pointerdown', press);
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('pointerleave', release);
  }

  // Highlight physical virtual button on keyboard/gamepad press
  highlightVirtualButton(button, isPressed) {
    const selectorMap = {
      [GBA_BUTTONS.A]: '.btn-a',
      [GBA_BUTTONS.B]: '.btn-b',
      [GBA_BUTTONS.UP]: '.dpad-up',
      [GBA_BUTTONS.DOWN]: '.dpad-down',
      [GBA_BUTTONS.LEFT]: '.dpad-left',
      [GBA_BUTTONS.RIGHT]: '.dpad-right',
      [GBA_BUTTONS.START]: '#btn-start',
      [GBA_BUTTONS.SELECT]: '#btn-select',
      [GBA_BUTTONS.L]: '#trigger-l',
      [GBA_BUTTONS.R]: '#trigger-r'
    };

    const sel = selectorMap[button];
    if (sel) {
      const el = document.querySelector(sel);
      if (el) {
        if (isPressed) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      }
    }
  }

  // --- Gamepad API Polling ---
  setupGamepadPolling() {
    let lastGamepadState = {};

    const pollGamepads = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads[0];

      if (gp && gp.connected) {
        for (const [gpIndex, gbaButton] of Object.entries(this.gamepadMap)) {
          const btn = gp.buttons[parseInt(gpIndex, 10)];
          const isPressed = btn && (btn.pressed || btn.value > 0.5);
          const wasPressed = lastGamepadState[gpIndex];

          if (isPressed !== wasPressed) {
            if (this.menuHandler && this.menuHandler.isOpen) {
              if (isPressed) {
                this.menuHandler.handleButton(gbaButton, true);
              }
            } else {
              this.engine.setButton(gbaButton, isPressed);
            }
            this.highlightVirtualButton(gbaButton, isPressed);
            lastGamepadState[gpIndex] = isPressed;
            if (isPressed) this.vibrate();
          }
        }

        // Left Analog Stick for D-Pad
        const axisX = gp.axes[0] || 0;
        const axisY = gp.axes[1] || 0;
        const threshold = 0.5;

        const leftPressed = axisX < -threshold;
        const rightPressed = axisX > threshold;
        const upPressed = axisY < -threshold;
        const downPressed = axisY > threshold;

        const handleAxis = (btn, pressed, stateKey) => {
          if (pressed !== lastGamepadState[stateKey]) {
            if (this.menuHandler && this.menuHandler.isOpen) {
              if (pressed) this.menuHandler.handleButton(btn, true);
            } else {
              this.engine.setButton(btn, pressed);
            }
            this.highlightVirtualButton(btn, pressed);
            lastGamepadState[stateKey] = pressed;
          }
        };

        handleAxis(GBA_BUTTONS.LEFT, leftPressed, 'axis_left');
        handleAxis(GBA_BUTTONS.RIGHT, rightPressed, 'axis_right');
        handleAxis(GBA_BUTTONS.UP, upPressed, 'axis_up');
        handleAxis(GBA_BUTTONS.DOWN, downPressed, 'axis_down');
      }

      requestAnimationFrame(pollGamepads);
    };

    requestAnimationFrame(pollGamepads);
  }

  // --- Haptic Feedback ---
  vibrate(duration = 12) {
    if (this.hapticEnabled && navigator.vibrate) {
      try {
        navigator.vibrate(duration);
      } catch (e) {}
    }
  }

  setHapticEnabled(val) {
    this.hapticEnabled = val;
    storage.setSetting('haptic', val);
  }
}
