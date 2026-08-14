/**
 * NekoAdvance - HUD & Toast Notifications
 */

export class HUD {
  constructor() {
    this.toastContainer = document.getElementById('toast-container');
    this.speedBadge = document.getElementById('speed-badge');
    this.fpsCounter = document.getElementById('fps-counter');
    this.powerLed = document.getElementById('power-led');
  }

  showToast(message, icon = '✨', duration = 3000) {
    if (!this.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span class="toast-icon">${icon}</span> <span>${message}</span>`;
    
    this.toastContainer.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  updateSpeedBadge(speed) {
    if (!this.speedBadge) return;
    if (speed > 1) {
      this.speedBadge.textContent = `⚡ ${speed}x`;
      this.speedBadge.classList.add('visible');
    } else {
      this.speedBadge.classList.remove('visible');
    }
  }

  updateFPS(fps) {
    if (this.fpsCounter) {
      this.fpsCounter.textContent = `fps: ${fps}`;
    }
  }

  setPowerLedState(state) {
    if (!this.powerLed) return;
    this.powerLed.className = 'power-led ' + state; // 'on', 'busy', 'off'
  }
}
