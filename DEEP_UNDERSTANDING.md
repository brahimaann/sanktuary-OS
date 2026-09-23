# HQ OS — Deep Understanding Document

> *Everything you need to understand this project at every layer: the mission, the machine, and the method.*

---

## Table of Contents

1. [The Big Picture — What This Is and Why](#1-the-big-picture)
2. [The OS Shell — HQ OS Architecture](#2-the-os-shell)
3. [The Crown Jewel — The Ppls Story Application](#3-the-ppls-story-application)
4. [The Data Model — TypeScript Schemas](#4-the-data-model)
5. [The Database — ANCHOR_EVENTS + DIASPORA_EVENTS](#5-the-database)
6. [The Map Engine — Equirectangular Projection Math](#6-the-map-engine)
7. [The Virtual File System (VFS)](#7-the-virtual-file-system)
8. [The Window Manager (Zustand)](#8-the-window-manager)
9. [All Applications — What Each Does](#9-all-applications)
10. [The Civic Alert System — The Pulse](#10-the-pulse)
11. [Decolonial Editorial Framework](#11-decolonial-editorial-framework)
12. [Source Tier Stratification](#12-source-tier-stratification)
13. [The 8 Historical Eras](#13-the-8-historical-eras)
14. [Cultural Threads & Historical Threads](#14-threads)
15. [Responsive CRT Frame System](#15-responsive-crt-frame)
16. [Tech Stack & File Map](#16-tech-stack--file-map)
17. [How to Run & Build](#17-how-to-run--build)
18. [Design Decisions & Philosophy](#18-design-decisions--philosophy)

---

## 1. The Big Picture

### What is HQ OS?

HQ OS is a **browser-based simulation of a Windows 98 desktop operating system**, rendered inside a CRT monitor bezel. It is not a gimmick. It is a **deliberate pedagogical and cultural container** — a digital Trojan horse.

The aesthetic (retro 1990s Windows 98 / CD-ROM / Microsoft Encarta) is chosen to create a safe, familiar, nostalgic interface that lowers the guard of users who might otherwise feel alienated by dense historical material. The goal: make exploring 5,000 years of Pan-African history feel like using a childhood computer.

### What is the mission?

> **The North Star**: A 19-year-old should be able to spend **20 minutes** in this environment and leave with a visceral, sourced, felt understanding that Pan-Africanism is a 5,000-year continuity — not a 1960s invention.

The target audience is **16–28 year olds** with:
- Political curiosity
- US public school backgrounds (which marginalize African history)
- Healthy skepticism of mainstream narratives
- Familiarity with technology, but not academia

### The dual approach

| Approach | How |
|---|---|
| **Primary Source Immersion** | Users read actual words of historical figures (speeches, charters, court records) — not summaries |
| **Mainstream Bridge Threads** | Every major event connects to something in standard Western curricula (e.g. Haitian Revolution → Louisiana Purchase) |

---

## 2. The OS Shell

The OS shell is built in **React 19 + TypeScript + Vite 6**. The entire system lives inside `src/App.tsx`, which:

1. Renders the **CRT monitor bezel** as an SVG overlay
2. Shows the **BootScreen** terminal simulation on first load
3. After boot, renders the **Desktop + Windows + Taskbar**
4. Routes window content via `renderAppContent(win)` switch based on `appType`

### The CRT Bezel Frame

The outer bezel is a pure SVG `<path>` with a "screen hole" punched out using `fillRule="evenodd"`. The bezel size adapts to screen size:

```
Mobile   (< 600px):   8px border   ← previously 66px, shrunk for usability
Tablet   (600–999px): 12px border
Medium   (1000–1399px): 28px border
Desktop  (≥ 1400px):  33px border
```

The screen content sits precisely inside the bezel hole at:
```
top:    borderY
left:   borderX
width:  W - (borderX * 2)
height: H - borderY - borderBottom
```

The content area has three CSS overlay layers stacked on top for atmosphere:
- `.crt-screen-vignette` — darkened corners
- `.crt-screen-filter` — slight green tint
- `.crt-screen-flicker` — subtle flicker animation

---

## 3. The Ppls Story Application

**The Ppls Story** is the central application. It is styled after **Microsoft Encarta** — a CD-ROM multimedia encyclopedia from the 1990s. It lives at `src/apps/PplsStory.tsx` and is 1,500+ lines.

### What it contains

| Feature | Description |
|---|---|
| **Interactive SVG World Map** | Pan, zoom (1×–8×), click continents to filter by region, click pins to fly-to events |
| **Chronology Slider** | Filters visible events to show only those up to a selected year |
| **Region Tabs** | All / Africa / Americas / Global / Asia / Oceania |
| **Index Panel (left)** | Scrollable list of filtered events with year + title + region badge |
| **Content Viewer (right)** | Full event detail: summary, primary source excerpt, Historical Principle box |
| **Threads Mode** | Switch the left panel to show Cultural Threads — thematic connections spanning multiple events and eras |
| **The Pulse** | System tray civic alert notifier — connects present-day local news to historical events |
| **Cross-App Launch** | Buttons launch VideoPlayer, Notepad (primary source reader), Explorer, ThreadViewer |

### Layout structure

```
┌─────────────── Menu Bar ────────────────────────────────┐
│ File │ View │ Navigate │ Help │              📂 Browse  │
├─────────────── World Map (SVG) ─────────────────────────┤
│  [Interactive pan/zoom map with event pins]              │
│  [Region Tabs: All | Africa | Americas | Global | ...]   │
│  [Chronology Slider ←───────────────────────────→]       │
├──────────── Index Panel ──┬──── Content Viewer ──────────┤
│ 📋 Index  🧵 Threads     │ [Event Title]                 │
│                           │ [Region badge] [Year] [Tags]  │
│ 1772  Somerset v Stewart  │                               │
│ 1787  Sons of Africa      │ [Summary paragraph]           │
│ 1791  Bois Caïman         │                               │
│ 1800  Gabriel's Rebellion │ 📜 Primary Source Excerpt     │
│ ...                       │ [First 300 chars of speech]   │
│                           │                               │
│                           │ 💭 Historical Principle       │
│                           │ [Core Principle]              │
│                           │ [System of Restraint]         │
│                           │ [Cultural Expression]         │
│                           │ [Reflect prompt question]     │
│                           │                               │
│                           │ [▶ Watch Video] [📄 Source]   │
│                           │ [🔍 Trace System] [📂 Files]  │
├─────────────── Status Bar ──────────────────────────────┤
│ ● Ready │ Region: All │ 62 events │ 🚨 The Pulse        │
└─────────────────────────────────────────────────────────┘
```

---

## 4. The Data Model

All types are defined in `src/apps/pplsStoryData.ts`.

### Core types

```typescript
// A single historical event/milestone
export interface TimelineEvent {
  id: string;                    // kebab-case unique ID
  year: number;                  // negative = BCE
  era?: Era;                     // One of 8 historical eras
  sourceTier?: SourceTier;       // Tier 1–5 source classification
  region: Region;                // 'Africa' | 'Americas' | 'Global' | 'Asia' | 'Oceania'
  title: string;
  summary: string;               // 2–3 dense sentences
  mediaType: MediaType;          // 'text' | 'video' | 'audio' | 'image'
  mediaPayload: string;          // VFS path or YouTube URL
  primarySourceText: string;     // Full speech/document for Notepad
  primarySourceCitation?: string;
  tags: string[];
  artist?: string;               // Speaker or creator
  location: { lat: number; lng: number; name: string };
  principle: HistoricalPrinciple; // REQUIRED — the philosophical analysis layer
}

// The philosophical wrapper around each event
export interface HistoricalPrinciple {
  corePrinciple: string;       // The mechanism of power or liberation at work
  systemOfRestraint: string;   // How this was historically withheld or weaponized
  culturalExpression: string;  // How art/space/culture manifested this
  inferencePrompt: string;     // An open-ended question for the reader
}

// A library document (for the reference shelf)
export interface LibraryDocument {
  id: string;
  title: string;
  era: Era;
  sourceTier: SourceTier;
  excerpt: string;
  commentary: string;
  citation: string;
  relatedEventId: string;      // Links back to a TimelineEvent
  fullTextVfsPath: string;     // Where to read it in the VFS
}

// A thematic thread connecting events across time (cultural)
export interface CulturalThread {
  id: string;
  title: string;
  description: string;
  connectedEventIds: string[];  // Array of TimelineEvent IDs
  visualMotif: string;
}

// A thematic thread about systems of oppression
export interface HistoricalThread {
  id: string;
  title: string;
  nature: string;
  coreIdea: string;
  mechanismOfHarm: string;
  globalTransmission: string;
  modesOfEndurance: string;
  modesOfOvercoming: string;
  connectedEventIds: string[];
  visualMotif: string;
}
```

### Region metadata

Each region has a display name and colors used for map continent fills and UI badges:

| Region | Color | Display Name |
|---|---|---|
| Africa | `#c44020` (terracotta red) | Africa & The Diaspora |
| Americas | `#2060a8` (deep blue) | The Americas |
| Global | `#20884a` (green) | Global Movements |
| Asia | `#8a2be2` (purple) | Asia & West Asia |
| Oceania | `#008080` (teal) | Oceania & Pacific |

---

## 5. The Database

The total event database is split across two files:

### `pplsStoryData.ts` — 10 Core Anchor Events

These are the foundational 10 events that seed the timeline, hand-crafted with full richness:

| ID | Year | Title |
|---|---|---|
| `victory-stela-piye` | -747 | The Victory Stela of King Piye |
| `manden-charter-kurukan-fuga` | 1236 | The Manden Charter of Kurukan Fuga |
| `bois-caiman-ceremony` | 1791 | The Bois Caïman Ceremony |
| `yaa-asantewaa-war` | 1900 | The Yaa Asantewaa War of the Golden Stool |
| `garvey-unia-declaration` | 1920 | Garvey's UNIA Declaration of Rights |
| `anc-freedom-charter` | 1955 | The ANC Freedom Charter |
| `oau-charter-1963` | 1963 | The OAU Charter |
| `cabral-national-liberation-culture` | 1970 | Cabral — National Liberation and Culture |
| `sankara-debt-speech` | 1987 | Sankara's OAU Debt Speech |
| `rhodes-must-fall` | 2015 | #RhodesMustFall Movement |

### `diasporaData.ts` — 50 Diaspora Stories

Auto-generated via `parse_diaspora.py` from `DIASPORA_50.md`. Contains 50 additional historical events spanning 1772–1994, focused on the global African diaspora. This file is **307KB** and **2,036 lines**.

```typescript
// pplsStoryData.ts merges both:
export const TIMELINE_EVENTS: TimelineEvent[] = [
  ...ANCHOR_EVENTS,
  ...DIASPORA_EVENTS,
];
// Total: 60 events in the live database
```

### Library Documents

`LIBRARY_DOCUMENTS` is a parallel array of `LibraryDocument` objects — one per event — providing a longer-form reference document with `excerpt`, `commentary`, and `citation`. These are bootstrapped into the VFS as `.txt` files on app mount.

---

## 6. The Map Engine

The world map is a custom **SVG rendering engine** inside `WorldMap` component.

### Coordinate projection (Equirectangular)

All lat/lng coordinates are projected onto a `1000 × 500` SVG viewport:

```
X = (lng + 180) × (1000 / 360)
Y = (90 - lat) × (500 / 180)
```

This maps:
- `-180°lng` → `x = 0` (left edge)
- `+180°lng` → `x = 1000` (right edge)
- `+90°lat`  → `y = 0` (top — North Pole)
- `-90°lat`  → `y = 500` (bottom — South Pole)

### Zoom & Pan mathematics

**Drag panning** converts screen pixel deltas to SVG user-space:
```
dx_svg = dx_screen × (1000 / clientWidth)
dy_svg = dy_screen × (500 / clientHeight)
```

**Cursor-centered zoom** (scroll wheel) keeps the map anchored under the cursor:
```
mapX = (cursorX_svg - translateX) / zoom
newTranslateX = cursorX_svg - (mapX × nextZoom)
```

**Clamping** prevents panning outside bounds:
```
translateX: min = 1000 × (1 - zoom),  max = 0
translateY: min = 500 × (1 - zoom),   max = 0
```

### Adaptive pin scaling

Pins counter-scale to stay the same screen size regardless of zoom level:
```svg
<g transform="translate(x, y) scale(1 / zoom)">
```

### Auto fly-to on event select

When a user selects an event, the map smoothly "flies" to center on it at `3.5×` zoom:
```
targetZoom = 3.5
tx = 1000/2 - eventX × 3.5  (then clamped)
ty = 500/2  - eventY × 3.5  (then clamped)
```
Transition: `transform 0.6s cubic-bezier(0.1, 0.8, 0.2, 1)` — feels like a camera zoom.

### Continent shapes

The map draws continent outlines as SVG `<path>` elements from hand-crafted `[lng, lat][]` polygon point arrays. Clicking a continent sets the `selectedRegion` filter. Colors match the region metadata.

### Thread connection lines (Marching Ants)

When a Cultural Thread is active, the map draws connecting lines between all events in the thread using two `<polyline>` elements:
1. A thick yellow `stroke-opacity: 0.4` base line
2. A red `stroke-dasharray="4,4"` animated overlay with SVG `<animate>` — the "marching ants" effect

---

## 7. The Virtual File System

The VFS (`src/vfs/fs.ts`) is an **in-memory file system** that mimics a real Windows 98 C: drive. It persists only for the browser session (no server, no localStorage).

### Structure

```
C:/
├── Windows/
├── Desktop/            ← VFS-backed desktop icons appear here
├── My Documents/
├── Program Files/
├── Recycled/
└── Ppls_Story/         ← Created by bootstrapVFS() on app mount
    ├── victory_stela_piye.txt
    ├── manden_charter.txt
    ├── bois_caiman_ceremony.txt
    ├── somerset-v-stewart.txt
    ├── ... (60 total .txt files — one per event)
    ├── Pulse.txt
    ├── Alert_tenant-rights.txt
    ├── Alert_grant-withholding.txt
    └── Alert_redistricting.txt
```

### API

```typescript
vfs.mkdir(path)
vfs.writeFile(path, content)
vfs.readFile(path)           // Returns string content
vfs.readdir(path)            // Returns VFSNode[]
vfs.exists(path)             // boolean
vfs.unlink(path)             // Delete file
vfs.rmdir(path)              // Delete directory
vfs.rename(oldPath, newPath)
vfs.subscribe(callback)      // React to changes (used by Explorer, Desktop)
```

### VFS Bootstrap

`bootstrapVFS()` runs once on app mount (guarded by `vfsBootstrapped` flag). It:
1. Creates `C:/Ppls_Story/`
2. Writes every `primarySourceText` from all 60 events as a `.txt` file
3. Writes `Pulse.txt` (all civic alerts combined)
4. Writes individual `Alert_*.txt` files for each civic alert

This means any user can open **Explorer → C:\Ppls_Story** and browse, open, and read all 60 historical documents as text files — a real-feeling archive on a fake computer.

---

## 8. The Window Manager

`src/wm/manager.ts` is a **Zustand store** managing all open windows.

### WindowInstance shape

```typescript
interface WindowInstance {
  id: string;          // Unique window ID (prevents duplicates)
  title: string;
  icon?: string;       // 16×16 icon path
  appType: AppType;    // Determines what component renders inside
  appProps?: any;      // Component-specific props
  x: number;          // Position
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isMinimized: boolean;
  zIndex: number;
  focused: boolean;
}
```

### AppType registry

```typescript
type AppType =
  | 'notepad'
  | 'calculator'
  | 'soundrec'
  | 'explorer'
  | 'iframe'
  | 'internet-explorer'    ← Full IE app with toolbar/history
  | 'display-properties'
  | 'webradio'
  | 'pong'
  | 'africaonly'
  | 'video-folder'
  | 'video-player'
  | 'ppls-story'
  | 'ppls-thread-viewer'
  | 'ppls-local-echo';
```

### Smart sizing

`openWindow()` applies **type-specific responsive sizing** before placing the window. For example:
- `notepad`: `65% × 60%` of desktop
- `explorer`: `75% × 65%` of desktop
- `internet-explorer`: `85% × 82%` of desktop
- `ppls-story`: `80% × 82%` of desktop
- `calculator`: fixed `260 × 260`

Windows also **cascade** (offset by `25px` per open window) so they don't stack perfectly on top of each other.

---

## 9. All Applications

| App | File | Purpose |
|---|---|---|
| **Internet Explorer** | `InternetExplorer.tsx` | Full embedded browser — address bar, back/forward history, Favorites sidebar with 10 pre-loaded Africa/Diaspora Wikipedia pages, loading progress bar, Windows 98 toolbar chrome |
| **Explorer** | `Explorer.tsx` | File manager — browse VFS directories, create/delete files and folders, open files in associated apps; Network Neighborhood shows curated web links that open in IE |
| **Notepad** | `Notepad.tsx` | Text editor — reads/writes VFS files; primary vehicle for reading full historical speeches and documents |
| **The Ppls Story** | `PplsStory.tsx` | Liberation history encyclopedia — the core application (see §3) |
| **Ppls Thread Viewer** | `PplsThreadViewer.tsx` | Diagnostic tool for Historical Threads — shows mechanism of harm, global transmission, modes of overcoming |
| **Local Echo Terminal** | `LocalEchoTerminal.tsx` | Command-line interface simulating a local OS terminal |
| **AfricaOnly.TV** | `AfricaOnlyTV.tsx` | Curated African community video streaming |
| **VideoPlayer** | `VideoPlayer.tsx` | Windows Media Player wrapper using YouTube IFrame API — custom transport controls (play/pause/seek/volume) with no YouTube overlays |
| **VideoFolder** | `VideoFolder.tsx` | Win98 Explorer views of 3 community video folders: **4 D PPL**, **WE D PPL**, **BY D PPL** |
| **WebRadio** | `WebRadio.tsx` | Internet radio client with preset stations |
| **Sound Recorder** | `SoundRecorder.tsx` | Retro sound recorder with waveform animation |
| **Calculator** | `Calculator.tsx` | Functional Win98 calculator |
| **Pong** | `Pong.tsx` | Classic arcade Pong game |
| **Paint** | iframe → `/programs/jspaint/` | Full jsPaint — MS Paint replica in browser |
| **3D Pipes** | iframe → `/programs/pipes/` | Iconic Windows 98 3D pipes screensaver |
| **Sandspiel** | iframe → sandspiel.club | Falling sand particle simulation |
| **Display Properties** | `DisplayProperties.tsx` | Change desktop wallpaper and background color |

---

## 10. The Pulse

**The Pulse** is a civic alert notification system embedded in the status bar.

### What it does

It connects **present-day local civic issues** to **historical events** in the encyclopedia — showing that history is not past, it is present.

### How it works

1. A blinking 🚨 icon in the status bar pulses at 700ms intervals
2. Clicking it opens a popup panel with 4 live civic alerts
3. Each alert has a `connectedEventId` linking it to a `TimelineEvent`
4. Clicking an alert:
   - Opens the alert as a `.txt` file in Notepad
   - Shifts the encyclopedia focus to the connected historical event
   - Flies the map to that event's location

### Current alerts

| Alert | Type | Connected Event |
|---|---|---|
| Tenant Rights Bill Vote | Legislative | Manden Charter (1236) |
| Small Business Grant Policy Shift | Economic | Asiento de Negros (1518) |
| District Redrawing Public Hearing | Civic | Sistema de Castas (1540) |
| Land Trust Meeting & Art Showcase | Cultural | Aboriginal Songlines (65,000 BCE) |

---

## 11. Decolonial Editorial Framework

### The five pillars

1. **Continuous Pan-African Narrative** — Explicit ideological linkages across millennia (Kemet → Manden Charter → Haitian Revolution → UNIA → AfCFTA)
2. **Non-Western Source Priority** — Western historiography is secondary, used only for corrective notes or bridge threads
3. **Youth-Friendly Scholar Voice** — *"A brilliant older cousin at the cookout"* — rigorous but warm, no alienating jargon
4. **Bi-Directional Causation Bridges** — Every African event shows how it *caused* global history (not just responded to it)
5. **The Historical Document as Protagonist** — Events lead with actual source excerpts; for oral tradition, the audio or oral recitation is primary

### The voice guideline

Every piece of content is calibrated against: *"Would a brilliant, rigorous 25-year-old who grew up in the community say it this way at a cookout?"*

If it sounds like a textbook → rewrite. If it sounds like Twitter → add depth.

---

## 12. Source Tier Stratification

| Tier | Category | Examples |
|---|---|---|
| **Tier 1** | Oral & Griot Traditions | Ifa corpus, Sundiata epic, Mwindo, Ozidi traditions |
| **Tier 2** | Primary Documents | Manden Charter, ANC Freedom Charter, Ma'at texts, Nkrumah speeches |
| **Tier 3** | African Scholars | Cheikh Anta Diop, Walter Rodney, Achille Mbembe, Ngũgĩ wa Thiong'o |
| **Tier 4** | Liberation Press | CODESRIA, Pambazuka, Black Agenda Report, CASAS |
| **Tier 5** | Cultural Texts | Frantz Fanon, Mariama Bâ, Léopold Senghor, Fela Kuti |

> **Rule**: Western sources are only used when explicitly marked as a "bridge use." Any claim relying on a mainstream Western source must be surfaced and labeled, not hidden.

---

## 13. The 8 Historical Eras

| Era | Period | Theme | Anchor Event |
|---|---|---|---|
| **Era 1** | c. 3000 BCE – 500 CE | Ancestral Dawn & Classical Antiquity | Victory Stela of Piye (–747) |
| **Era 2** | 500–1500 CE | Medieval & Islamic Systems | Manden Charter (1236) |
| **Era 3** | 1500–1800 | Encounter & Enslavement | Bois Caïman Ceremony (1791) |
| **Era 4** | 1800–1900 | Colonial Conquest & Resistance | Yaa Asantewaa War (1900) |
| **Era 5** | 1900–1960 | Pan-African Crystallization | Garvey UNIA Declaration (1920) |
| **Era 6** | 1960–1980 | Independence & Liberation Wars | OAU Charter (1963) |
| **Era 7** | 1980–2000 | Post-Independence & Setbacks | Sankara Debt Speech (1987) |
| **Era 8** | 2000–Present | Contemporary Resistance & Integration | #RhodesMustFall (2015) |

The TypeScript `Era` union type enforces that every event is tagged to exactly one of these eras. The UI uses these to color-code and sort events.

---

## 14. Threads

### Cultural Threads (`CulturalThread[]`)

Thematic connections tracing a single idea across multiple eras:
- Each thread has a `title`, `description`, `visualMotif`, and array of `connectedEventIds`
- In the UI, selecting a thread switches the left panel to show only those events
- On the map, **marching ant lines** connect all thread events visually
- Example thread: *"The Griot Tradition: From Oral Historians to Hip Hop"*

### Historical Threads (`HistoricalThread[]`)

Deep structural analyses of how systems of oppression travel through time:
- Each thread has `mechanismOfHarm`, `globalTransmission`, `modesOfEndurance`, `modesOfOvercoming`
- Displayed in the **Thread Viewer** app (`PplsThreadViewer.tsx`)
- Accessed via the "🔍 Trace the System" button in the Content Viewer
- Example: Tracing how the Asiento de Negros (1518) connects to modern racial capitalism

---

## 15. Responsive CRT Frame

The monitor bezel is computed dynamically in `App.tsx` every time the browser resizes:

```typescript
const borderX = W >= 1400 ? 33 : W >= 1000 ? 28 : W >= 600 ? 12 : 8;
const borderY = H >= 900  ? 33 : H >= 700  ? 28 : H >= 500  ? 10 : 8;
const borderBottom = W < 600 ? borderY * 1.2 : borderY * 1.4;
```

The screen content area is computed as:
```
top:    borderY px
left:   borderX px
width:  (windowWidth  - borderX × 2) px
height: (windowHeight - borderY - borderBottom) px
```

SVG bezel path uses `fillRule="evenodd"` — the outer rectangle and the inner "hole" polygon are both drawn in the same `<path>`, and the even-odd rule creates a transparent cutout where the screen shows through.

---

## 16. Tech Stack & File Map

### Stack

| Layer | Technology |
|---|---|
| Framework | React 19 |
| Language | TypeScript 5 |
| Bundler | Vite 6 |
| State | Zustand 5 |
| Styling | Vanilla CSS + Tailwind CSS 4 |
| No backend | 100% client-side; zero API calls at runtime |

### Critical file map

```
HQ OS/
├── src/
│   ├── App.tsx                    ← CRT frame, boot router, app renderer switch
│   ├── apps/
│   │   ├── PplsStory.tsx          ← The encyclopedia (1,505 lines)
│   │   ├── pplsStoryData.ts       ← All schemas + 10 anchor events + threads + metadata
│   │   ├── diasporaData.ts        ← 50 diaspora events (307KB, auto-generated)
│   │   ├── InternetExplorer.tsx   ← Full IE browser (address bar, history, favorites)
│   │   ├── Explorer.tsx           ← VFS file manager
│   │   ├── Notepad.tsx            ← Primary source document reader/editor
│   │   ├── PplsThreadViewer.tsx   ← Historical thread diagnostic window
│   │   ├── LocalEchoTerminal.tsx  ← Terminal emulator
│   │   ├── AfricaOnlyTV.tsx       ← Community video streaming
│   │   ├── VideoPlayer.tsx        ← YouTube wrapper w/ custom controls
│   │   ├── VideoFolder.tsx        ← 3 community video collection browsers
│   │   ├── WebRadio.tsx           ← Internet radio
│   │   ├── SoundRecorder.tsx      ← Audio recorder simulation
│   │   ├── Calculator.tsx         ← Win98 calculator
│   │   ├── Pong.tsx               ← Pong game
│   │   └── DisplayProperties.tsx ← Wallpaper/color customizer
│   ├── components/
│   │   ├── Desktop.tsx            ← Icon grid, marquee selection, right-click menu
│   │   ├── Taskbar.tsx            ← Start menu, system tray, clock, open windows
│   │   ├── Window.tsx             ← Draggable/resizable window chrome
│   │   └── BootScreen.tsx         ← BIOS terminal boot animation
│   ├── vfs/
│   │   └── fs.ts                  ← In-memory file system (MemoryFileSystem class)
│   ├── wm/
│   │   └── manager.ts             ← Zustand window manager store
│   └── styles/
│       ├── classic.css            ← Win98 borders, buttons, scrollbars
│       ├── layout.css             ← CRT overlays, scanlines, desktop grid
│       └── system.css             ← Global resets, CSS variables
├── public/
│   ├── images/icons/              ← 16px and 32px Win98 icon sets
│   └── programs/                  ← Standalone iframe apps (jspaint, pipes, etc.)
├── PPLS_STORY_PROJECT.md          ← Full project research & editorial framework
├── PPLS_STORY_GUIDE.md            ← Application architecture guide
├── PROJECT_OVERVIEW.md            ← LLM-oriented OS overview
└── DEEP_UNDERSTANDING.md          ← This file
```

---

## 17. How to Run & Build

```bash
# Install dependencies
npm install

# Start local dev server (runs on port 3001 by default)
npm run dev

# Type-check without building
npx tsc --noEmit

# Build production bundle
npm run build
```

The dev server runs at **http://localhost:3001**.

---

## 18. Design Decisions & Philosophy

### Why Windows 98?

The retro aesthetic is not decoration. It is a delivery mechanism. Users who feel intimidated by academic presentations will engage with a "nostalgic computer" because the emotional register is play, not study. The interface signals: *"This is yours. You've used this before."*

### Why primary sources first?

Secondary summaries filter reality through the summarizer's worldview. Showing the actual words of King Piye, Dutty Boukman, Yaa Asantewaa, or Thomas Sankara eliminates that intermediary layer. The metric: **70% of testers should confirm they read the actual historical figure's words**, not just a description of them.

### Why the VFS matters

Making historical documents feel like real files on a real computer creates **psychological ownership**. A user who opens `C:\Ppls_Story\manden_charter.txt` in Notepad and reads it has done something different from reading a web page. They have *navigated* to it. They have *opened* it. That is a different relationship to a text.

### Why The Pulse matters

History is not a museum. The Pulse makes the argument that every civic issue you face today has a historical root — and that understanding that root changes how you act. It is the project's most politically urgent feature.

### Why no backend?

The entire system runs client-side. No data leaves the user's browser. No accounts, no tracking, no servers to pay for. The project can be hosted on any static file host (GitHub Pages, Netlify, Vercel). The VFS is temporary by design — each session is a fresh interaction with the archive.

### The editorial constraint

Every entry in the database must be verifiable against a real uploaded primary source. No date, quote, or claim can rest on secondary memory alone. This immunizes the platform against what the project calls **"Citation Hallucinations"** — the risk of AI-assisted content introducing invented or distorted historical facts.

---

*Last updated: 2026-06-21 — reflecting 60 live events (10 anchor + 50 diaspora), full IE application, responsive CRT bezel, and all core OS features.*
