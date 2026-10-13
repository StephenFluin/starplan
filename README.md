# Starplan

A fast, open source Stardew Valley farm planner. It's a clean rewrite inspired by the original [stardew.info planner](https://github.com/hpeinar/stardewplanner), with no ads and no trackers. It only redraws when something changes, so it doesn't use CPU or GPU while it sits idle.

> **Unofficial fan project.** Starplan is a personal, non-commercial project. It is not affiliated with, endorsed by, or sponsored by ConcernedApe. Stardew Valley and its art are © ConcernedApe LLC.

Built with Angular (UI and state) and PixiJS (map rendering).

## Features

- All official farm layouts and building interiors, with buildable, tillable and accessible placement rules
- Paths, floors, fences, crops, trees, craftables and buildings; drag to fill rectangles
- Dragging with a sprinkler or scarecrow lays out the fewest needed to cover the whole area (a 6×6 field takes 4 quality sprinklers). They can go straight onto crops, replacing them
- Click a placed item with the Select tool to switch its variant: greenhouse repaired/broken, farmhouse upgrades, coop and barn upgrades, scarecrow type, sprinkler tier, and so on
- Select and move objects, erase areas, undo/redo
- Sprinkler, scarecrow, bee house and Junimo hut ranges (on hover, or always on per type)
- Item counter to work out how many seeds and machines you need
- Share links that hold the whole plan in the URL, so no server or account is needed
- Plans autosave in the browser; the Plans menu opens, renames and deletes them. Shared links and imports open as new plans
- JSON import/export (including v2 planner files) and PNG export
- Movable farmhouse (with its mailbox), greenhouse and shipping bin
- Right-click quick search with recently used items

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| B / S / E | Place / Select / Erase (pressing S or E again goes back to the previous tool) |
| Ctrl/⌘ + Z, Ctrl/⌘ + Shift + Z (or Ctrl + Y) | Undo / redo |
| Delete / Backspace | Delete the selected objects |
| V | Switch the selected item to its next variant |
| Esc | Cancel the current drag, or clear the selection |
| Arrow keys, middle-drag, Space + drag | Pan |
| Mouse wheel, + / - / 0 | Zoom in / out / fit |
| G | Toggle grid |
| Right click | Quick item search |

## Development

```bash
npm install
npm start          # http://localhost:4200
npm test           # unit tests (Vitest)
npm run build
```

### Game data

Sprites, farm layouts and placement restriction maps are imported from a checkout of the v2 planner:

```bash
git clone --depth 1 https://github.com/hpeinar/stardewplanner.git ../stardewplanner
npm run import-v2 -- ../stardewplanner          # add --mods to include community farm layouts
```

This writes `public/assets/` and `src/app/core/data/layouts.generated.ts`.

### Layout

- `src/app/core/data`: item catalog and layout metadata
- `src/app/core/plan`: framework-free plan model (document, placement rules, ranges, save format), unit tested
- `src/app/core/planner-store.ts`: app state as signals: undo/redo, autosave, share links
- `src/app/features/planner`: UI components; `map/` holds the PixiJS renderer and pointer input

See [backlog.md](backlog.md) for planned work.

## Credits and licensing

Starplan is an unofficial, personal, non-commercial fan project. It is not affiliated with, endorsed by, or sponsored by ConcernedApe LLC, and it has no ads and takes no payments or donations.

- **Stardew Valley art:** Stardew Valley, its name and all of its art (the sprites and farm map images under `public/assets`) are © ConcernedApe LLC. They are used for non-commercial fan purposes only and are not covered by this project's code license. If ConcernedApe asks, they will be removed.
  - `public/assets/sprites` and `public/assets/layouts` come from the [v2 Stardew Valley planner](https://github.com/hpeinar/stardewplanner), whose author extracted them from the game.
  - `public/assets/game` is cropped from the game's own content by `scripts/import-game.mts`, run against a copy of the game unpacked with [StardewXnbHack](https://github.com/Pathoschild/StardewXnbHack).
- **v2 planner:** item data, layout metadata and placement restriction maps are derived from the [v2 Stardew Valley planner](https://github.com/hpeinar/stardewplanner) by Henrik Peinar, licensed under Apache-2.0.
- **Code:** original. No code from the closed-source v3 planner is used.

See [NOTICE](NOTICE) for the full attribution.

**Code license:** not chosen yet. Because the data is derived from Apache-2.0 work, the NOTICE file must ship with the project whichever license is picked.
