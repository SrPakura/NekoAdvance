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
        this._loggedNonZero = false;

        // Expose test tone on window
        window.nekoPlayTestTone = () => this.playTestTone();
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
                console.log('[AudioDriver] AudioContext initialized. Hardware SampleRate:', this.ctx.sampleRate, 'State:', this.ctx.state);
            } catch (e) {
                this.ctx = new AudioCtx();
            }
            this.setupAudioNode();
        }

        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().then(() => {
                console.log('[AudioDriver] AudioContext resumed -> state:', this.ctx?.state);
            }).catch((err) => {
                console.warn('[AudioDriver] AudioContext resume error:', err);
            });
        }
    }

    unlockAudio() {
        this.ensureContext();
        if (this.ctx) {
            if (this.ctx.state !== 'running') {
                this.ctx.resume().catch(() => {});
            }
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

    setupAudioNode() {
        if (!this.ctx) return;

        try {
            // Direct ScriptProcessorNode (0 inputs, 2 outputs) connected directly to destination
            this.node = this.ctx.createScriptProcessor(this.bufferSize, 0, 2);
            this.node.onaudioprocess = (e) => this.processAudio(e);
            this.node.connect(this.ctx.destination);

            // Store persistent global reference
            window.__nekoAudioDriverNode = this.node;
            console.log('[AudioDriver] Audio output pipeline connected directly to destination.');
        } catch (err) {
            console.error('[AudioDriver] Error setting up audio pipeline:', err);
        }
    }

    playTestTone() {
        this.unlockAudio();
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, this.ctx.currentTime); // 440Hz A
        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.5);
        console.log('[AudioDriver] 🔔 Test tone (440Hz) played successfully.');
    }

    processAudio(e) {
        this.debugTicks++;
        const outputL = e.outputBuffer.getChannelData(0);
        const outputR = e.outputBuffer.getChannelData(1);
        const length = outputL.length;

        if (this.isMuted || this.volume <= 0.001) {
            outputL.fill(0);
            outputR.fill(0);
            return;
        }

        const vol = this.volume;

        // Resample ratio: mGBA output rate (44100) / Hardware device sample rate (e.g. 48000)
        const targetRate = this.ctx ? this.ctx.sampleRate : this.sourceSampleRate;
        const resampleStep = this.sourceSampleRate / targetRate;

        let maxOut = 0;

        for (let i = 0; i < length; i++) {
            if (this.availableSamples >= 2) {
                const idxA = this.readPtr;
                const idxB = (this.readPtr + 1) % this.ringCapacity;
                const frac = this.resamplePhase;

                // Linear interpolation for crystal clear sound without pitch artifacts
                const left = (this.ringBufferL[idxA] * (1 - frac) + this.ringBufferL[idxB] * frac) * vol;
                const right = (this.ringBufferR[idxA] * (1 - frac) + this.ringBufferR[idxB] * frac) * vol;

                outputL[i] = left;
                outputR[i] = right;

                if (Math.abs(left) > maxOut) maxOut = Math.abs(left);

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

        if (this.debugTicks === 60 || this.debugTicks === 240) {
            console.log('[AudioDriver] Audio Process Tick #' + this.debugTicks + ' | RingBuffer queue:', this.availableSamples, '| MaxOut Amplitude:', maxOut.toFixed(4), '| Vol:', vol);
        }
    }

    /**
     * Push interleaved stereo PCM samples (L, R, L, R...) into Ring Buffer
     * @param {Float32Array|Int16Array} samples 
     */
    writeSamples(samples) {
        if (!samples || samples.length === 0) return;

        // Auto-resume if suspended
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }

        let nonZeroCount = 0;
        let maxVal = 0;
        for (let i = 0; i < samples.length; i++) {
            const val = Math.abs(samples[i]);
            if (val > 0) nonZeroCount++;
            if (val > maxVal) maxVal = val;
        }

        if (nonZeroCount > 0 && !this._loggedNonZero) {
            this._loggedNonZero = true;
            console.log('[AudioDriver] 🔊 NON-ZERO GBA AUDIO DETECTED! Sample Count:', samples.length, '| Max Value:', maxVal, '(PCM range: 0-32767)');
        }

        this.debugSamplesWritten += samples.length;

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
        this.resamplePhase = 0;
        this.ringBufferL.fill(0);
        this.ringBufferR.fill(0);
    }
}
