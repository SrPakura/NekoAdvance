/**
 * NekoAdvance - Cheat Engine
 * Parses and applies GameShark (v1/v2/v3), Action Replay, CodeBreaker, and Raw memory patches.
 */

export class CheatEngine {
  constructor() {
    this.cheats = [];
    this.enabled = true;
  }

  setCheats(cheatList) {
    this.cheats = cheatList.map(c => this.parseCheat(c));
  }

  addCheat(cheat) {
    const parsed = this.parseCheat(cheat);
    this.cheats.push(parsed);
    return parsed;
  }

  removeCheat(id) {
    this.cheats = this.cheats.filter(c => c.id !== id);
  }

  toggleCheat(id, enabled) {
    const cheat = this.cheats.find(c => c.id === id);
    if (cheat) {
      cheat.enabled = enabled;
    }
  }

  parseCheat(cheat) {
    const lines = cheat.code.split('\n').map(l => l.trim()).filter(Boolean);
    const parsedCodes = [];

    for (const line of lines) {
      const clean = line.replace(/[\s-]/g, '').toUpperCase();
      
      // CodeBreaker 12-digit (8 + 4): e.g. 82000000 0001 or 32000000 00FF
      if (clean.length === 12) {
        const type = clean.substring(0, 1);
        const addrHex = '0' + clean.substring(1, 8);
        const valHex = clean.substring(8, 12);
        const addr = parseInt(addrHex, 16);
        const value = parseInt(valHex, 16);

        if (type === '8') {
          // 16-bit write
          parsedCodes.push({ type: 'write16', address: addr, value: value });
        } else if (type === '3') {
          // 8-bit write
          parsedCodes.push({ type: 'write8', address: addr, value: value & 0xFF });
        } else {
          parsedCodes.push({ type: 'write16', address: addr, value: value });
        }
      }
      // GameShark / Action Replay 16-digit (8 + 8): e.g. XXXXXXXX YYYYYYYY
      else if (clean.length === 16) {
        const part1 = clean.substring(0, 8);
        const part2 = clean.substring(8, 16);
        const addr = parseInt(part1, 16);
        const val = parseInt(part2, 16);

        // Standard direct write or master code
        if (addr >= 0x02000000 && addr < 0x04000000) {
          parsedCodes.push({ type: 'write32', address: addr, value: val });
        } else {
          // Fallback to 16-bit or 32-bit patch
          parsedCodes.push({ type: 'raw', code1: addr, code2: val });
        }
      }
      // Raw 8-digit or address=value
      else if (clean.includes('=')) {
        const [aStr, vStr] = clean.split('=');
        parsedCodes.push({
          type: 'write8',
          address: parseInt(aStr, 16),
          value: parseInt(vStr, 16)
        });
      }
    }

    return {
      id: cheat.id,
      name: cheat.name || 'Cheat',
      code: cheat.code,
      format: cheat.format || 'Auto',
      enabled: cheat.enabled ?? true,
      parsedCodes
    };
  }

  // Apply patches to the GBA memory bus
  applyCheats(memoryBus) {
    if (!this.enabled || !memoryBus) return;

    for (const cheat of this.cheats) {
      if (!cheat.enabled) continue;

      for (const op of cheat.parsedCodes) {
        try {
          if (op.type === 'write8' && memoryBus.write8) {
            memoryBus.write8(op.address, op.value);
          } else if (op.type === 'write16' && memoryBus.write16) {
            memoryBus.write16(op.address, op.value);
          } else if (op.type === 'write32' && memoryBus.write32) {
            memoryBus.write32(op.address, op.value);
          }
        } catch (e) {
          // Ignore invalid memory addresses
        }
      }
    }
  }
}
