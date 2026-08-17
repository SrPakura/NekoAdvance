/**
 * NekoAdvance - HUD & Toast Notifications
 */

export class HUD {
  constructor() {
    this.toastContainer = document.getElementById('toast-container');
    this.fpsCounter = document.getElementById('fps-counter');
    this.powerLed = document.getElementById('power-led');
    this.currentSpeed = 1;
    this.currentFPS = 0;
  }

  showToast(message, icon = '', duration = 3000) {
    if (!this.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    const iconHtml = icon ? `<span class="toast-icon">${icon}</span>` : '';
    toast.innerHTML = `${iconHtml}<span>${message}</span>`;
    
    this.toastContainer.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  updateSpeedBadge(speed) {
    this.currentSpeed = speed;
    this.updateFPS(this.currentFPS, speed);
  }

  updateFPS(fps, speed = this.currentSpeed) {
    this.currentFPS = fps;
    this.currentSpeed = speed;
    if (this.fpsCounter) {
      const speedText = speed > 1 ? ` (x${speed})` : '';
      this.fpsCounter.textContent = `fps: ${fps}${speedText}`;
    }
  }

  setPowerLedState(state) {
    if (!this.powerLed) return;
    this.powerLed.className = 'power-led ' + state; // 'on', 'busy', 'off'
  }
}
