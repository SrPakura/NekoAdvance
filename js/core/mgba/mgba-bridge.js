/**
 * NekoAdvance - mGBA WebAssembly Core Bridge
 * 
 * Provides an idiomatic JavaScript interface to the mGBA C / WASM emulation core:
 * - Direct Zero-Copy Framebuffer Pointer Access (240x160 RGBA)
 * - Interleaved PCM Audio Stream Extraction
 * - Cartridge Save Management (.sav synchronizer for Flash 128K, SRAM, EEPROM)
 * - Binary Snapshot Save States (Freeze & Defrost)
 * - Cheat Codes Engine (GameShark, Action Replay, CodeBreaker)
 */

export const GBA_KEYS = {
    A: 1 << 0,
    B: 1 << 1,
    SELECT: 1 << 2,
    START: 1 << 3,
    RIGHT: 1 << 4,
    LEFT: 1 << 5,
    UP: 1 << 6,
    DOWN: 1 << 7,
    R: 1 << 8,
    L: 1 << 9
};

export class MGBABridge {
    constructor(options = {}) {
        this.module = null;
        this.isLoaded = false;
        this.isRomLoaded = false;
        this.keyState = 0; // Bitmask of currently held keys

        // Framebuffer Cache (240x160 * 4 bytes RGBA = 153,600 bytes)
        this.framebuffer = new Uint8Array(240 * 160 * 4);
        this.audioBuffer = new Int16Array(2048);

        // Core Configuration Callbacks
        this.onSaveUpdated = options.onSaveUpdated || null;
        this.onCrash = options.onCrash || null;
    }

    async init() {
        if (this.module && typeof this.module._mgba_load_rom === 'function') {
            return true;
        }

        try {
            console.log('[MGBABridge] Initializing mGBA WebAssembly core...');
            
            let mGBAFactory = window.mGBA;
            if (typeof mGBAFactory !== 'function') {
                try {
                    const moduleScript = await import('./mgba.js');
                    mGBAFactory = moduleScript.default || window.mGBA;
                } catch (e) {
                    mGBAFactory = window.mGBA;
                }
            }

            if (typeof mGBAFactory === 'function') {
                const wasmBinaryUrl = new URL('./mgba.wasm', import.meta.url).href;
                this.module = await mGBAFactory({
                    locateFile: (file) => {
                        if (file.endsWith('.wasm')) return wasmBinaryUrl;
                        return file;
                    }
                });

                if (this.module && typeof this.module._mgba_init === 'function') {
                    this.module._mgba_init();
                }
                this.isLoaded = true;
                console.log('[MGBABridge] mGBA WebAssembly Core initialized successfully.');
                return true;
            }

            return false;
        } catch (err) {
            console.warn('[MGBABridge] Native WASM Module loading note:', err);
            return false;
        }
    }

    /**
     * Load GBA ROM ArrayBuffer into the mGBA Core
     * @param {ArrayBuffer|Uint8Array} romBuffer 
     * @param {string} filename 
     */
    async loadROM(romBuffer, filename = 'game.gba') {
        if (!this.module || typeof this.module._mgba_load_game !== 'function') {
            await this.init();
        }

        const u8 = romBuffer instanceof Uint8Array ? romBuffer : new Uint8Array(romBuffer);
        
        if (this.module && this.module.FS && typeof this.module._mgba_load_game === 'function') {
            try {
                this.module.FS.writeFile('/game.gba', u8);
                const pathPtr = this.module.allocateUTF8('/game.gba');
                const success = this.module._mgba_load_game(pathPtr);
                this.module._free(pathPtr);
                if (success) {
                    this.isRomLoaded = true;
                    console.log('[MGBABridge] ROM loaded successfully via mGBA VFS');
                    return true;
                }
            } catch (e) {
                console.error('[MGBABridge] Error in loadROM via FS:', e);
            }
        }

        return false;
    }

    /**
     * Step the GBA emulation by exactly 1 Video Frame (280,896 CPU cycles)
     * Returns the 240x160 RGBA Pixel Buffer
     */
    runFrame() {
        if (!this.isRomLoaded) return this.framebuffer;

        if (this.module && typeof this.module._mgba_run_frame === 'function') {
            // Send current keypad state
            this.module._mgba_set_keys(this.keyState);

            // Execute 1 frame in mGBA C core
            this.module._mgba_run_frame();

            // Retrieve zero-copy framebuffer pointer
            const fbPtr = this.module._mgba_get_framebuffer();
            if (fbPtr && this.module.HEAPU8) {
                return new Uint8Array(this.module.HEAPU8.buffer, fbPtr, 240 * 160 * 4);
            }
        }

        return this.framebuffer;
    }

    /**
     * Read audio samples produced during the last frame(s)
     * @returns {Int16Array|Float32Array|null}
     */
    getAudioSamples() {
        if (this.module && typeof this.module._mgba_get_audio_buffer === 'function') {
            const audioPtr = this.module._mgba_get_audio_buffer();
            const count = this.module._mgba_get_audio_samples_count ? this.module._mgba_get_audio_samples_count() : 0;
            
            if (this._audioDebugCount === undefined) this._audioDebugCount = 0;
            this._audioDebugCount++;

            if (this._audioDebugCount <= 10 || this._audioDebugCount % 120 === 0) {
                console.log(`[MGBABridge] getAudioSamples tick #${this._audioDebugCount} | audioPtr: ${audioPtr} | count: ${count} | HEAP16: ${!!this.module.HEAP16}`);
            }

            if (audioPtr && count > 0 && this.module.HEAP16) {
                const elemOffset = audioPtr >> 1;
                const totalSamples = count * 2;
                const samples = this.module.HEAP16.slice(elemOffset, elemOffset + totalSamples);

                let maxVal = 0;
                for (let i = 0; i < samples.length; i++) {
                    const abs = Math.abs(samples[i]);
                    if (abs > maxVal) maxVal = abs;
                }

                if (this._audioDebugCount <= 10 || (maxVal > 0 && !this._loggedPositive)) {
                    this._loggedPositive = true;
                    console.log(`[MGBABridge] 🔊 PCM Buffer Samples: ${samples.length} items (${count} stereo pairs) | Peak Int16: ${maxVal}`);
                }

                return samples;
            }
        } else {
            if (!this._loggedMissingFunc) {
                this._loggedMissingFunc = true;
                console.error('[MGBABridge] _mgba_get_audio_buffer function is NOT defined in module!', this.module);
            }
        }
        return null;
    }

    /**
     * Update GBA Keypad bitmask
     * @param {number} buttonMask 
     * @param {boolean} pressed 
     */
    setKey(buttonMask, pressed) {
        if (pressed) {
            this.keyState |= buttonMask;
        } else {
            this.keyState &= ~buttonMask;
        }
    }

    /**
     * Save battery backed cartridge save (.sav format: Flash 128K, SRAM, EEPROM)
     * @returns {Uint8Array|null}
     */
    getSaveData() {
        if (this.module && typeof this.module._mgba_get_save_data === 'function') {
            const ptr = this.module._mgba_get_save_data();
            const size = this.module._mgba_get_save_size ? this.module._mgba_get_save_size() : 0;
            if (ptr && size > 0 && this.module.HEAPU8) {
                return new Uint8Array(this.module.HEAPU8.buffer, ptr, size).slice();
            }
        }
        return null;
    }

    /**
     * Load battery backed cartridge save (.sav) into memory
     * @param {Uint8Array} saveData 
     */
    loadSaveData(saveData) {
        if (!saveData || !this.module) return false;
        if (typeof this.module._mgba_set_save_data === 'function') {
            const ptr = this.module._malloc(saveData.length);
            this.module.HEAPU8.set(saveData, ptr);
            const success = this.module._mgba_set_save_data(ptr, saveData.length);
            this.module._free(ptr);
            return !!success;
        }
        return false;
    }

    /**
     * Capture instant binary save state
     * @returns {Uint8Array|null}
     */
    saveState() {
        if (this.module && typeof this.module._mgba_save_state === 'function') {
            const ptr = this.module._mgba_save_state();
            const size = this.module._mgba_get_state_size ? this.module._mgba_get_state_size() : 0;
            if (ptr && size > 0 && this.module.HEAPU8) {
                return new Uint8Array(this.module.HEAPU8.buffer, ptr, size).slice();
            }
        }
        return null;
    }

    /**
     * Restore instant binary save state
     * @param {Uint8Array} stateBuffer 
     */
    loadState(stateBuffer) {
        if (!stateBuffer || !this.module) return false;
        if (typeof this.module._mgba_load_state === 'function') {
            const ptr = this.module._malloc(stateBuffer.length);
            this.module.HEAPU8.set(stateBuffer, ptr);
            const success = this.module._mgba_load_state(ptr, stateBuffer.length);
            this.module._free(ptr);
            return !!success;
        }
        return false;
    }

    /**
     * Add cheat code (GameShark, Action Replay, CodeBreaker)
     * @param {string} code 
     * @param {string} type 
     */
    addCheat(code, type = 'gameshark') {
        if (this.module && typeof this.module._mgba_add_cheat === 'function') {
            const codePtr = this.module.allocateUTF8(code);
            const typePtr = this.module.allocateUTF8(type);
            this.module._mgba_add_cheat(codePtr, typePtr);
            this.module._free(codePtr);
            this.module._free(typePtr);
            return true;
        }
        return false;
    }
}
