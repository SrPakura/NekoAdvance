/**
 * NekoAdvance - Ultra-Low-Latency High-Fidelity Audio Driver
 * Features:
 * - Dual Engine Architecture: Modern AudioWorklet (Dedicated Audio Thread) + ScriptProcessor Fallback
 * - GBA Native 32,768 Hz dynamic resampling with sub-sample linear interpolation
 * - Dynamic Elastic Buffering / Adaptive Clock Drift (eliminates underruns & crackling on mobile)
 * - Mobile-first AudioContext auto-unlock & lifecycle management (Android Chrome / iOS WebKit)
 * - Real-time Audio & Hardware Diagnostics with VU Meter integration
 */

// AudioWorklet Processor source code as an embedded string
const AUDIO_WORKLET_CODE = `
class NekoAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringCapacity = 65536;
    this.ringBufferL = new Float32Array(this.ringCapacity);
    this.ringBufferR = new Float32Array(this.ringCapacity);
    this.writePtr = 0;
    this.readPtr = 0;
    this.availableSamples = 0;

    this.sourceSampleRate = 32768; // GBA native audio clock
    this.resamplePhase = 0;
    this.volume = 0.8;
    this.isMuted = false;

    this.underruns = 0;
    this.samplesWritten = 0;
    this.samplesRead = 0;
    this.peakVolume = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;

      if (msg.type === 'samples') {
        this.writeSamples(msg.samples, msg.isInt16);
      } else if (msg.type === 'volume') {
        this.volume = msg.volume;
      } else if (msg.type === 'mute') {
        this.isMuted = msg.isMuted;
      } else if (msg.type === 'sourceRate') {
        this.sourceSampleRate = msg.rate;
      } else if (msg.type === 'clear') {
        this.clear();
      }
    };
  }

  writeSamples(samples, isInt16) {
    if (!samples || samples.length === 0) return;
    const count = samples.length >> 1; // Stereo pairs
    // GBA audio synthesis produces samples in the -384 to +384 range
    const norm = isInt16 ? (1.0 / 384.0) : 1.0;

    let peak = 0;
    for (let i = 0; i < count; i++) {
      const idx = i << 1;
      let left = samples[idx] * norm;
      let right = samples[idx + 1] * norm;

      // Soft clamp to [-1.0, 1.0]
      if (left > 1.0) left = 1.0;
      else if (left < -1.0) left = -1.0;
      if (right > 1.0) right = 1.0;
      else if (right < -1.0) right = -1.0;

      const absL = Math.abs(left);
      const absR = Math.abs(right);
      if (absL > peak) peak = absL;
      if (absR > peak) peak = absR;

      this.ringBufferL[this.writePtr] = left;
      this.ringBufferR[this.writePtr] = right;
      this.writePtr = (this.writePtr + 1) % this.ringCapacity;

      if (this.availableSamples < this.ringCapacity) {
        this.availableSamples++;
      } else {
        // Overflow: advance read pointer
        this.readPtr = (this.readPtr + 1) % this.ringCapacity;
      }
    }

    this.samplesWritten += count;
    this.peakVolume = peak;
  }

  clear() {
    this.writePtr = 0;
    this.readPtr = 0;
    this.availableSamples = 0;
    this.resamplePhase = 0;
    this.ringBufferL.fill(0);
    this.ringBufferR.fill(0);
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outputL = output[0];
    const outputR = output.length > 1 ? output[1] : output[0];
    const length = outputL.length;

    if (this.isMuted || this.volume <= 0.001) {
      outputL.fill(0);
      if (output.length > 1) outputR.fill(0);
      return true;
    }

    const vol = this.volume;
    const targetRate = sampleRate; // Global AudioWorklet hardware sampleRate (e.g. 48000 or 44100)

    // Dynamic Elastic Buffering: adjust consumption speed to prevent buffer underrun/overflow
    let speedAdjustment = 1.0;
    if (this.availableSamples < 1200) {
      // Buffer is getting low: slightly decelerate consumption to avoid dropouts
      speedAdjustment = 0.985;
    } else if (this.availableSamples > 3500) {
      // Buffer is getting full: slightly accelerate consumption to reduce latency
      speedAdjustment = 1.015;
    }

    const resampleStep = (this.sourceSampleRate / targetRate) * speedAdjustment;

    let currentPeak = 0;

    for (let i = 0; i < length; i++) {
      if (this.availableSamples >= 2) {
        const idxA = this.readPtr;
        const idxB = (this.readPtr + 1) % this.ringCapacity;
        const frac = this.resamplePhase;

        // High quality sub-sample linear interpolation
        const left = (this.ringBufferL[idxA] * (1 - frac) + this.ringBufferL[idxB] * frac) * vol;
        const right = (this.ringBufferR[idxA] * (1 - frac) + this.ringBufferR[idxB] * frac) * vol;

        outputL[i] = left;
        outputR[i] = right;

        const absL = Math.abs(left);
        const absR = Math.abs(right);
        if (absL > currentPeak) currentPeak = absL;
        if (absR > currentPeak) currentPeak = absR;

        this.resamplePhase += resampleStep;
        while (this.resamplePhase >= 1.0) {
          this.resamplePhase -= 1.0;
          this.readPtr = (this.readPtr + 1) % this.ringCapacity;
          this.availableSamples--;
          this.samplesRead++;
          if (this.availableSamples <= 0) break;
        }
      } else {
        // Buffer starvation
        outputL[i] = 0;
        outputR[i] = 0;
        this.underruns++;
      }
    }

    this.peakVolume = currentPeak;

    // Report diagnostics periodically (~10 times per sec)
    if (Math.random() < 0.05) {
      this.port.postMessage({
        type: 'stats',
        availableSamples: this.availableSamples,
        underruns: this.underruns,
        samplesWritten: this.samplesWritten,
        samplesRead: this.samplesRead,
        peakVolume: this.peakVolume,
        speedAdjustment
      });
    }

    return true;
  }
}

registerProcessor('neko-audio-processor', NekoAudioProcessor);
`;

export class AudioDriver {
  constructor(sourceSampleRate = 32768, bufferSize = 2048) {
    this.sourceSampleRate = sourceSampleRate; // GBA native ~32768 Hz
    this.bufferSize = bufferSize;
    this.ctx = null;
    this.workletNode = null;
    this.scriptNode = null;
    this.gainNode = null;
    this.isWorkletActive = false;

    this.volume = 0.8;
    this.muteOnFastForward = true;
    this.isMuted = false;

    // Fallback Ring Buffer for ScriptProcessor
    this.ringCapacity = 65536;
    this.ringBufferL = new Float32Array(this.ringCapacity);
    this.ringBufferR = new Float32Array(this.ringCapacity);
    this.writePtr = 0;
    this.readPtr = 0;
    this.availableSamples = 0;
    this.resamplePhase = 0;

    // Diagnostics & VU Meter tracking
    this.stats = {
      mode: 'Initializing...',
      contextState: 'uninitialized',
      hardwareSampleRate: 0,
      sourceSampleRate: this.sourceSampleRate,
      availableSamples: 0,
      bufferMs: 0,
      underruns: 0,
      samplesWritten: 0,
      samplesRead: 0,
      peakVolume: 0,
      speedAdjustment: 1.0,
      lastWriteTime: 0,
      writesPerSec: 0
    };

    this._writeCounter = 0;
    this._lastFpsTimer = performance.now();

    // Auto-setup lifecycle listeners
    this.setupLifecycleListeners();
  }

  setupLifecycleListeners() {
    // Resume audio context whenever user interacts or page gains visibility
    const autoResume = () => this.unlockAudio();

    ['touchstart', 'touchend', 'pointerdown', 'keydown', 'click'].forEach(evt => {
      window.addEventListener(evt, autoResume, { passive: true, capture: true });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.unlockAudio();
      }
    });

    window.addEventListener('focus', () => {
      this.unlockAudio();
    });
  }

  async ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        console.error('[AudioDriver] Web Audio API is not supported in this browser');
        this.stats.mode = 'Web Audio Unsupported';
        return;
      }

      try {
        this.ctx = new AudioCtx({ latencyHint: 'interactive' });
      } catch (e) {
        this.ctx = new AudioCtx();
      }

      this.stats.hardwareSampleRate = this.ctx.sampleRate;
      this.stats.contextState = this.ctx.state;
      console.log(`[AudioDriver] AudioContext created. SampleRate: ${this.ctx.sampleRate} Hz | State: ${this.ctx.state}`);

      await this.initPipeline();
    }

    if (this.ctx && (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted')) {
      try {
        await this.ctx.resume();
        this.stats.contextState = this.ctx.state;
        console.log('[AudioDriver] AudioContext resumed successfully -> state:', this.ctx.state);
      } catch (err) {
        console.warn('[AudioDriver] AudioContext resume error:', err);
      }
    }
  }

  async unlockAudio() {
    await this.ensureContext();
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.stats.contextState = this.ctx.state;

      // Play a 1-sample silent buffer to reliably unlock hardware audio output on Android & iOS
      try {
        const silent = this.ctx.createBuffer(1, 1, 22050);
        const src = this.ctx.createBufferSource();
        src.buffer = silent;
        src.connect(this.ctx.destination);
        src.start(0);
      } catch (e) {}
    }
  }

  async initPipeline() {
    if (!this.ctx) return;

    // Master Gain Node
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
    this.gainNode.connect(this.ctx.destination);

    // Try AudioWorklet first unless forceScriptProcessor is active
    let workletSuccess = false;
    if (!this.forceScriptProcessor && typeof AudioWorkletNode !== 'undefined' && this.ctx.audioWorklet) {
      try {
        const blob = new Blob([AUDIO_WORKLET_CODE], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        await this.ctx.audioWorklet.addModule(blobUrl);
        URL.revokeObjectURL(blobUrl);

        this.workletNode = new AudioWorkletNode(this.ctx, 'neko-audio-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });

        this.workletNode.port.onmessage = (e) => {
          if (e.data && e.data.type === 'stats') {
            this.stats.availableSamples = e.data.availableSamples;
            this.stats.underruns = e.data.underruns;
            this.stats.samplesWritten = e.data.samplesWritten;
            this.stats.samplesRead = e.data.samplesRead;
            this.stats.peakVolume = e.data.peakVolume;
            this.stats.speedAdjustment = e.data.speedAdjustment;
            this.stats.bufferMs = Math.round((e.data.availableSamples / this.sourceSampleRate) * 1000);
          }
        };

        this.workletNode.connect(this.gainNode);
        this.isWorkletActive = true;
        this.stats.mode = 'AudioWorklet (Dedicated Audio Thread)';
        console.log('[AudioDriver] 🚀 AudioWorklet pipeline initialized successfully.');
        workletSuccess = true;
      } catch (err) {
        console.warn('[AudioDriver] AudioWorklet init failed, falling back to ScriptProcessor:', err);
      }
    }

    // Fallback to resilient ScriptProcessorNode if AudioWorklet unavailable
    if (!workletSuccess) {
      try {
        // Standard generator node: 0 inputs, 2 outputs
        this.scriptNode = this.ctx.createScriptProcessor(this.bufferSize, 0, 2);
        this.scriptNode.onaudioprocess = (e) => this.processScriptAudio(e);
        this.scriptNode.connect(this.gainNode);
        this.isWorkletActive = false;
        this.stats.mode = 'ScriptProcessor (Direct WebAudio Fallback)';
        console.log('[AudioDriver] ⚙️ ScriptProcessor pipeline initialized.');
      } catch (err) {
        console.error('[AudioDriver] Failed to create audio processor:', err);
        this.stats.mode = 'Pipeline Error';
      }
    }
  }

  /**
   * Push interleaved stereo PCM samples (L, R, L, R...) into Audio Pipeline
   * @param {Float32Array|Int16Array} samples 
   */
  writeSamples(samples) {
    if (!samples || samples.length === 0) return;

    this.stats.lastWriteTime = performance.now();
    this._writeCounter++;

    const now = performance.now();
    if (now - this._lastFpsTimer >= 1000) {
      this.stats.writesPerSec = this._writeCounter;
      this._writeCounter = 0;
      this._lastFpsTimer = now;
      if (this.ctx) this.stats.contextState = this.ctx.state;
    }

    const count = samples.length >> 1;
    const isInt16 = samples instanceof Int16Array;
    const norm = isInt16 ? (1.0 / 384.0) : 1.0;

    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const val = Math.min(1.0, Math.abs(samples[i]) * norm);
      if (val > peak) peak = val;
    }
    this.stats.peakVolume = peak;

    if (this.isWorkletActive && this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'samples',
        samples: samples,
        isInt16: isInt16
      });
      return;
    }

    // ScriptProcessor Ring Buffer Push
    for (let i = 0; i < count; i++) {
      const idx = i << 1;
      let left = samples[idx] * norm;
      let right = samples[idx + 1] * norm;

      if (left > 1.0) left = 1.0;
      else if (left < -1.0) left = -1.0;
      if (right > 1.0) right = 1.0;
      else if (right < -1.0) right = -1.0;

      this.ringBufferL[this.writePtr] = left;
      this.ringBufferR[this.writePtr] = right;
      this.writePtr = (this.writePtr + 1) % this.ringCapacity;

      if (this.availableSamples < this.ringCapacity) {
        this.availableSamples++;
      } else {
        this.readPtr = (this.readPtr + 1) % this.ringCapacity;
      }
    }

    this.stats.samplesWritten += count;
    this.stats.peakVolume = peak;
    this.stats.availableSamples = this.availableSamples;
    this.stats.bufferMs = Math.round((this.availableSamples / this.sourceSampleRate) * 1000);
  }

  processScriptAudio(e) {
    const outputL = e.outputBuffer.getChannelData(0);
    const outputR = e.outputBuffer.getChannelData(1);
    const length = outputL.length;

    if (this.isMuted || this.volume <= 0.001) {
      outputL.fill(0);
      outputR.fill(0);
      return;
    }

    const vol = this.volume;
    const targetRate = this.ctx ? this.ctx.sampleRate : this.sourceSampleRate;

    // Dynamic Elastic Buffering
    let speedAdjustment = 1.0;
    if (this.availableSamples < 1200) {
      speedAdjustment = 0.985;
    } else if (this.availableSamples > 3500) {
      speedAdjustment = 1.015;
    }

    const resampleStep = (this.sourceSampleRate / targetRate) * speedAdjustment;
    let currentPeak = 0;

    for (let i = 0; i < length; i++) {
      if (this.availableSamples >= 2) {
        const idxA = this.readPtr;
        const idxB = (this.readPtr + 1) % this.ringCapacity;
        const frac = this.resamplePhase;

        const left = (this.ringBufferL[idxA] * (1 - frac) + this.ringBufferL[idxB] * frac) * vol;
        const right = (this.ringBufferR[idxA] * (1 - frac) + this.ringBufferR[idxB] * frac) * vol;

        outputL[i] = left;
        outputR[i] = right;

        const absL = Math.abs(left);
        const absR = Math.abs(right);
        if (absL > currentPeak) currentPeak = absL;
        if (absR > currentPeak) currentPeak = absR;

        this.resamplePhase += resampleStep;
        while (this.resamplePhase >= 1.0) {
          this.resamplePhase -= 1.0;
          this.readPtr = (this.readPtr + 1) % this.ringCapacity;
          this.availableSamples--;
          this.stats.samplesRead++;
          if (this.availableSamples <= 0) break;
        }
      } else {
        outputL[i] = 0;
        outputR[i] = 0;
        this.stats.underruns++;
      }
    }

    this.stats.peakVolume = currentPeak;
    this.stats.availableSamples = this.availableSamples;
    this.stats.bufferMs = Math.round((this.availableSamples / this.sourceSampleRate) * 1000);
    this.stats.speedAdjustment = speedAdjustment;
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
    }
    if (this.isWorkletActive && this.workletNode) {
      this.workletNode.port.postMessage({ type: 'volume', volume: this.volume });
    }
  }

  setMute(mute) {
    this.isMuted = !!mute;
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
    }
    if (this.isWorkletActive && this.workletNode) {
      this.workletNode.port.postMessage({ type: 'mute', isMuted: this.isMuted });
    }
  }

  setSourceSampleRate(rate) {
    if (rate && rate > 0) {
      this.sourceSampleRate = rate;
      this.stats.sourceSampleRate = rate;
      if (this.isWorkletActive && this.workletNode) {
        this.workletNode.port.postMessage({ type: 'sourceRate', rate });
      }
    }
  }

  clear() {
    this.writePtr = 0;
    this.readPtr = 0;
    this.availableSamples = 0;
    this.resamplePhase = 0;
    this.ringBufferL.fill(0);
    this.ringBufferR.fill(0);
    if (this.isWorkletActive && this.workletNode) {
      this.workletNode.port.postMessage({ type: 'clear' });
    }
  }

  async resetPipeline() {
    console.log('[AudioDriver] Resetting audio pipeline...');
    try {
      if (this.scriptNode) {
        this.scriptNode.disconnect();
        this.scriptNode = null;
      }
      if (this.workletNode) {
        this.workletNode.disconnect();
        this.workletNode = null;
      }
      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }
      if (this.ctx) {
        await this.ctx.close().catch(() => {});
        this.ctx = null;
      }
    } catch (e) {}

    await this.ensureContext();
    await this.unlockAudio();
    return true;
  }

  playTestTone() {
    this.unlockAudio();
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
      console.log('[AudioDriver] 🔔 Test chime played successfully.');
    } catch (e) {
      console.error('[AudioDriver] Error playing test tone:', e);
    }
  }

  async toggleEngineMode() {
    this.forceScriptProcessor = !this.forceScriptProcessor;
    console.log(`[AudioDriver] 🔄 Toggling audio mode. Force ScriptProcessor: ${this.forceScriptProcessor}`);
    await this.resetPipeline();
    return this.stats.mode;
  }

  getDiagnostics() {
    if (this.ctx) {
      this.stats.contextState = this.ctx.state;
      this.stats.hardwareSampleRate = this.ctx.sampleRate;
    }
    return {
      ...this.stats,
      isMuted: this.isMuted,
      volume: this.volume,
      muteOnFastForward: this.muteOnFastForward
    };
  }
}

