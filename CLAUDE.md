# CLAUDE.md — Steal A Fish

## Project

Steal A Fish is a **desktop game for TikTok Live streamers**. Viewers drive the game with gifts, likes, comments, follows and shares. The streamer runs the app and captures the game window into OBS.

Core idea: an idle/gacha fishing game with a "Steal an Egg"–style feel. Viewers cast lines with gifts and catch fish — mostly real-world sized, but now and then with absurd weights (millions to trillions of kg and beyond), collect them into a personal tank that generates coins, and steal fish from each other.

Status: playable loop with the simulator — rounds, joining, catches (species, rarity, pity, mutations, weights), ranking and a round summary. Not built yet: persistence (SQLite), tank/coins, steal/guard, ponds beyond the village. The planning doc lives outside the repo (Claude Doc "Steal A Fish — แผนเกม 3D").

## Language

- All player-facing text (overlay, settings UI) is **Thai**. Keep strings in one i18n file (`apps/desktop/src/shared/strings.th.ts`, shared by the main process and the renderers), not scattered in code.
- Code, identifiers, commit messages and code comments are **English**.

## Stack

| Part | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Desktop shell | Electron — a **game window** and a separate **settings window**, built with `electron-vite` |
| Game renderer | Babylon.js + TypeScript (Vite, via electron-vite) |
| In-game UI (result cards, leaderboard) | HTML/CSS layered over the Babylon canvas (crisper Thai text than Babylon GUI) |
| Settings UI | React (Vite, via electron-vite) — not Next.js |
| TikTok Live events | `tiktok-live-connector` (Node, runs in Electron main process), wrapped behind a `LiveSource` interface |
| Persistence | SQLite (`better-sqlite3`) in the app's userData folder |
| Big numbers | `break_infinity.js` |
| Packaging | electron-builder → Windows `.exe` (NSIS + portable), macOS `.dmg` (universal) |
| CI / release | GitHub Actions: build on push, publish release artifacts on version tag |

The streamer captures the game window with OBS Window/Game Capture. Do not render the 3D scene twice (no extra browser-source copy).

**No server.** The game is a self-contained desktop app; all logic runs in the Electron main process. Do not add Next.js or NestJS to the desktop app. They are reserved for future online features (cross-stream leaderboard, public collection pages, streamer accounts/licensing, cloud-hosted connector), which would land as `apps/web` (Next.js) and `apps/api` (NestJS + PostgreSQL) reusing `packages/core`.

## Architecture

```
Electron main process
 ├─ LiveSource (TikTok connector | Simulator)  → normalized events
 ├─ RuleEngine (rules.json)                    → game actions
 ├─ GameCore (RNG, catches, steals, coins)     → SQLite
 └─ IPC → game window (Babylon + HTML overlay)
        → settings window (React)
```

- `LiveSource` is an interface. Implementations: `TikTokLiveSource` and `SimulatedLiveSource` (keyboard/buttons in settings). The game must be fully playable with the simulator, without going live.
- **All randomness and game state live in the main process.** Renderers only play animations for results they receive. Never roll RNG in a renderer.
- Results are computed and saved immediately; animations play from a display queue. Epic+ results may jump the queue.

## Event handling rules

- **Gift streaks**: streakable gifts fire repeatedly during a combo. Count only when the streak ends (`repeatEnd`) and use `repeatCount`. Non-streakable gifts count immediately.
- **Idempotency**: store each TikTok event id in `gift_events`; ignore duplicates.
- **Likes arrive in bursts**: aggregate and throttle; never trigger one effect per like event.
- **Identity**: key players by TikTok `userId`, never by `uniqueId`/username (usernames change). Store the latest display name and avatar URL.
- **Connection drops are normal**: auto-reconnect with backoff, log raw events so lost gifts can be compensated.

## Gift → event rules (config)

Rules live in `rules.json` in userData, hot-reloaded, and edited through the settings window (which reads and writes the same file). Shape:

```json
{
  "rules": [
    { "trigger": { "type": "gift", "giftId": 5655 },     "action": { "type": "cast", "count": 1 } },
    { "trigger": { "type": "gift", "minDiamonds": 99 },  "action": { "type": "net", "count": 5 } },
    { "trigger": { "type": "likes", "every": 10000 },    "action": { "type": "frenzy", "durationSec": 30, "rareMultiplier": 3 } },
    { "trigger": { "type": "comment", "command": "!สมุด" }, "action": { "type": "showCollection", "cooldownSec": 30 } }
  ]
}
```

- Trigger types: `gift` (by `giftId`, `giftName` or `minDiamonds`), `likes` (`perViewer: true` counts each viewer's own likes, else the room's), `comment`, `follow`, `share`.
- Action types: `cast` (optional `minRarity`, `minPoints` guarantees), `lucky` (weighted options, each a cast), `net`, `steal`, `guard`, `frenzy`, `showCollection`, `boost`.
- When several rules match, the most specific wins: `giftId` beats `giftName` beats `minDiamonds`; higher `minDiamonds` beats lower.
- Validate the file with a schema (zod) on load; on error keep the last valid rules and show the error in settings.

## Game rules (current design)

- **Rounds** (`RoundGame` in `packages/core`): a round lasts 5 minutes, then a 60 s summary, then the next round opens. Viewers join a round by typing exactly `1` in chat (built into the main process, not a rule); joining during the summary reserves a spot in the next round, and everyone must join again each round. There are no free timed casts: **every 50 of a viewer's own likes is one cast worth 50–300 points** (Common–Rare; per-viewer likes rule, default 50, set in settings), and gifts are casts with a guarantee (below); likers and gifters who haven't joined are joined automatically (nothing is wasted). Ranking — and the yacht podium and crown — is by the **total sell price of every fish** a player caught this round.
- **Round summary**: podium plus a one-fish-at-a-time viewer. Each fish is shown at **true scale** on the reveal stage (`reveal.exhibit`) beside its owner standing on a small platform, with the same scale references as the reveal, while the camera drifts around it. ←/→ steps through the current player's fish (most valuable first; past either end moves to the neighbouring player), ↑/↓ changes player; with no key presses it shows each player's best fish in turn. No tank: a fish is never shrunk to fit a box.
- **Gifts** (default rules, `defaultRules.ts`, `RULES_VERSION` 6 — older rules.json files are backed up and upgraded: pre-v2 replaced, later ones keep the streamer's edits, gain new default rules by id, and have re-balanced rules (`RULES_REFRESH`) get the new default action while keeping their trigger): matched by coin value, each one cast whose points stay within the tier's range (`minPoints`/`maxPoints`, clamped) and whose rarity stays within a matching band (`minRarity`/`maxRarity`), so the fish fits its points — Rose 1 coin: 50–600 pts (Uncommon–Rare); Finger Heart (มินิฮาร์ท) 5: 250–3,000 (Rare–Epic); Rosa 10: 500–6,000 (Epic–Legendary); Doughnut 30: 2,000–25,000 (Epic–Legendary); Hand Hearts (อุ้มใจ) 100: 10,000+ (Legendary+, no cap — always a big catch with the full scene). A new follower (once per viewer) gets the same as a Rosa. Perfume (by name) steals one random fish from the #1 player (from #2 if the thief is #1; the victim gets consolation pity). ใจส้ม (by name, "Heart Me" until confirmed) is a lucky draw over the five tiers (40/25/18/12/5%). Settings publishes the gift table.
- **During play** (a big crowd catches every few seconds): only **big catches** show — worth 10,000+ points (`BIG_CATCH_POINTS`), or a neutron-star / black-hole fish. They get the full reveal (a card if two reveals are already waiting) and a feed line. **Every** catch pops "+points" over the catcher's head (bigger and in the rarity colour for big catches); other than that pop, a small catch only raises the player's round total, which shows above their name tag all the time (tags reach the whole bay from the overview and shrink with distance). On every catch card the points are the headline and the catcher's name is as big as the fish's name; weight and length are a small line under them. In the summary the player's name is as big as the fish's name. No game title on screen.
- **Leaderboard overlay** (`src/main/overlay.ts`): the app serves a page on `http://localhost:37821/leaderboard/index.html` (next free port up to 37825; listening on 127.0.0.1 and ::1 only, so this computer only; older paths like `/leaderboard` still answer) that the streamer adds to TikTok LIVE Studio (or OBS) as a Link/Browser source; settings shows the link with a copy button. The page is a fixed **131 px** wide (131 × 368 for 10 rows) and shows only the standings — no round number, clock or join hint; it is hidden while nobody has points. Each row is a rank badge (gold/silver/bronze for the top 3, a crown on #1) beside the name with the points under it. It polls `/leaderboard.json` (`RoundGame.standings()`) every second: top 10 visible, the rest scroll (wheel/drag, no visible scrollbar), and with nobody touching it the list scrolls itself slowly down and back (`?auto=0` turns that off). Thai text (settings hint) comes from the shared i18n file.
- **Catches** (`rollCatch` in `fish.ts`): rarity from the published table (Rare+ boosted ×rareMultiplier during FISH FRENZY, ×1.5 with special bait), species by rarity (weighted within a tier: the rarest legends — Godzilla, the Sea Eater — are rarer still; `speciesPercents()` publishes every species' chance), natural size variation (about ±30%), a **size class**, and independent stacking mutations. Species have real-world base weights (ปลาหมอ ~150 g … ปลาบึก ~250 kg, shark ~1 t, blue whale ~120 t), legends legendary ones (Nessie ~2 t, megalodon ~50 t, El Gran Maja ~400 t, Bloop ~800 t, Godzilla ~20,000 t, Sea Eater ~1,000,000 t), so ~86% of catches weigh under 10 kg. Size classes: normal ~90%, ตัวโต 7% (×5–20 weight, ×3 price), ยักษ์ 2.4% (×10³–10⁴, ×20), ไททัน 0.5% (×10⁶–10⁷, ×150), มหึมา 0.1% (×10⁹–10¹⁰, ×1,000). The absurd weights come from rare size classes and mutations stacking. Titan/colossal catches also get the big-catch reveal. Species ids live in core; Thai names live in the renderer's i18n file.
- **Sell price** (`priceOf`): species price × size variation (×2 size = ×2 price) × the size class's price multiplier × each mutation's `priceMultiplier` (gold ×3, diamond ×10, lava ×25, neutron star ×100, black hole ×1,000 — much gentler than the weight multipliers). Prices are in-game points (shown as "แต้ม" with ⭐) only; the full price table is published in settings next to the drop rates.

- **Weight** = real-world base weight × size variation × size class multiplier × mutation multipliers (stack) × pond/rod multiplier (later).
- **Mutations** (initial): gold ×5, diamond ×50, lava ×200, neutron star ×10,000, black hole ×1,000,000.
- **Rarity**: Common → Uncommon → Rare → Epic → Legendary → Mythic. Pity: guaranteed Rare+ after 30 casts without one.
- **Tank**: catches produce coins per second by weight. Compute lazily (`coins += rate × elapsed`) when read; no per-second ticking.
- **Steal**: a configured gift tries to steal the heaviest fish of the #1 player, with a success rate. Victims get consolation pity. A guard action blocks steals for a time.
- **Ponds**: village → Mekong → deep sea → space → black-hole dimension; base weights differ by ~1000×.
- Store weights as `weight_log10` (REAL) for sorting/leaderboards plus a display-safe representation; never rely on JS `number` above ~1e308.

## Visual direction

- **HD-2D**: low-poly 3D environment with pixel textures; characters are 2D pixel-art sprites on billboard **plane meshes** (not `SpriteManager`). Nearest filtering on pixel textures.
- The camera **orbits 360°** around the fisher (drag to rotate, wheel to zoom). Character sprites are directional: each character is described as SDF shapes and baked into toon-shaded, outlined pixel frames for 16 view directions (`fisherSprite.ts`); the billboard shows the frame matching the camera angle. Characters are left/right symmetric, so only 9 directions are baked and the rest are mirrored. Baking runs from a time-budgeted queue (a few ms per frame; the direction on screen first, the rest warming in the background, nearest finished direction shown meanwhile) — never bake synchronously in the render loop. Lighting is baked into the frames (sprite material is unlit) and a blob shadow sits under the sprite. Held props (the rod) are 3D meshes anchored at the sprite's hand point.
- **Fishing spots**: every active viewer gets their own fisher — 101 in all. Ranks 1–3 fish from a white motor yacht (#1 on the bow); everyone else fills the dock (8 seats; the streamer's fisher keeps seat 0), then five bamboo rafts (8 seats each, they bob on the swell), then the beach (50 standing spots, a standing sprite stance). A viewer who acts takes a free spot, or the longest-idle regular viewer's spot when full; idle viewers leave after 3 minutes (not the host or the podium). Name tags are HTML over the canvas. Per-fisher props (rod, bucket, bobber, blob shadow) are instances of shared meshes and all fishing lines are one line system, so draw calls stay flat as the crowd grows.
- **Camera**: ←/→ (or A/D) in the game window flies to each fisher in turn (yacht, dock, rafts, beach); Esc returns to the overview. Mouse drag/wheel still orbit and zoom.
- **Crown**: the #1 player wears a floating 3D gold crown (and a gold name tag). Rank lives in the main process (`RoundGame`'s `Leaderboard`, by total fish value; the top 3 go over IPC `game:podium`); the current champion keeps the crown on a tie.
- **Avatars**: each viewer's face and outfit (skin, hair, hat, eyes, facial hair/glasses, top + pattern, neck wear, bottoms, shoes) comes from `avatarFor(userId)` in `packages/core` — deterministic from the userId, so the same viewer looks the same every stream with nothing stored. Sprite frames are cached per look.
- Post-processing via `DefaultRenderingPipeline`: tilt-shift depth of field, bloom, vignette, light grain. Narrow-FOV perspective camera, ~30° downward.
- **Big fish are shown big, not just as numbers.** Length ≈ 0.4 m × kg^(1/3). The big-catch reveal (`reveal.ts`, ~8 s) plays for big catches (10,000+ points or a density mutation): hook (camera flies to the catcher, rod strikes, "ติดเบ็ด!") → white flash to a reveal stage far out at sea → the fish bursts out of the water → the camera dollies back while scale references pop in beside it (the catcher's own sprite, boat, house, temple, skyscraper, Doi Inthanon, Everest, Moon, Earth — only those between ~1/60 and 2.5× the fish's length) → flash back. At most two reveals wait (Mythic and density jump the queue); the rest fall back to catch cards, which pause while a reveal plays.
- **Do not build kilometre-scale geometry.** On the reveal stage the fish is always 4 units long and every reference is scaled to it (units per metre = 4 / fish length), so a 13 km fish next to Everest stays engine-friendly. Fake distance with fog and DOF. Use logarithmic depth only if depth artifacts appear.
- Density mutations (black hole, neutron star) get a cosmic showpiece (`cosmic.ts`), then the opposite joke. In the reveal (~11.6 s) the fish hovers over a dock beside the catcher, shown enlarged as the star of its effect while the power builds ("พลังดาวนิวตรอน!" / "หลุมดำเปิดออกแล้ว!"): a pulsar (white core behind the fish, two beams sweeping like a lighthouse, magnetic field loops, shockwaves across the sea) or a black hole (event horizon behind the fish, photon ring and lensing halo, spinning accretion disk, jets, debris stretched as it falls in, a whirlpool), under a starry deep-space sky with the sea darkened. Then it implodes (flash), the fish shrinks to its real 2 cm with a label saying so, drops onto the dock and snaps it in half (camera shake); the card adds a density fun fact. The effect takes a `power` (0…1) so it can build and implode. In the summary the fish is shown enlarged with its effect, labelled "ภาพขยาย · ตัวจริงยาวแค่ 2 ซม.". Their materials have a fresnel rim light (blue-white / violet) so they stay visible inside their own effects.
- Fish (`fishModels.ts`): one low-poly model per species from a `LOOKS` table (body height/width, hump, belly, head shape, taper, two-tone colours + pattern in vertex colours, tail type, dorsal and anal fins, mouth, eye size, barbels, feelers), so each species has its own silhouette. Fins are seated with `edgeAt`, which follows the exact body shaping (`shapeY`), and their bases sink `FIN_INSET` into the body so they never float; pectoral and pelvic fins splay out from the flank; the tail is a separate pivot that wiggles, with a base that reaches into the body. **ปลาพญานาค is not a fish model**: `createNaga` builds a three-headed serpent (swaying tube body with a scale texture, flame crest along the back, heads sculpted from a deformed sphere (`skullShapeY`; `skullSurfaceY`, `jawTop` and `seat` put fangs, brows, whiskers and the crown exactly on that surface so nothing floats): heavy brows, upturned snout, a hinged jaw that opens in a slow roar, forked tongue, fangs, glowing slit eyes, flame brows and cheek flames, curling gold whiskers, a hood of flame tongues (`flameBlade`) and a tiered Thai crown (ชฎา)). Mutations are materials: gold, translucent diamond, pulsing lava glow, glowing neutron star, black body + orbiting accretion ring for black hole (the rarest mutation decides the look).
- Creatures (`creatures.ts`): the big ones are built from their own parts, not the fish parameter table — shark, megalodon (open jaws, rows of teeth), orca and blue whale (horizontal flukes), Nessie (orange plesiosaur with a wavy red back and paddle flippers), Bloop (pale giant whose head is one gaping mouth), El Gran Maja (dark-blue whale-shaped titan, huge black mouth with jagged teeth, a row of glowing cyan eyes), Godzilla (upright kaiju with glowing back plates and a swinging tail), Sea Eater (worm body that is all mouth, rings of needle teeth, four long spindly legs). A template is a static vertex-coloured body, moving parts on pivots (tails, flukes, jaws, flippers, legs) and optional glowing parts that keep their light under any mutation; `probe()` reads the built body back to seat fins, teeth and eyes on it. Shared building blocks live in `modelKit.ts`.
- Effects (`effects.ts`, used by the reveal and the exhibit): a glow layer limited to listed meshes (only self-lit finishes and effect meshes; metal and scales stay crisp); Legendary+ get a turning fan of god rays and rising gold motes; Mythic adds halo rings, a beam of light from the sky and a violet-gold sky dome (kept inside the bay's sky sphere); each mutation has a particle signature (gold glitter, diamond twinkles, lava embers + smoke, and the cosmic showpieces for neutron star and black hole).
- Portrait 9:16, target 1080×1920 at 60 fps. Provide quality presets (DOF off, lower shadows, render scale) because the streamer's PC is also encoding video.

## Hard constraints

- **No real-world value.** Coins and fish can never be exchanged for money, items or anything outside the game, and cannot be traded between players. This avoids gambling-like mechanics. Show drop rates publicly in the settings/overlay.
- `tiktok-live-connector` is unofficial and may break or require a sign server/API key. Keep all TikTok-specific code inside `TikTokLiveSource`.
- Never commit API keys or session cookies. Use the OS keychain or an untracked config file.
- Unsigned builds trigger Windows SmartScreen and macOS Gatekeeper warnings. Document the workaround in the README until signing is set up.

## Repository conventions

- TypeScript strict mode everywhere.
- Layout:
  - `apps/desktop/` — electron-vite app
    - `src/main/` — Electron main process (windows, IPC, wiring LiveSource → RuleEngine → GameCore)
    - `src/preload/` — `contextBridge` API exposed to renderers (`window.saf`)
    - `src/renderer/game/` — Babylon scene + HTML overlay
    - `src/renderer/settings/` — React settings UI
  - `packages/core/` — game rules, RNG, rule engine (pure TS, no Electron/Babylon/Node-only imports; unit-tested)
  - `packages/live/` — `LiveSource` interface and implementations
  - `packages/config/` — shared tsconfig
  - Future: `apps/web/` (Next.js), `apps/api/` (NestJS)
- Game logic in `packages/core` must be deterministic given a seeded RNG, so it can be unit-tested (Vitest).
- Workspace packages are consumed as TypeScript source (`"main": "src/index.ts"`); the desktop app bundles them. No separate build step for packages.
- Renderers get `contextIsolation: true`, `nodeIntegration: false`; everything they need goes through the preload API.

## Commands

```bash
pnpm install          # install all workspaces
pnpm dev              # run the desktop app in dev mode (electron-vite, HMR)
pnpm test             # Vitest across packages
pnpm typecheck        # tsc --noEmit across workspaces
pnpm build            # bundle main/preload/renderers
pnpm --filter @saf/desktop dist   # package installers for the current OS (electron-builder)
```

Releases: push a tag `v*` → GitHub Actions builds Windows and macOS installers and attaches them to a draft release.
