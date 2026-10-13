# Backlog

Things we want to take care of later, roughly in priority order within each section.

## Features

- **Automatic scarecrows.** One action that adds the minimum number of scarecrows needed so every planted crop tile is covered.
  - Scarecrow range is every tile within euclidean distance < 9 (248 tiles, not counting the scarecrow's own tile); a deluxe scarecrow is < 17 (888 tiles). `src/app/core/plan/range.ts` already computes both.
  - Finding the true minimum is a set-cover problem (NP-hard), so we need a good heuristic plus a bound:
    - Candidate positions: every empty tile where a scarecrow can legally go (accessible, not occupied), including tiles inside the crop field.
    - Greedy set cover (repeatedly pick the candidate covering the most still-uncovered crops) as the baseline, then improve it with local search (try removing each scarecrow, or swapping one for another).
    - For small fields, an exact ILP / branch-and-bound solve may be fast enough. Compare it with greedy before deciding.
    - Options: regular vs deluxe scarecrows; whether a placed scarecrow may replace a crop tile (costs one crop, sometimes saves a scarecrow); keep or ignore scarecrows that are already placed.
  - Should be a single undoable step, with the chosen tiles previewed before committing.
- **Rectangles of plants and machines.** Dragging with a crop or a 1×1 machine selected already fills the rectangle (machines are tiled across it). Sprinklers and scarecrows instead get a coverage layout (`src/app/core/plan/coverage-layout.ts`). Scarecrows currently use only the greedy pass; the backlog item above can replace it. Still to do:
  - Show a live count while dragging ("24 kegs").
  - Hollow/outline rectangles (fence and path borders).
  - Patterned fills, such as crops with sprinklers spaced on a grid, or rows with walkway gaps.
  - Larger objects (e.g. 3×3 trees, sheds) fill the rectangle by stepping their footprint. Check this feels right.
- Freehand brush (paint tile by tile while dragging) alongside the rectangle brush.
- Multi-select improvements: shift-click to add or remove items, arrow keys to nudge the selection, copy/paste.
- "Can't place here" feedback when a move or placement is blocked (currently it fails silently, apart from the red tiles while dragging).
- Season switcher (spring/summer/fall/winter backgrounds and tree sprites).
- Fence and path autotiling, so connected fences and paths join up visually.
- Import a Stardew Valley save file.
- Accounts and server-side saved plans (the main reason for the Angular app): sign-in, a "My plans" list, and short share links as an alternative to the long `#p=` hash links.
- Mobile and touch: pinch to zoom, two-finger pan, long-press for the quick search.
- Translations / i18n.

## Features the v3 planner has that we don't

From v3's public controls, FAQ and changelog (not its code):

- Furniture, and interior planning for the farmhouse (including upgrades and the cellar).
- Seasonal versions of trees and grass, plus a season switcher.
- More placeables: truffle, mystic tree, green rain trees, blue grass, pet bowl, big chest and the other 1.6 crops and craftables.
- Wild trees (oak, maple, pine) next to each other. Our trees use a 3×3 footprint, which blocks this; wild trees need a 1×1 footprint with a larger sprite, and fruit trees keep the 3×3 clearance.
- Gates placed over fences.
- Uploading a custom layout image (PNG).
- Stardew Valley Expanded layouts (Immersive Farm 2 Remastered, Grandpa's Farm, Frontier Farm, Ferngill Republic Frontier).
- Meadowlands restriction data.
- Save game import, and 11 languages (both also listed above).
- A dedicated multi-select mode (M) with Enter to confirm and Esc to cancel moves.
- Crops drawn in their ready-to-harvest state.

## Data & assets

- The greenhouse ruins (dirt pad and stone step) are still painted into the background and show when the greenhouse is moved.
- The farmhouse's mailbox is drawn with the house but doesn't block placement on its tile.
- Wider "room to move" around the default buildings is a guess (3 tiles either side). Check it against the game.
- Big Coop, Deluxe Coop, Deluxe Barn and Big Shed reuse the base building's sprite, so they look the same on the map. They need their own sprites.
- Missing 1.6 content: new machines (fish smoker, dehydrator, bait maker, mushroom log, etc.), new crops and trees, the big chest, the pet bowl, and furniture.
- Building sprites match their footprints in v2. Look at drawing full-height sprites above the footprint, as the game does.
- Optionally import community farm layouts (`npm run import-v2 -- <path> --mods`) and credit their authors in the UI.
- Meadowlands (ranching) and greenhouse layouts have no restriction data yet, so placement there is unrestricted.

## Project

- Choose the project license (see README) and add LICENSE / NOTICE.
- CI: build, unit tests, and an accessibility (axe) check.
- Tests for `PlannerStore` and the map interactions.
- Performance check on the largest maps (Everfarm is 200×156 tiles).
