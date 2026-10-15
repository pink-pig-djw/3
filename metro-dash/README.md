# 地铁疾跑 · METRO DASH

A 3D endless runner for the browser: three lanes, trains, ramps, barriers, power-ups, and a patrol guard on your heels.
The game is a single self-contained HTML file (code, models, animations, and styles all inline). It runs by double-clicking it, from any static host, or inside an Android WebView.

- Play it: open `dist/index.html`
- Protagonist: **七海** (Sakurai Nanami, VRoid model); the chaser is a **巡站员** (station patrol guard)
- All textures are drawn on canvas at runtime; all music and sound effects are synthesized live with WebAudio. No external image or audio files are needed.

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Switch lanes | Swipe left/right | ← → / A D |
| Jump | Swipe up | ↑ / W |
| Roll (fast drop in the air) | Swipe down | ↓ / S |
| Hoverboard (30 s) | Double-tap / button at bottom right | Space |
| Pause | Button at top left | Esc / P |

## Five zones

The farther you run, the more zones you unlock, and each later zone is flashier. Every boundary has a gate showing the zone name; crossing it triggers the zone title banner and a screen flash, and the sky, lighting, fog, and music shift gradually.

| Zone | Distance | Scene | Music |
| --- | --- | --- | --- |
| Zone 1 晴空街区 | 0 m | Bright city, graffiti walls, tunnels, stations | 98 BPM street beat |
| Zone 2 夕阳海港 | 550 m | Giant setting sun, sea, gantry cranes, container stacks, palm trees, truss bridge | 92 BPM chill + pad |
| Zone 3 霓虹夜城 | 1300 m | Starry night, neon signs, glowing graffiti, lit train windows, neon-ring arcade, light rain | 108 BPM + arpeggio |
| Zone 4 赛博网格 | 2150 m | Synthwave striped sun, glowing grid floor, wireframe towers, holographic rings, sweeping lasers, maglev trains | 118 BPM synthwave |
| Zone 5 星河轨道 | 3100 m | Floating space bridge, nebula, aurora, ringed planet, asteroids, crystals, warp tunnel | 124 BPM four-on-the-floor |

After 4100 m the zones cycle through 霓虹 → 赛博 → 星河. FOV also widens as speed rises.

## Gameplay

- Hitting a train or barrier head-on ends the run. Scraping the side of a train while switching lanes makes you stumble and brings the guard after you; stumble again within 6 seconds and you're caught.
- Run up the yellow-and-black ramps onto the train roofs; trains with headlights on are oncoming.
- Power-ups: coin magnet, jetpack (collect coins in the sky), super sneakers (jump onto trains), score ×2.
- The shop sells hoverboards and power-up duration upgrades (5 levels), and unlocks the second outfit (denim shorts).
- After a crash you can spend coins to keep running (300, doubling each time).
- Speed rises with distance, and oncoming trains, zigzags, and train walls show up progressively.
- Progress (high score, coins, upgrades) is saved in the browser's localStorage.

## Directory layout

```
metro-dash/
  dist/index.html          playable single-file build (committed)
  src/                     source code
    main.js                state machine, physics/collision, scoring, camera
    level.js               level pattern generator, coins, power-ups
    world.js               scenery chunks and zone gates for all five zones
    themes.js              zone data (sky / light / fog / particles) and distance → zone mapping
    sky.js                 procedural sky shader (sun, stars, nebula, aurora, planet)
    scenetex.js            textures for the later zones (neon signs, grid, maglev trains, etc.)
    props.js               meshes for trains, ramps, barriers, coins, power-ups
    characters.js          VRM loading, animation playback, expressions, props
    textures.js            canvas-drawn textures (trains, graffiti, track, etc.)
    audio.js               synthesized sound effects and background music
    curve.js               curved-world vertex shader
  assets/
    nanami-hoodie.vrm      Nanami (pink hoodie), slimmed
    nanami-denim.vrm       Nanami (denim shorts), slimmed
    guard.vrm              patrol guard (from 男学生2), slimmed
    anims.json             Mixamo animations retargeted to the VRM humanoid skeleton
  tools/
    build.mjs              bundles everything into dist/index.html
    slim_vrm.py            VRM slimming (textures→WebP, facial morphs trimmed, vertex data compressed)
    convert-anims.mjs      Mixamo FBX → VRM animation retargeting
    smoke-test.cjs         headless Chromium smoke test
```

## Building

```bash
npm install
npm run build            # outputs dist/index.html
npm test                 # headless browser smoke test (needs Chromium; path set via CHROMIUM)
```

Regenerating assets (only needed after changing models or animations):

```bash
# animations: from the mixamoLibrary repo
node tools/convert-anims.mjs ../../mixamoLibrary
# models: from the vroid repo
python3 tools/slim_vrm.py "<vroid>/Sakurai Nanami2.vrm" assets/nanami-hoodie.vrm
python3 tools/slim_vrm.py "<vroid>/Sakurai Nanami4.vrm" assets/nanami-denim.vrm
python3 tools/slim_vrm.py "<vroid>/男学生2.vrm" assets/guard.vrm
```

## Asset sources

- Character models: VRoid models in the `pink-pig-djw/vroid` repository, author Nanami Chiaki (VRM 1.0 license; see each model's meta for terms).
- Animations: Mixamo motions from the `pink-pig-djw/mixamoLibrary` repository (Fast Run, Running Jump, Sprinting Forward Roll, Falling Back Death, Hip Hop Dancing, and others).
- Game mechanics are inspired by classic endless runners; characters, scenery, UI, and music are all original to this project.
