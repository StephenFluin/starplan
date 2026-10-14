# Backlog

Things we want to take care of later, roughly in priority order within each section.

## Features

- Save import extras: animals and furniture (the planner has no items for them yet), and checking saves from mobile.
- Accounts and server-side saved plans (the main reason for the Angular app): sign-in, a "My plans" list, and short share links as an alternative to the long `#p=` hash links.
- Translations / i18n.

## Features the v3 planner has that we don't

From v3's public controls, FAQ and changelog (not its code):

- Furniture, and interior planning for the farmhouse (including upgrades and the cellar).
- Seasonal grass and crops (the season switcher, maps and trees are done).
- More placeables: truffle and blue grass.
- Gates placed over fences.
- Uploading a custom layout image (PNG).
- Stardew Valley Expanded layouts (Immersive Farm 2 Remastered, Grandpa's Farm, Frontier Farm, Ferngill Republic Frontier).
- 11 languages (also listed above).
- Crops drawn in their ready-to-harvest state.

## Data & assets

- Furniture.
- NoFurniture tiles aren't modelled: the game keeps objects off the farmhouse's doorstep and the spouse patio, but the planner allows them there.
- Optionally import community farm layouts (`npm run import-v2 -- <path> --mods`) and credit their authors in the UI.
- The greenhouse interior has no restriction data yet, so placement there is unrestricted.

## Project

- Choose the project license (see README) and add LICENSE / NOTICE.
- CI: build, unit tests, and an accessibility (axe) check.
- Tests for the map interactions (`PlannerStore` has a first few).
- Performance check on the largest maps (Everfarm is 200×156 tiles).
