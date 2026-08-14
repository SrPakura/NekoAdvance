# 🐾 NekoAdvance - GBA Emulator PWA

> **NekoAdvance** es un emulador moderno de Game Boy Advance en formato Progressive Web App (PWA), diseñado con una interfaz personalizada inspirada en una consola con forma de gato, controles táctiles ergonómicos, estados de guardado con capturas, motor de trucos, aceleración de x2 a x16 y funcionamiento 100% offline.

---

## ✨ Características

- 🐱 **Diseño Único & Consola Neko**: Carcasa con silueta felina basada en vectores SVG, pantalla con relación de aspecto 3:2 nativa de GBA ($240 \times 160$) y **nariz interactiva** como botón de pausa y menú.
- 🕹️ **Controles Táctiles y Físicos**:
  - D-Pad circular y botones A/B ergonómicos con animaciones de presión 3D.
  - Gatillos **L** y **R** integrados en las orejas del gato.
  - Soporte **Multi-Touch** simultáneo para móviles y tablets.
  - Compatible con **Gamepads / Mandos** (Xbox, PlayStation, Switch Pro, Bluetooth) vía Gamepad API.
  - Vibración háptica en dispositivos compatibles.
- 💾 **Guardado de Partidas & Estados**:
  - **Partidas normales (.sav)**: Detección automática de SRAM / Flash y sincronización con IndexedDB, con opción de exportar/importar archivos `.sav`.
  - **Save States**: 6 ranuras de guardado rápido con fecha, hora y miniaturas/screenshots del juego.
- ⚡ **Motor de Trucos (Cheats)**: Compatible con códigos **GameShark** (v1/v2/v3), **Action Replay**, **CodeBreaker** y parches directos de memoria.
- ⏩ **Fast-Forward (x2 a x16)**: Selector de velocidad dinámica (1x, 2x, 4x, 8x, 16x) y atajo manteniendo la barra espaciadora.
- 🎮 **Biblioteca de ROMs**: Arrastrar y soltar archivos `.gba`, `.bin`, `.agb` o `.zip` con almacenamiento local en el navegador.
- 📱 **100% PWA & Offline**: Instalable en Android, iOS, Windows, macOS y Linux sin necesidad de conexión a internet.
- 🚀 **Cero Dependencias (Sin Node.js)**: Construido con estándares web puros (HTML5, CSS3, ES Modules, Web Audio API, IndexedDB y WebAssembly).

---

## 🎮 Controles de Teclado Predeterminados

| Acción GBA | Tecla de Teclado |
| :--- | :--- |
| **D-Pad (Cruceta)** | Flechas de dirección ($\uparrow, \downarrow, \leftarrow, \rightarrow$) |
| **Botón A** | <kbd>X</kbd> |
| **Botón B** | <kbd>Z</kbd> |
| **Gatillo L** | <kbd>A</kbd> |
| **Gatillo R** | <kbd>S</kbd> |
| **Start** | <kbd>Enter</kbd> |
| **Select** | <kbd>Backspace</kbd> / Retroceso |
| **Fast Forward (4x)** | Mantener <kbd>Espacio</kbd> |
| **Menú / Pausa** | <kbd>Escape</kbd> o clic en la nariz del gato |
| **Guardado Rápido** | <kbd>F5</kbd> (Ranura 1) |
| **Carga Rápida** | <kbd>F8</kbd> (Ranura 1) |

---

## 🚀 Cómo Ejecutarlo

Al no requerir Node.js, puedes ejecutarlo con cualquier servidor HTTP estático local:

### Con Python (Preinstalado en Linux/Mac/Windows):
```bash
python3 -m http.server 8080
```
Y abre en tu navegador: [http://localhost:8080](http://localhost:8080)

### O con VS Code / Codium:
Instala la extensión **Live Server** y haz clic en *Go Live* sobre `index.html`.

---

## 📄 Licencia

Este proyecto está bajo la licencia [MIT](LICENSE).