/**
 * NekoAdvance - Low-Latency High-Fidelity Audio Driver
 * Features:
 * - Dynamic Ring Buffer to eliminate crackling / stuttering
 * - Web Audio API (44.1kHz / 48kHz Output)
 * - Automatic AudioContext unlock on first user gesture
 * - Master volume control and fast-forward muting
 */

export class AudioDriver {
    constructor(sourceSampleRate = 44100, bufferSize = 2048) {
        this.sourceSampleRate = sourceSampleRate;
        this.bufferSize = bufferSize;
        this.ctx = null;
        this.gainNode = null;
        this.node = null;
        this.volume = 0.8;
        this.muteOnFastForward = true;
        this.isMuted = false;

        // Ring Buffer (Circular Queue) for Stereo PCM Samples (Float32)
        // Capacity: 65536 samples (~1.5 seconds of audio buffer)
        this.ringCapacity = 65536;
        this.ringBufferL = new Float32Array(this.ringCapacity);
        this.ringBufferR = new Float32Array(this.ringCapacity);
        this.writePtr = 0;
        this.readPtr = 0;
        this.availableSamples = 0;

        // Fractional resampling index
        this.resamplePhase = 0;

        // Diagnostics
        this.debugTicks = 0;
        this.debugSamplesWritten = 0;
    }

    ensureContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                console.error('[AudioDriver] Web Audio API is not supported in this browser');
                return;
            }
            try {
                this.ctx = new AudioCtx({ latencyHint: 'interactive' });
                console.log('[AudioDriver] AudioContext created. SampleRate:', this.ctx.sampleRate, 'State:', this.ctx.state);
            } catch (e) {
                this.ctx = new AudioCtx();
            }
            this.setupAudioNode();
        }

        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().then(() => {
                console.log('[AudioDriver] AudioContext resumed -> state:', this.ctx?.state);
            }).catch((err) => {
                console.warn('[AudioDriver] AudioContext resume note:', err);
            });
        }
    }

    setupAudioNode() {
        if (!this.ctx) return;

        try {
            // Master Gain Node for volume control
            this.gainNode = this.ctx.createGain();
            this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
            this.gainNode.connect(this.ctx.destination);

            // ScriptProcessorNode with 0 inputs, 2 outputs
            this.node = this.ctx.createScriptProcessor(this.bufferSize, 0, 2);
            this.node.onaudioprocess = (e) => this.processAudio(e);
            this.node.connect(this.gainNode);

            // Keep global window reference so V8 GC never reclaims the audio node
            window.__nekoAudioDriverNode = this.node;
            console.log('[AudioDriver] Audio node connected to output destination successfully.');
        } catch (err) {
            console.error('[AudioDriver] Error setting up audio pipeline:', err);
        }
    }

    processAudio(e) {
        this.debugTicks++;
        if (this.debugTicks === 1 || this.debugTicks === 120) {
            console.log('[AudioDriver] processAudio tick #' + this.debugTicks + ' | RingBuffer available samples:', this.availableSamples, '| Vol:', this.volume, '| State:', this.ctx?.state);
        }

        const outputL = e.outputBuffer.getChannelData(0);
        const outputR = e.outputBuffer.getChannelData(1);
        const length = outputL.length;

        if (this.isMuted || this.volume <= 0.001) {
            outputL.fill(0);
            outputR.fill(0);
            return;
        }

        // Resample ratio: mGBA output rate (44100) / Hardware device sample rate (e.g. 48000)
        const targetRate = this.ctx ? this.ctx.sampleRate : this.sourceSampleRate;
        const resampleStep = this.sourceSampleRate / targetRate;

        for (let i = 0; i < length; i++) {
            if (this.availableSamples >= 2) {
                const idxA = this.readPtr;
                const idxB = (this.readPtr + 1) % this.ringCapacity;
                const frac = this.resamplePhase;

                // Linear interpolation for crystal clear sound without pitch artifacts
                const left = this.ringBufferL[idxA] * (1 - frac) + this.ringBufferL[idxB] * frac;
                const right = this.ringBufferR[idxA] * (1 - frac) + this.ringBufferR[idxB] * frac;

                outputL[i] = left;
                outputR[i] = right;

                this.resamplePhase += resampleStep;
                while (this.resamplePhase >= 1.0) {
                    this.resamplePhase -= 1.0;
                    this.readPtr = (this.readPtr + 1) % this.ringCapacity;
                    this.availableSamples--;
                    if (this.availableSamples <= 0) break;
                }
            } else {
                // Buffer Underrun: soft silence
                outputL[i] = 0;
                outputR[i] = 0;
            }
        }
    }

    /**
     * Push interleaved stereo PCM samples (L, R, L, R...) into Ring Buffer
     * @param {Float32Array|Int16Array} samples 
     */
    writeSamples(samples) {
        if (!samples || samples.length === 0) return;

        if (this.debugSamplesWritten === 0) {
            let maxVal = 0;
            for (let i = 0; i < Math.min(100, samples.length); i++) {
                maxVal = Math.max(maxVal, Math.abs(samples[i]));
            }
            console.log('[AudioDriver] First writeSamples received: length =', samples.length, '| maxAmplitude =', maxVal, '| AudioCtx State =', this.ctx?.state);
        }
        this.debugSamplesWritten += samples.length;

        // Auto-resume if suspended
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }

        const count = samples.length >> 1; // Number of stereo pairs
        const isInt16 = samples instanceof Int16Array;
        const normFactor = 1.0 / 32768.0;

        for (let i = 0; i < count; i++) {
            const idx = i << 1;
            const left = isInt16 ? samples[idx] * normFactor : samples[idx];
            const right = isInt16 ? samples[idx + 1] * normFactor : samples[idx + 1];

            this.ringBufferL[this.writePtr] = left;
            this.ringBufferR[this.writePtr] = right;
            this.writePtr = (this.writePtr + 1) % this.ringCapacity;

            if (this.availableSamples < this.ringCapacity) {
                this.availableSamples++;
            } else {
                // Overflow: advance read pointer to drop oldest sample
                this.readPtr = (this.readPtr + 1) % this.ringCapacity;
            }
        }
    }

    setVolume(val) {
        this.volume = Math.max(0, Math.min(1, val));
        if (this.gainNode && this.ctx) {
            this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
        }
    }

    setMute(mute) {
        this.isMuted = !!mute;
        if (this.gainNode && this.ctx) {
            this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
        }
    }

    clear() {
        this.writePtr = 0;
        this.readPtr = 0;
        this.availableSamples = 0;
        this.resamplePhase = 0;
        this.ringBufferL.fill(0);
        this.ringBufferR.fill(0);
    }
}
