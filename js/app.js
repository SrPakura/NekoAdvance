/**
 * NekoAdvance - Main Application Bootstrap
 * Initializes the GBA Engine, Virtual Console UI, Retro Menu, Audio, and Drag-and-Drop.
 */

import { GBAEngine } from './core/gba-engine.js';
import { InputManager } from './input/input-manager.js';
import { ConsoleView } from './ui/console-view.js';
import { MenuModal } from './ui/menu-modal.js';
import { HUD } from './ui/hud.js';
import { storage } from './core/storage.js';
import { debugLogger } from './ui/debug-logger.js';

class NekoAdvanceApp {
  constructor() {
    this.canvas = document.getElementById('gba-canvas');
    this.dropOverlay = document.getElementById('drop-overlay');
    this.fileInput = document.getElementById('rom-file-input');

    this.engine = new GBAEngine(this.canvas);
    debugLogger.setEngine(this.engine);
    this.hud = new HUD();
    
    this.inputManager = new InputManager(this.engine, () => this.toggleMenu());
    this.consoleView = new ConsoleView(
      this.inputManager,
      () => this.toggleMenu(),
      () => this.menuModal.open('library')
    );

    this.menuModal = new MenuModal(
      this.engine,
      this.inputManager,
      this.hud,
      (buffer, name) => this.loadROM(buffer, name)
    );

    // Link InputManager with RetroMenu for hardware button navigation
    this.inputManager.setMenuHandler(this.menuModal);

    this.init();
  }

  async init() {
    // Setup Drag and Drop
    this.setupDragAndDrop();

    // FPS Loop update
    setInterval(() => {
      this.hud.updateFPS(this.engine.currentFPS);
      this.hud.setPowerLedState(this.engine.isRunning ? 'on' : 'off');
    }, 500);

    // Global User Interaction Listener to Unlock AudioContext
    const unlockAudio = () => {
      if (this.engine && this.engine.audioDriver) {
        this.engine.audioDriver.unlockAudio();
      }
    };
    ['pointerdown', 'keydown', 'touchstart', 'touchend', 'click'].forEach(evt => {
      window.addEventListener(evt, unlockAudio, { passive: true, capture: true });
    });

    // PWA Install Prompt handling
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.deferredInstallPrompt = e;
    });

    window.addEventListener('appinstalled', () => {
      window.deferredInstallPrompt = null;
      this.hud.showToast('¡NekoAdvance instalado con éxito!', '🐾');
    });

    // Setup Rolling-Release Service Worker (PWA Auto-Update in background)
    this.setupRollingReleaseServiceWorker();

    // Load Last Played Game or Show Library
    const roms = await storage.getAllROMs();
    if (roms.length > 0) {
      roms.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
      const lastRom = roms[0];
      this.hud.showToast(`Bienvenido. Último juego: ${lastRom.name}`, '🐾');
    }
  }

  async loadROM(buffer, name) {
    this.hud.setPowerLedState('busy');
    try {
      const romId = await this.engine.loadROM(buffer, name);
      this.consoleView.setGameLoaded(true);
      this.hud.showToast(`Cargado: ${name}`, '🎮');
    } catch (e) {
      console.error('Error loading ROM:', e);
      this.hud.showToast('Error al cargar la ROM', '❌');
    } finally {
      this.hud.setPowerLedState('on');
    }
  }

  toggleMenu() {
    if (this.menuModal.isOpen) {
      this.menuModal.close();
    } else {
      const defaultTab = this.engine.isRunning ? 'states' : 'library';
      this.menuModal.open(defaultTab);
    }
  }

  setupDragAndDrop() {
    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (this.dropOverlay) this.dropOverlay.classList.add('active');
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0 && this.dropOverlay) {
        this.dropOverlay.classList.remove('active');
      }
    });

    window.addEventListener('dragover', (e) => e.preventDefault());

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      if (this.dropOverlay) this.dropOverlay.classList.remove('active');

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.gba') || file.name.endsWith('.bin') || file.name.endsWith('.agb') || file.name.endsWith('.zip')) {
          this.menuModal.handleFile(file);
        } else {
          this.hud.showToast('Por favor arrastra un archivo de GBA (.gba, .bin, .zip)', '⚠️');
        }
      }
    });
  }

  setupRollingReleaseServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.location.protocol.startsWith('http')) {
      return;
    }

    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        console.log('[PWA] Service Worker registered in rolling release mode');

        // Check for updates on startup
        reg.update().catch(() => {});

        // Check for updates in background every 10 minutes
        setInterval(() => {
          reg.update().catch(() => {});
        }, 10 * 60 * 1000);

        // Check for updates when user returns to app tab / window
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            reg.update().catch(() => {});
          }
        });

        // Check for updates when coming back online
        window.addEventListener('online', () => {
          reg.update().catch(() => {});
        });

        // Detect new worker installed in background
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[PWA] New version installed in background');
              this.hud.showToast('¡Nueva versión actualizada en segundo plano!', '🚀');
            }
          });
        });
      })
      .catch((err) => console.warn('[PWA] SW registration failed:', err));

    // Handle controller takeover cleanly
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[PWA] Active controller updated to latest release');
      }
    });
  }
}

// Start Application on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new NekoAdvanceApp();
});
