/**
 * NekoAdvance - Keybindings Configuration
 */

import { GBA_BUTTONS } from '../core/gba-engine.js';

export const DEFAULT_KEYBOARD_MAP = {
  // GBA Button -> Keyboard Event Code
  [GBA_BUTTONS.A]: 'KeyX',          // X
  [GBA_BUTTONS.B]: 'KeyZ',          // Z
  [GBA_BUTTONS.L]: 'KeyA',          // A
  [GBA_BUTTONS.R]: 'KeyS',          // S
  [GBA_BUTTONS.UP]: 'ArrowUp',
  [GBA_BUTTONS.DOWN]: 'ArrowDown',
  [GBA_BUTTONS.LEFT]: 'ArrowLeft',
  [GBA_BUTTONS.RIGHT]: 'ArrowRight',
  [GBA_BUTTONS.START]: 'Enter',
  [GBA_BUTTONS.SELECT]: 'Backspace'
};

export const DEFAULT_GAMEPAD_MAP = {
  // Standard Gamepad API button index -> GBA Button
  0: GBA_BUTTONS.A,        // Xbox A / PS X
  1: GBA_BUTTONS.B,        // Xbox B / PS Circle
  2: GBA_BUTTONS.B,        // Xbox X / PS Square
  3: GBA_BUTTONS.A,        // Xbox Y / PS Triangle
  4: GBA_BUTTONS.L,        // LB / L1
  5: GBA_BUTTONS.R,        // RB / R1
  8: GBA_BUTTONS.SELECT,   // Select / Share / Back
  9: GBA_BUTTONS.START,    // Start / Options
  12: GBA_BUTTONS.UP,      // D-Pad Up
  13: GBA_BUTTONS.DOWN,    // D-Pad Down
  14: GBA_BUTTONS.LEFT,    // D-Pad Left
  15: GBA_BUTTONS.RIGHT    // D-Pad Right
};
