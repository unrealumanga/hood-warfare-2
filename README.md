# Hood Warfare 2

A 3D first-person arcade shooter set in **Bell Yard**, an Inkline Town–inspired printworks district, built with TypeScript, [`@typeonce/ritmo`](https://github.com/typeonce-dev/ritmo), Three.js, Vite, and WebSockets (`ws`).

---

## Features

- **Play Offline**: Instant 3v3 Bell Yard Mural Control (1 human + 5 bots) plus **Elite Duel (Shielded Printworks Foreman)**, **Solo Extraction (Press Vault)**, **Foundry Skirmish (Colossus Rotary Press)**, and optional **Low-Gravity Courtyard Anomaly**. Runs 100% locally with zero network dependencies.
- **Play Online**: Create or join a room by 4-letter code (1–6 human players, bots fill open slots). Mid-match joiners take over a bot on its next spawn; departing humans yield their slot to a bot; closing the room creator's browser leaves all remaining clients playing on the authoritative Node server. Raw WebSocket URL sits under **Advanced connection settings** alongside a live retryable server status badge.
- **Bell Yard Inkline 3D Environment**: High-key paper ground (`#f0f2ec`), gray-green ink (`#3d4943`), 3-band cel shading with screen-space pen hatching & halftone shadows, instanced eye-level printworks detail (`src/client/yardDetails.ts`: strapped freight crates, corrugated press-hall goods doors with threshold dust, Line 04 tram bogies seated on steel rails + timetable plate, riveted footbridge splices, brass stair nosings, flush street drains), and an overhead moving **Cable Car**.
- **Tactical Ink Kit (Milestones 1–3)**:
  - **Sketch & Erase (`Q` / `LMB` / `E`)**: Draw anchored shortcuts across the Footbridge → Upper Loading Deck alley gap (or free-place planks & waist-high barricades sharing your ink charge), erase rival constructs within melee reach (`E`), and perform a timed melee **Ink Parry (`F`)** to reflect enemy bolts.
  - **Ink Smoke (`G`)**: Bounded 3D voxel smoke cloud that blocks bot sight; projectiles carve temporary 3s sightline channels and explosive press-barrel blasts clear a 3D sphere.
  - **Target-Sensitive Grapple (`C` / `RMB`)**: Pull yourself to marked rooftop/balcony ledges (Space releases mid-flight) or yank movable press barrels and light-armor targets toward you.
- **4 Core Guns + Cursed Loadout + 2 Armors + Locker**:
  - **Proof Pistol** (Sidearm `[2]`): 20 dmg, 12 mag, semi-auto.
  - **Roller SMG** (Primary `[1]`): 10 dmg, ~9 shots/sec, 30 mag.
  - **Broadside** (Primary `[1]`): 5-pellet wide fan, 8 dmg/pellet, 1 shot/sec, 5 volleys mag.
  - **Linecaster** (Primary `[1]`): slow bright straight bolt, 48 dmg, 1.2 shots/sec, 6 mag.
  - **Cursed Proof-Block** (Voluntary single-shot primary): 88 dmg, 1-round breech, `1.5×` match score applied once, unlocks the **Gilded Folio** swatch and returns to your normal primary next run.
  - **Light Vest** (+25 armor, 100% speed) & **Heavy Press Plate** (+50 armor, 90% speed, thick vest silhouette).

---

## Commands

### 1. Install Dependencies (using lockfile)

```bash
npm ci
```

### 2. Single-Command Local Development (Recommended)

Starts both the authoritative WebSocket server (`ws://localhost:8787`) and Vite dev client (`http://localhost:5173`) together, checks for occupied ports with actionable errors, and stops both cleanly on `Ctrl+C`:

```bash
npm run dev:all
```

Or run them separately for debugging:

```bash
npm run dev:server   # Node authoritative WebSocket server (port 8787)
npm run dev          # Vite browser client (port 5173)
```

### 3. Production Build & Server

```bash
npm run build
npm run start:server
```

Serves both the built client (`dist/`) and authoritative WebSocket server on `http://localhost:8787`.

### 4. Hosted WSS Configuration

Configure a remote WebSocket server via any of:
1. Build-time env var: `VITE_WS_URL=wss://your-server.example.com npm run build:client`
2. URL query param: `https://your-client.example.com/?ws=wss://your-server.example.com`
3. Title screen → **Advanced connection settings** input field.

### 5. Verification Suite

```bash
npm run check
```

Runs `tsc --noEmit`, `oxlint` (including `@typeonce/oxlint-plugin-ritmo`), `ritmo-devtools lint src/lint.ts`, and `vitest run` (`tests/sim.test.ts`, `tests/milestones.test.ts`, `tests/online.test.ts`).

---

## Controls

| Input | Action |
|---|---|
| `W A S D` | Move |
| `Mouse` | Aim (first click captures pointer lock without firing or spending sketch charges) |
| `Left Click` | Fire (or commit active Sketch preview) |
| `R` | Reload |
| `Space` | Jump (or release active Grapple mid-air) |
| `1` / `2` | Switch Primary / Proof Pistol sidearm |
| `Q` | Cycle Sketch preview (`Anchor / Free Plank` → `Barricade` → `Cancel`) |
| `E` | Erase rival construct within melee reach |
| `F` | Timed melee Ink Parry (reflects incoming bolts) |
| `G` | Throw Ink Smoke canister |
| `C` / `Right Click` | Target-sensitive Grapple (ledge pull-self or barrel/target pull) |
| `Escape` | Cancel Sketch preview or release pointer lock & open menu |

---

## Reproducing Key Acceptance Encounters

- **Bell Yard Visual Inspection (`1280×720`)**: Start `npm run start:server` and open `http://localhost:8787/?inspect=courtyard`, `?inspect=deck`, or `?inspect=tram` to inspect matched eye-level views with HUD and a contested courtyard zone.
- **Milestone 1 Sketch Plank Crossing & Erase**: Climb onto the central Footbridge, look north at the blue/brass anchor post facing the Upper Loading Deck, press `Q` then `LMB` to draw the plank, cross it, and have a rival press `E` within melee reach to erase it.
- **Two-Browser Online Resilience**: Open two tabs at `http://localhost:8787`, click **Create Room** in Tab 1, join the 4-letter code in Tab 2, start the match, then close Tab 1 — Tab 2 continues playing seamlessly while bots fill the departed slot.
