# Starplan

A fast, open source Stardew Valley farm planner. It's a clean rewrite inspired by the original [stardew.info planner](https://github.com/hpeinar/stardewplanner), with no ads. It only redraws when something changes, so it doesn't use CPU or GPU while it sits idle.

> **Unofficial fan project.** Starplan is a personal, non-commercial project. It is not affiliated with, endorsed by, or sponsored by ConcernedApe. Stardew Valley and its art are © ConcernedApe LLC.

Live at **https://starplan.fluin.io**.

Built with Angular (UI and state) and PixiJS (map rendering).

## Features

- All official farm layouts and building interiors, with buildable, tillable and accessible placement rules
- Paths, floors, fences, crops, trees, craftables and buildings; drag to fill rectangles
- Dragging with a sprinkler or scarecrow lays out the fewest needed to cover the whole area (a 6×6 field takes 4 quality sprinklers). They can go straight onto crops, replacing them
- Click a placed item with the Select tool to switch its variant: greenhouse repaired/broken, farmhouse upgrades, coop and barn upgrades, scarecrow type, sprinkler tier, and so on
- Select and move objects (Shift + drag to select several), erase areas, undo/redo
- Map controls like an online map: drag to pan with a glide, scroll or pinch to zoom where the pointer is, double-click to zoom in
- Sprinkler, scarecrow, bee house and Junimo hut ranges (on hover, or always on per type)
- Item counter to work out how many seeds and machines you need
- Share links that hold the whole plan in the URL, so no server or account is needed
- Plans autosave in the browser; the Plans menu opens, renames and deletes them. Shared links and imports open as new plans
- JSON import/export (including v2 planner files) and PNG export
- Movable farmhouse (with its mailbox), greenhouse and shipping bin, pet bowl and starter buildings
- Right-click (or press-and-hold) quick search with recently used items
- Works on phones: the item list folds into a bar under the map with recently used items, and the rest of the toolbar goes in a More menu

## Controls

| Input                                                                              | Action                                                                        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| B / S / E                                                                          | Place / Select / Erase (pressing S or E again goes back to the previous tool) |
| Ctrl/⌘ + Z, Ctrl/⌘ + Shift + Z (or Ctrl + Y)                                       | Undo / redo                                                                   |
| Delete / Backspace                                                                 | Delete the selected objects                                                   |
| V                                                                                  | Switch the selected item to its next variant                                  |
| Esc                                                                                | Cancel the current drag, or clear the selection                               |
| Drag empty ground (Select tool), right-drag, middle-drag, Space + drag, arrow keys | Pan (flick to glide)                                                          |
| Scroll wheel or trackpad, pinch                                                    | Zoom in or out where the pointer is                                           |
| Double-click empty ground (Select tool), Shift + double-click                      | Zoom in / out there                                                           |
| + / - / 0                                                                          | Zoom in / out / fit                                                           |
| Two fingers (touchscreens)                                                         | Pinch to zoom, drag to pan                                                    |
| G                                                                                  | Toggle grid                                                                   |
| Right click, press and hold (touchscreens)                                         | Quick item search                                                             |

## Analytics

The live site uses Google Analytics (gtag.js) to count visits and a few actions: starting a new plan, sharing, exporting and importing, each with the farm type. Plans themselves are never sent anywhere. Analytics is off in development and for visitors whose browser sends Global Privacy Control or Do Not Track. Set the measurement ID in `src/app/core/analytics.ts`.

## Development

```bash
npm install
npm start          # http://localhost:4200
npm test           # unit tests (Vitest)
npm run build
```

### Game data

The farm maps, building art and their placement rules come from your own copy of the game, unpacked with [StardewXnbHack](https://github.com/Pathoschild/StardewXnbHack):

```bash
npm run import-farms -- "<Stardew Valley>/Content (unpacked)"
npm run import-game -- "<Stardew Valley>/Content (unpacked)"
```

`import-farms` renders each farm type's map and derives its buildable, tillable and accessible tiles from the map's tile properties (writing `public/assets/layouts`, `public/assets/restrictions` and `src/app/core/data/farms.generated.ts`). `import-game` crops building art into `public/assets/game`.

Item sprites, building interiors and community layouts are imported from a checkout of the v2 planner:

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

## Working on this project

These conventions are for anyone changing the code, whether that's a person or an AI coding
assistant working in the repo.

### Before you commit

```bash
npm run lint           # ESLint, including Angular template and accessibility rules
npm run format         # Prettier (CI runs npm run format:check)
npm test               # unit tests
npm run build
```

### Angular and TypeScript style

The app follows current Angular (v22) conventions:

- **Components** are standalone (the default, so don't add `standalone: true`), small, and do one
  job. OnPush change detection is the default, so don't set `changeDetection`. Small components use
  inline templates; external template and style paths are relative to the component file.
- **State** lives in signals: `signal()` for local state, `computed()` for derived state, and
  `linkedSignal()` for state that must follow several sources. Change signals with `set()` or
  `update()` and keep transformations pure.
- **Inputs and outputs** use `input()`, `output()` and, for two-way bindings, `model()` rather
  than decorators. Inject dependencies with `inject()`, and make singletons
  `providedIn: 'root'` (or `@Service` for new ones).
- **Templates** use built-in control flow (`@if`, `@for`, `@switch`), `class` and `style` bindings
  instead of `ngClass`/`ngStyle`, the async pipe for observables, and import only the directives
  and pipes they use (no `CommonModule`). Host bindings go in the decorator's `host` object, not
  `@HostBinding`/`@HostListener`. Keep logic out of templates, and don't reach for globals such as
  `new Date()` there.
- **Forms**: Signal Forms (`@angular/forms/signals`) for new forms, otherwise reactive forms.
- **Images**: `NgOptimizedImage` for static images (it can't handle inline base64 images).
- **Routing**: lazy-load feature routes.
- **TypeScript** is strict. Let inference work when the type is obvious, and use `unknown` rather
  than `any`.

### Accessibility

Every page must pass AXE checks and meet WCAG AA, including focus management, color contrast and
ARIA attributes.

## Deployment

The site is fully static: the planner page is prerendered at build time and everything else runs in the browser, so it's hosted on [Firebase Hosting](https://firebase.google.com/docs/hosting) with no server and no billing account needed.

### Automatic deploys

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml) on GitHub Actions: it installs dependencies, runs the tests, builds, and deploys to Firebase Hosting. If the tests or build fail, nothing is deployed.

GitHub Actions signs in to Google Cloud without any stored password or key file, using [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines): GitHub vouches that the job is running in this repository, and Google Cloud trades that for short-lived credentials for a deploy-only service account.

### Deploying by hand

You need to be signed in to the Firebase CLI with an account that can deploy to the project.

```bash
npm run build
npx firebase-tools deploy --only hosting
```

The project is set in [.firebaserc](.firebaserc). To deploy somewhere else, run `npx firebase-tools use --add`.

### One-time setup for automatic deploys

Needed once per Firebase project (or after recreating it). Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), sign in with `gcloud auth login` as a project owner, and set these to your own values:

```bash
PROJECT_ID=starplan-15088
REPO=StephenFluin/starplan
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
DEPLOYER="github-deploy@$PROJECT_ID.iam.gserviceaccount.com"
# GitHub's permanent numeric IDs for the repository and its owner. Unlike names, these never
# change or get reused, so a renamed or deleted repository can't be claimed by someone else.
REPO_ID=$(curl -s "https://api.github.com/repos/$REPO" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
OWNER_ID=$(curl -s "https://api.github.com/repos/$REPO" | python3 -c 'import json,sys; print(json.load(sys.stdin)["owner"]["id"])')
```

1. Turn on the Google Cloud services this uses:

   ```bash
   gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com firebasehosting.googleapis.com --project "$PROJECT_ID"
   ```

2. Create a service account that can only deploy to Firebase Hosting (and check which services are turned on, which the Firebase CLI does before deploying):

   ```bash
   gcloud iam service-accounts create github-deploy --project "$PROJECT_ID" --display-name "GitHub Actions deploy"
   gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOYER" --role roles/firebasehosting.admin
   gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOYER" --role roles/serviceusage.serviceUsageConsumer
   ```

3. Trust GitHub Actions sign-ins, but only from this repository's `main` branch:

   ```bash
   gcloud iam workload-identity-pools create github --project "$PROJECT_ID" --location global --display-name "GitHub Actions"
   gcloud iam workload-identity-pools providers create-oidc starplan --project "$PROJECT_ID" --location global \
     --workload-identity-pool github --display-name "starplan repository" \
     --issuer-uri "https://token.actions.githubusercontent.com" \
     --attribute-mapping "google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref" \
     --attribute-condition "assertion.repository_id == '$REPO_ID' && assertion.repository_owner_id == '$OWNER_ID' && assertion.ref == 'refs/heads/main'"
   ```

4. Let workflows in this repository act as the deploy service account:

   ```bash
   gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" --project "$PROJECT_ID" \
     --role roles/iam.workloadIdentityUser \
     --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository_id/$REPO_ID"
   ```

5. Make sure the `workload_identity_provider` line in [.github/workflows/deploy.yml](.github/workflows/deploy.yml) has your project number (`echo $PROJECT_NUMBER`), and that `service_account` and `--project` match your project.

## Credits and licensing

Starplan is an unofficial, personal, non-commercial fan project. It is not affiliated with, endorsed by, or sponsored by ConcernedApe LLC, and it has no ads and takes no payments or donations.

- **Stardew Valley art:** Stardew Valley, its name and all of its art (the sprites and farm map images under `public/assets`) are © ConcernedApe LLC. They are used for non-commercial fan purposes only and are not covered by this project's code license. If ConcernedApe asks, they will be removed.
  - The farm images in `public/assets/layouts` are rendered from the game's own maps by `scripts/import-farms.mts`, and `public/assets/game` is cropped from the game's own content by `scripts/import-game.mts`, both run against a copy of the game unpacked with [StardewXnbHack](https://github.com/Pathoschild/StardewXnbHack).
  - `public/assets/sprites` and the interior images in `public/assets/layouts` come from the [v2 Stardew Valley planner](https://github.com/hpeinar/stardewplanner), whose author extracted them from the game.
- **v2 planner:** item data, interior layout metadata and their placement restriction maps are derived from the [v2 Stardew Valley planner](https://github.com/hpeinar/stardewplanner) by Henrik Peinar, licensed under Apache-2.0.
- **Code:** original. No code from the closed-source v3 planner is used.

See [NOTICE](NOTICE) for the full attribution.

**Code license:** Copyright © Stephen Fluin. The code is licensed under the [GNU Affero General Public License, version 3 or later](LICENSE). Because the data is derived from Apache-2.0 work, the [NOTICE](NOTICE) file ships with the project. As the AGPL asks of software used over a network, the app links to its source code.
