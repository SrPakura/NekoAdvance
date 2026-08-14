/**
 * NekoAdvance - Audio Driver
 * Handles Web Audio API output, ring buffering, dynamic volume, and fast-forward handling.
 */

export class AudioDriver {
  constructor() {
    this.audioContext = null;
    this.scriptNode = null;
    this.gainNode = null;
    this.sampleRate = 44100;
    this.bufferSize = 2048;
    
    // Stereo Ring Buffer
    this.bufferCapacity = 16384;
    this.leftBuffer = new Float32Array(this.bufferCapacity);
    this.rightBuffer = new Float32Array(this.bufferCapacity);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.samplesAvailable = 0;

    this.volume = 0.8;
    this.muted = false;
    this.fastForwardSpeed = 1;
    this.muteOnFastForward = true;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: this.sampleRate });
      
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.setValueAtTime(this.muted ? 0 : this.volume, this.audioContext.currentTime);

      // ScriptProcessor for continuous smooth low-latency streaming
      this.scriptNode = this.audioContext.createScriptProcessor(this.bufferSize, 0, 2);
      this.scriptNode.onaudioprocess = (e) => this.processAudio(e);

      this.scriptNode.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      this.initialized = true;
    } catch (e) {
      console.warn('Web Audio could not be initialized:', e);
    }
  }

  resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  pause() {
    if (this.audioContext && this.audioContext.state === 'running') {
      this.audioContext.suspend();
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.gainNode && !this.muted) {
      this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
    }
  }

  setMute(isMuted) {
    this.muted = isMuted;
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(this.muted ? 0 : this.volume, this.audioContext.currentTime);
    }
  }

  setFastForward(speed) {
    this.fastForwardSpeed = speed;
    if (this.gainNode) {
      if (speed > 1 && this.muteOnFastForward) {
        this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      } else {
        this.gainNode.gain.setValueAtTime(this.muted ? 0 : this.volume, this.audioContext.currentTime);
      }
    }
  }

  writeSamples(left, right, count) {
    if (!this.initialized || (this.fastForwardSpeed > 2 && this.muteOnFastForward)) {
      return;
    }

    for (let i = 0; i < count; i++) {
      if (this.samplesAvailable < this.bufferCapacity) {
        this.leftBuffer[this.writeIndex] = left[i];
        this.rightBuffer[this.writeIndex] = right[i];
        this.writeIndex = (this.writeIndex + 1) % this.bufferCapacity;
        this.samplesAvailable++;
      } else {
        // Buffer overflow: drop oldest
        this.readIndex = (this.readIndex + 1) % this.bufferCapacity;
        this.leftBuffer[this.writeIndex] = left[i];
        this.rightBuffer[this.writeIndex] = right[i];
        this.writeIndex = (this.writeIndex + 1) % this.bufferCapacity;
      }
    }
  }

  processAudio(event) {
    const outputLeft = event.outputBuffer.getChannelData(0);
    const outputRight = event.outputBuffer.getChannelData(1);
    const len = outputLeft.length;

    for (let i = 0; i < len; i++) {
      if (this.samplesAvailable > 0) {
        outputLeft[i] = this.leftBuffer[this.readIndex];
        outputRight[i] = this.rightBuffer[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.bufferCapacity;
        this.samplesAvailable--;
      } else {
        // Starvation: output silence
        outputLeft[i] = 0;
        outputRight[i] = 0;
      }
    }
  }

  clear() {
    this.writeIndex = 0;
    this.readIndex = 0;
    this.samplesAvailable = 0;
  }
}
