/**
 * NekoAdvance - Console View
 * Manages the interactive Cat console, screen alignment, and binds virtual controls.
 */

import { GBA_BUTTONS } from '../core/gba-engine.js';

export class ConsoleView {
  constructor(inputManager, onMenuOpen, onFileSelect) {
    this.inputManager = inputManager;
    this.onMenuOpen = onMenuOpen;
    this.onFileSelect = onFileSelect;

    this.screenViewport = document.getElementById('screen-viewport');
    this.screenPlaceholder = document.getElementById('screen-placeholder');
    this.loadRomBtn = document.getElementById('load-rom-btn');
    this.noseMenuBtn = document.getElementById('btn-nose');
    this.triggerL = document.getElementById('trigger-l');
    this.triggerR = document.getElementById('trigger-r');

    this.bindControls();
  }

  bindControls() {
    // Ear Triggers (L and R)
    this.inputManager.bindVirtualButton(this.triggerL, GBA_BUTTONS.L);
    this.inputManager.bindVirtualButton(this.triggerR, GBA_BUTTONS.R);

    // D-Pad
    this.inputManager.bindVirtualButton(document.querySelector('.dpad-up'), GBA_BUTTONS.UP);
    this.inputManager.bindVirtualButton(document.querySelector('.dpad-down'), GBA_BUTTONS.DOWN);
    this.inputManager.bindVirtualButton(document.querySelector('.dpad-left'), GBA_BUTTONS.LEFT);
    this.inputManager.bindVirtualButton(document.querySelector('.dpad-right'), GBA_BUTTONS.RIGHT);

    // Action Buttons (A and B)
    this.inputManager.bindVirtualButton(document.querySelector('.btn-a'), GBA_BUTTONS.A);
    this.inputManager.bindVirtualButton(document.querySelector('.btn-b'), GBA_BUTTONS.B);

    // System Buttons (Start and Select)
    this.inputManager.bindVirtualButton(document.getElementById('btn-start'), GBA_BUTTONS.START);
    this.inputManager.bindVirtualButton(document.getElementById('btn-select'), GBA_BUTTONS.SELECT);

    // Nose Button -> Opens Menu Modal / Pause
    if (this.noseMenuBtn) {
      const handleNoseClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.noseMenuBtn.classList.add('active');
        setTimeout(() => this.noseMenuBtn.classList.remove('active'), 180);
        this.inputManager.vibrate(25);
        if (this.onMenuOpen) this.onMenuOpen();
      };
      this.noseMenuBtn.addEventListener('pointerdown', handleNoseClick);
    }

    // Screen Placeholder Click -> Load ROM / Open Library
    if (this.loadRomBtn) {
      this.loadRomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onFileSelect) this.onFileSelect();
      });
    }

    if (this.screenPlaceholder) {
      this.screenPlaceholder.addEventListener('click', () => {
        if (this.onFileSelect) this.onFileSelect();
      });
    }
  }

  setGameLoaded(loaded) {
    if (this.screenPlaceholder) {
      if (loaded) {
        this.screenPlaceholder.classList.add('hidden');
      } else {
        this.screenPlaceholder.classList.remove('hidden');
      }
    }
  }

  toggleScanlines(enabled) {
    if (this.screenViewport) {
      if (enabled) {
        this.screenViewport.classList.remove('no-scanlines');
      } else {
        this.screenViewport.classList.add('no-scanlines');
      }
    }
  }
}
