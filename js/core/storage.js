/**
 * NekoAdvance - IndexedDB Storage Manager
 * Handles local persistence of ROMs, .sav files, savestates (with screenshot previews), cheats, and settings.
 */

const DB_NAME = 'NekoAdvanceDB';
const DB_VERSION = 1;

class StorageManager {
  constructor() {
    this.db = null;
    this.readyPromise = this.init();
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // ROMs Store
        if (!db.objectStoreNames.contains('roms')) {
          db.createObjectStore('roms', { keyPath: 'id' });
        }

        // Battery Saves (.sav)
        if (!db.objectStoreNames.contains('saves')) {
          db.createObjectStore('saves', { keyPath: 'romId' });
        }

        // Save States (Slots 1-8 per ROM)
        if (!db.objectStoreNames.contains('states')) {
          const stateStore = db.createObjectStore('states', { keyPath: 'id' });
          stateStore.createIndex('romId', 'romId', { unique: false });
        }

        // Cheats Store
        if (!db.objectStoreNames.contains('cheats')) {
          const cheatStore = db.createObjectStore('cheats', { keyPath: 'id', autoIncrement: true });
          cheatStore.createIndex('romId', 'romId', { unique: false });
        }

        // Settings Store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async getDB() {
    if (!this.db) {
      await this.readyPromise;
    }
    return this.db;
  }

  // --- ROM Management ---
  async saveROM(id, name, data, size) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('roms', 'readwrite');
      const store = tx.objectStore('roms');
      store.put({
        id,
        name,
        data,
        size,
        lastPlayed: Date.now()
      });
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllROMs() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('roms', 'readonly');
      const store = tx.objectStore('roms');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getROM(id) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('roms', 'readonly');
      const store = tx.objectStore('roms');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteROM(id) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['roms', 'saves', 'states', 'cheats'], 'readwrite');
      tx.objectStore('roms').delete(id);
      tx.objectStore('saves').delete(id);
      
      // Delete states for this rom
      const stateIndex = tx.objectStore('states').index('romId');
      const stateReq = stateIndex.getAllKeys(id);
      stateReq.onsuccess = () => {
        stateReq.result.forEach(k => tx.objectStore('states').delete(k));
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Battery Save (.sav) ---
  async saveBattery(romId, saveBuffer) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('saves', 'readwrite');
      const store = tx.objectStore('saves');
      store.put({
        romId,
        data: saveBuffer,
        timestamp: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadBattery(romId) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('saves', 'readonly');
      const store = tx.objectStore('saves');
      const request = store.get(romId);
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject(request.error);
    });
  }

  // --- Save States ---
  async saveState(romId, slot, stateData, screenshotDataUrl) {
    const db = await this.getDB();
    const id = `${romId}_slot_${slot}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('states', 'readwrite');
      const store = tx.objectStore('states');
      store.put({
        id,
        romId,
        slot,
        data: stateData,
        screenshot: screenshotDataUrl,
        timestamp: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadState(romId, slot) {
    const db = await this.getDB();
    const id = `${romId}_slot_${slot}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('states', 'readonly');
      const store = tx.objectStore('states');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getStatesForROM(romId) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('states', 'readonly');
      const store = tx.objectStore('states');
      const index = store.index('romId');
      const request = index.getAll(romId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // --- Cheats ---
  async getCheats(romId) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cheats', 'readonly');
      const store = tx.objectStore('cheats');
      const index = store.index('romId');
      const request = index.getAll(romId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async saveCheat(cheat) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cheats', 'readwrite');
      const store = tx.objectStore('cheats');
      const request = store.put(cheat);
      request.onsuccess = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteCheat(id) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cheats', 'readwrite');
      const store = tx.objectStore('cheats');
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Settings ---
  async getSetting(key, defaultValue = null) {
    const db = await this.getDB();
    return new Promise((resolve) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ? request.result.value : defaultValue);
      request.onerror = () => resolve(defaultValue);
    });
  }

  async setSetting(key, value) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      store.put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const storage = new StorageManager();
