# HQ OS — Windows 98 Simulation Context for LLMs

This document provides a comprehensive structured summary of **HQ OS**, a pixel-perfect, responsive Windows 98 web simulation. It is formatted with collapsible sections designed to quickly orient another LLM or developer on the project's codebase, architecture, and features.

---

<details>
<summary>🚀 1. Overview & Technology Stack</summary>

### Overview
HQ OS is an interactive simulation of the Windows 98 operating system, built to run in modern browsers. It renders inside a highly responsive CRT-style monitor frame, simulating boot-up sequences, retro desktop file management, window overlays, custom applications, and system property settings.

### Tech Stack
- **Core Framework**: React 19 + TypeScript + Vite 6
- **State Management**: Zustand 5 (for the Window Manager and system state)
- **Styling**: Vanilla CSS (modular stylesheets under `src/styles/`) + Tailwind CSS 4 (for utility/layout adjustments)
- **Bundler**: Vite
</details>

<details>
<summary>📂 2. File & Directory Structure</summary>

```
HQ OS/
├── public/                 # Static assets (icons, programs, games, etc.)
│   ├── images/icons/       # Classic 16-color / 256-color Windows 98 icon sets
│   └── programs/           # Standalone iframe applications (js-solitaire, command, jspaint, etc.)
├── src/
│   ├── App.tsx             # Main shell renderer, responsive CRT monitor frame calculation
│   ├── main.tsx            # Vite entry point
│   ├── apps/               # Custom built-in simulated applications
│   │   ├── AfricaOnlyTV.tsx      # Video streaming application for African community content
│   │   ├── Calculator.tsx        # Standard scientific-capable retro calculator
│   │   ├── DisplayProperties.tsx # Desktop styling, background color, and wallpaper management
│   │   ├── Explorer.tsx          # Win98 Explorer file navigator connected to Memory VFS
│   │   ├── Notepad.tsx           # Text editor with VFS file saving capabilities
│   │   ├── PokemonEmulator.tsx   # Pokémon Gameboy emulator using web-based frame loading
│   │   ├── Pong.tsx              # Classic Pong arcade game clone
│   │   ├── SoundRecorder.tsx     # Vintage sound recorder with audio waveform simulation
│   │   ├── VideoFolder.tsx       # Win98 Explorer views of the 3 custom community folders
│   │   ├── VideoPlayer.tsx       # Windows Media Player wrapper powered by YouTube IFrame Player API
│   │   ├── videoData.ts          # Central data source for community video folders & streams
│   │   └── WebRadio.tsx          # Internet radio streaming client
│   ├── components/         # Global OS UI components
│   │   ├── BootScreen.tsx        # Bios boot-up log and terminal simulation
│   │   ├── Desktop.tsx           # Grid icons, desktop selection marquee, and custom context menu
│   │   ├── Taskbar.tsx           # Start button, Start menu, system tray, clock, and active window list
│   │   └── Window.tsx            # Drag-and-drop, resizable, double-clickable OS window wrapper
│   ├── styles/             # Application stylesheets
│   │   ├── classic.css           # Win98 classic component frames, borders, buttons, and scrollbars
│   │   ├── layout.css            # CRT screen overlays, positioning, scanlines, and desktop grid
│   │   └── system.css            # Global resets and CSS variables
│   ├── vfs/                # Virtual File System
│   │   ├── fs.ts                 # MemoryFileSystem class containing CRUD operations, path resolution
│   │   └── filesystem-index.json # Raw directory structure parsed into Memory VFS on bootstrap
│   └── wm/                 # Window Manager
│       └── manager.ts            # Zustand-based state store for window instances, Z-indexes, and active states
├── package.json            # Node project configuration
└── tsconfig.json           # TypeScript configuration
```
</details>

<details>
<summary>💾 3. Core Systems (VFS & Window Manager)</summary>

### Zustand Window Manager (`src/wm/manager.ts`)
Controls all open window states, dynamic bounds, minimization, maximization, focal status, and active desktop wallpapers.
- **Window State**: Holds dimensions, positioning, application type, title, and reference to custom properties.
- **Z-Index Calculation**: Focus transitions automatically update Z-indexes to bring the active window to the front.
- **Customization**: Manages active desktop wallpaper configurations (Stretch, Tile, Center) and background colors.

### Virtual File System (`src/vfs/fs.ts`)
A standard memory-backed VFS initialized with root structures (`C:/Windows`, `C:/Desktop`, `C:/My Documents`, `C:/Program Files`).
- **Data Persistence**: Backed by a nested tree of nodes loaded from `filesystem-index.json`.
- **API**: Provides standard operations including `exists()`, `readdir()`, `readFile()`, `writeFile()`, `mkdir()`, `rename()`, `unlink()`, and `rmdir()`.
- **Subscriptions**: React components subscribe to VFS updates to refresh dynamically when files are created, renamed, or modified.
</details>

<details>
<summary>🖥️ 4. Shell Components (Desktop, Windows, Taskbar)</summary>

### Desktop (`src/components/Desktop.tsx`)
- Handles icon placement in standard column layouts.
- Implements a selection marquee drag-box.
- Built-in custom Win98 desktop right-click context menu (allowing background settings, creating text files/folders, sorting, and launching applications).

### Windows (`src/components/Window.tsx`)
- Standardized title bars, window controls (minimize, maximize, close).
- Fully drag-and-drop movable.
- Resizable from all edges and corners.
- Focus-aware: changes colors to indicate inactive/active states.

### Taskbar (`src/components/Taskbar.tsx`)
- Retro Start Menu including sub-folders (Programs, Documents, Settings).
- System tray with a real-time clock and utility indicators.
- Quick-launch and task buttons for min/max/focus toggling of running applications.
</details>

<details>
<summary>🎬 5. Simulated Applications (`src/apps/*`)</summary>

- **Explorer**: Fully navigable folder explorer with tree view support, copy/paste, file deletion, and file/folder creation.
- **Notepad**: Text editor loaded with virtual file contents. Supports editing and saving back to the Memory VFS.
- **Calculator**: Operable Win98 layout calculator.
- **WebRadio**: Retro player with preset radio stations.
- **Sound Recorder**: Visualizes microphone input or simulated audio waves with old-school controls.
- **Pong & Pokemon**: Retro gaming options integrated directly into the system.
- **Display Properties**: Allows customizing background color, retro wallpaper, and CRT screen effects.
</details>

<details>
<summary>✨ 6. Recent Custom Implementations</summary>

### Responsive Monitor Frame (`src/App.tsx`)
The entire operating system is enveloped by a vintage computer monitor bezel. It automatically calculates responsive margin spacing based on screen resolution and screen size to ensure a consistent, premium retro look.

### Video Collections & Custom Folders
Three folders reside on the desktop containing specific community-based collections:
1. **4 D PPL**: Community artists & resources.
2. **WE D PPL**: Educational, politics, and socioeconomic recordings (e.g. *Malcolm X's full "The Ballot or the Bullet" speech*).
3. **BY D PPL**: Gallery creations, curated arts, and community showcase projects.

### Retro YouTube Media Player (`src/apps/VideoPlayer.tsx`)
A custom Windows Media Player style wrapper built to programmatically handle YouTube video embeds:
- **No Native Overlays**: YouTube's native playback overlays are fully hidden via URL options.
- **Programmatic Control**: Interfaced with the **YouTube IFrame Player API** so that the Windows Media Player transport controls (Play, Pause, Stop, Seek Slider, and Volume Slider) drive the video playback.
- **Status Tickers**: Includes a "Now Playing" track name ticker and custom seek time readouts.
</details>

<details>
<summary>⚙️ 7. Development & How to Run</summary>

```bash
# 1. Install dependencies
npm install

# 2. Run local dev server (default port 3001)
npm run dev

# 3. Build production bundle
npm run build
```
</details>
