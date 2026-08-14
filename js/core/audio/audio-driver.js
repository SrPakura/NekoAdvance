/**
 * NekoAdvance - Low-Latency High-Fidelity Audio Driver
 * Features:
 * - Dynamic Ring Buffer to eliminate crackling / stuttering
 * - Web Audio API (44.1kHz / 48kHz Output)
 * - Automatic AudioContext unlock on first user gesture
 * - Master volume control and fast-forward muting
 */

export class AudioDriver {
    constructor(sampleRate = 44100, bufferSize = 2048) {
        this.sampleRate = sampleRate;
        this.bufferSize = bufferSize;
        this.ctx = null;
        this.node = null;
        this.volume = 0.8;
        this.muteOnFastForward = true;
        this.isMuted = false;

        // Ring Buffer (Circular Queue) for Stereo PCM Samples (Float32)
        // Capacity: 32768 samples (~0.75 seconds of audio buffer)
        this.ringCapacity = 65536;
        this.ringBufferL = new Float32Array(this.ringCapacity);
        this.ringBufferR = new Float32Array(this.ringCapacity);
        this.writePtr = 0;
        this.readPtr = 0;
        this.availableSamples = 0;
    }

    ensureContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            try {
                this.ctx = new AudioCtx({
                    latencyHint: 'interactive',
                    sampleRate: this.sampleRate
                });
            } catch (e) {
                this.ctx = new AudioCtx();
            }
            this.setupAudioNode();
        }

        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
    }

    setupAudioNode() {
        if (!this.ctx) return;

        // Create ScriptProcessorNode for maximum compatibility across mobile and desktop
        this.node = this.ctx.createScriptProcessor(this.bufferSize, 0, 2);
        this.node.onaudioprocess = (e) => this.processAudio(e);
        this.node.connect(this.ctx.destination);
    }

    processAudio(e) {
        const outputL = e.outputBuffer.getChannelData(0);
        const outputR = e.outputBuffer.getChannelData(1);
        const length = outputL.length;

        if (this.isMuted || this.volume <= 0.001) {
            outputL.fill(0);
            outputR.fill(0);
            return;
        }

        const vol = this.volume;

        for (let i = 0; i < length; i++) {
            if (this.availableSamples > 0) {
                outputL[i] = this.ringBufferL[this.readPtr] * vol;
                outputR[i] = this.ringBufferR[this.readPtr] * vol;
                this.readPtr = (this.readPtr + 1) % this.ringCapacity;
                this.availableSamples--;
            } else {
                // Buffer Underrun: output silence to avoid loud pops
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
    }

    setMute(mute) {
        this.isMuted = !!mute;
    }

    clear() {
        this.writePtr = 0;
        this.readPtr = 0;
        this.availableSamples = 0;
        this.ringBufferL.fill(0);
        this.ringBufferR.fill(0);
    }
}
