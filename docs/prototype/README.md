# Current solution visual anchor

Open `quick-access.html` directly in a browser. It needs no server, installed
plugin, network, fonts, or assets. The production `src/favorites-panel.ts`, `src/model.ts`
and `src/style.scss` render the sidebar; the preview replaces only host state
and actions with synthetic fixtures.

The preview includes light/dark themes, 280/340/400-pixel panel widths,
everyday/first-use/long-path scenarios, all-saved and mixed Add states, native
history unavailable/recording-off/per-kind states, and simulated cancellation
or save failure. Add, Move, Manage groups and Arrange Favorites use the same
draft and atomic replay code as the native plugin. Recent entries are synthetic;
use Import from Typora in the Recent tab or the settings dialog to load the
simulated session snapshot. Once loaded, Refresh and Clear live in the settings
dialog, as in the plugin. The settings page uses the shared production controls
and its own isolated synthetic preview. Real manual import is Windows-only.
These controls are outside the plugin. The displayed editor and Outline View
are context, not additional Favorites features.

## Updating the anchor

1. Change production source and appropriate tests.
2. Run `pnpm prototype:build`.
3. Open the generated HTML and exercise the affected states.
4. Run `pnpm prototype:check`, tests, typecheck and packaging checks.
5. Commit source and HTML together.

The generator fingerprints all production sources, preview sources, package
and lockfile, license and generator. `prototype:check` generates in memory,
compares normalized bytes, and never rewrites the committed file. CI checks
freshness before tests. The preview is excluded from the plugin ZIP.

Freshness and DOM tests establish source coupling and interaction behavior.
Rendered browser review establishes appearance in the tested browser. Neither
proves native Typora navigation, cancellation or persistence.
