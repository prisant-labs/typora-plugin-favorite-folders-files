# Architecture

Favorites is a plugin for [Typora Community Plugin](https://github.com/typora-community-plugin/typora-community-plugin)
("Core"), tested against Core 2.10.21. It ships as one script, `main.js`, and
one stylesheet, `style.css`. Both run inside Typora's page: Electron on
Windows, and WebKit on macOS. This document explains how the parts fit
together and where the plugin keeps its data. [CONTRIBUTING.md](CONTRIBUTING.md)
explains how to change it.

## How the parts fit together

`src/main.ts` builds everything when Core loads the plugin, and tears it down
on unload. It wires four controllers to one renderer:

| Controller | File | Keeps |
|---|---|---|
| `FavoritesController` | `controller.ts` | Saved Favorites, groups, their order, and the Favorites preferences |
| `FavoritesRuntime` | `favorites-runtime.ts` | The current file and folder, Typora's Recent list, and navigation |
| `BrowseController` | `browse-runtime.ts` | Browse's roots, expanded folders, folder listings, and the tab order |
| `UpdateNotifier` | `update-check.ts` | Whether the Plugin Marketplace offers a newer Favorites |

Each controller publishes a snapshot to its subscribers. `push()` in
`main.ts` merges the snapshots into one `FavoritesPanelSnapshot` and passes it
to `FavoritesPanelRenderer` (`favorites-panel.ts`). The renderer draws the
whole panel again from each snapshot. It keeps keyboard focus, scroll position
and IME composition across redraws. Clicks go back through
`FavoritesPanelActions`, which call the controllers.

Editing pages, such as Manage groups and Manage Browse roots, work on a draft.
Nothing is saved until **Save**. Favorites drafts are lists of operations
(`editor-state.ts`) that are replayed in one transaction. The roots page keeps
its unsaved roots on the page itself. A message about a field or a pending
confirmation appears right below that control, and a failed Save appears
beside the Save button.

The settings page (`settings.ts`, `settings-ui.ts`) edits the same
controllers, and saves each change at once. A failed change shows its message
in that setting's own row; only a storage-wide problem uses the status line at
the top. The page is drawn again from the controllers after every change, so
`settings.ts` keeps a typed Browse root path and the last message across
redraws. Its live preview (`settings-preview.ts`) runs the real renderer
over synthetic Favorites, Recent entries and folders, and never touches saved
data.

## Module map

| File | Responsibility |
|---|---|
| `model.ts` | The Favorites state, its operations, path normalization (`normalizePath`) and location IDs (`locationId`) |
| `editor-state.ts` | Drafts for the editing pages |
| `controller.ts` | `FavoritesController`: serialized reads and writes of saved Favorites |
| `storage.ts`, `migration.ts` | The `current` record, and the one-time upgrade from the v1 format |
| `record-store.ts` | `SharedRecordStore`: any other record in the same database |
| `favorites-runtime.ts` | Current location, Recent polling, and open and reveal |
| `host.ts` | `NativeHost`: the only code that asks Typora to navigate |
| `native-import.ts`, `native-history.ts` | Parse and normalize Typora's Recent list |
| `mac-recent.ts` | Read the Recent list on macOS, where Typora has no getter |
| `recent-diagnostics.ts`, `recent-diagnostics-ui.ts` | The path-free **Copy Recent diagnostics** report |
| `browse-store.ts` | The `browse` record and its normalization |
| `browse-fs.ts` | Folder listing: Node's `fs` on Windows, a quoted `ls` on macOS |
| `browse-model.ts` | Pure tree logic: top rows, visible rows, folders that still need a listing, adding a root (`withRoot`), and the arrangeable list of roots, Home and Drives (`browsePlaces`, `splitPlaces`) |
| `folder-chooser.ts` | Typora's own folder dialog, for adding a Browse root |
| `browse-runtime.ts` | `BrowseController`: listings, refreshes and optimistic saves |
| `update-check.ts`, `update-store.ts`, `update-confirmation.ts`, `update-dialog.ts` | The update pill and its daily check |
| `favorites-panel.ts` | The sidebar renderer, shared by Typora, the preview page and the settings preview |
| `panel.ts` | Icons and the ribbon icon |
| `settings.ts`, `settings-ui.ts`, `settings-preview.ts` | The settings page |
| `style.scss`, `settings.scss` | The panel's and the settings page's styles |

`QuickAccessController` in `controller.ts` and `QuickAccessPanelRenderer` in
`panel.ts` come from builds before 0.1.0. The plugin no longer loads them; only
their tests do.

## Saved data

Everything Favorites saves is in one IndexedDB database,
`prisant-labs.favorite-folders-files`, in its `state` object store. Every Typora
window on the computer shares it. The store holds these records:

| Key | Written by | Holds |
|---|---|---|
| `current` | `FavoritesIndexedDbStore` | Favorites, groups, their order and the Favorites preferences |
| `recovery:v1` | The v1 upgrade | The original v1 record, copied once in the upgrade's transaction |
| `updates` | `FavoritesUpdateStore` | **Check for updates automatically**, and the last check |
| `browse` | `BrowseStore` | Roots, where Home and Drives sit among them (`tops`), the Home and Drives choices, expanded folders, the selected Browse tab, the collapsed Stacked section, and the tab order |

**The compatibility rule.** Version 0.1.4 accepts only an exact set of keys in
the `current` preferences. A key it does not know makes it reject the whole
record, and that window loses its Favorites. So a new setting never goes into
`current`. It goes into its own record through `SharedRecordStore`, which older
versions never read. This is why Browse's selected tab lives in `browse` as
`active`, and not in the Favorites preferences' `activeTab`.

Version 0.2.0 also reads `browse`, and it keeps only the keys it knows when it
saves. So the roots keep their own order in `roots`, which 0.2.0 understands,
and `tops` only says where Home and Drives sit among them, such as
`['root', 'home', 'root', 'drives']`. When a 0.2.0 window saves Browse, Home and
Drives go back to after the roots, but no root is lost.

Each `SharedRecordStore` record normalizes what it reads. A missing or damaged
value becomes its default, and a read never fails. The `current` record is
stricter: if it can't be read, Favorites turns off editing rather than
overwrite it.

Windows see each other's changes by polling. Every 2 seconds,
`FavoritesRuntime` reads the `current` record through `FavoritesController`,
and `BrowseController` reads the `browse` record. Each publishes only when the
read brings something new, so an idle panel is never redrawn. Typora's Recent list is not polled. It is read when the
panel opens, when the window regains focus, and after Favorites opens
something.

## Talking to Typora

| Need | How |
|---|---|
| Sidebar, settings tab, commands, ribbon | Core's public `Plugin`, `SidebarPanel` and `SettingTab` API |
| Open a file | Core's `app.openFile` |
| Open a folder, or a new window | `JSBridge.invoke('controller.switchFolder')` and `JSBridge.invoke('app.openFileOrFolder')` |
| Reveal in Explorer or Finder | `JSBridge.showInFinder` and `JSBridge.invoke('shell.openItem')` |
| Recent on Windows | `JSBridge.invoke('setting.getRecentFiles')` |
| Recent on macOS | Typora's folder-menu call and its Quick Open panel (`mac-recent.ts`) |
| Browse on Windows | `reqnode('fs').promises`: `readdir` with file types, and `stat` for links and drives |
| Browse on macOS | `bridge.callHandler('controller.runCommand')` running `/bin/ls -1pL` on the quoted folder path |
| Choose a Browse root (Windows) | `JSBridge.invoke('dialog.showOpenDialog')` with `openDirectory` and `dontAddToRecent`, as Typora picks an image folder |
| Choose a Browse root (macOS) | `bridge.callHandler('path.selectFolderOrFile', { dir: true })`, as Typora picks an export folder. Not `controller.selectFolder`, which switches the open folder |
| Home folder | Core's `os.homedir()` |
| Updates | Core's plugin manager (`app.plugins`): its Marketplace data and `updatePlugin` |

Core's own macOS file listing builds its `ls` command without quoting the
path. Browse quotes the path itself (`shellQuote` in `browse-fs.ts`), so a
folder name with an apostrophe still works. That `ls` is the only shell command
Favorites runs.

## Browse

- **Reading folders.** Browse lists a folder only when it is expanded and the
  panel is on screen. The 2-second poll reads the `browse` record, never the
  disk. Each listing is one `readdir` on Windows, or one `ls` on macOS.
- **Refreshing.** Browse reads its expanded folders again when the panel
  opens, and when the Typora window regains focus or becomes visible. A
  background refresh runs at most every 5 seconds.
- **Ordering of results.** Each folder's listings carry a generation number.
  A listing that finishes after a newer one is discarded.
- **Memory.** Browse keeps up to 300 listings. Collapsed folders are forgotten
  first.
- **Drives.** On Windows, Browse checks `C:` to `Z:` with `stat`, two at a
  time. On macOS, it lists `/Volumes`.
- **What it shows.** Folders and Markdown files only, folders first. Names
  that start with a dot are hidden, and so are Windows system folders such as
  `$Recycle.Bin`. Errors show a short reason, never a path.
- **Saving.** Changes show at once and are then saved. If a save fails, Browse
  reloads the stored record and reports "Browse settings could not be saved."
- **Older WebKit.** Code that runs in Typora must not use `structuredClone`,
  because older macOS WebKit lacks it. Use explicit copies, such as
  `cloneBrowseRecord`.

## The preview page

`docs/prototype/quick-access.html` is the visual anchor: a self-contained page
that runs the production renderer, controllers and styles over synthetic data.
`scripts/prototype.mjs` builds it with esbuild from `prototype/main.ts` and
`prototype/shell.html`. Only the host services and fixtures differ from the
plugin.

The page records a fingerprint of `src/`, `prototype/`, `package.json`, the
lockfile, the license and the generator. CI fails if the committed page is not
current. `scripts/screenshots.mjs` renders the README images from this page in
Edge or Chrome.

## Builds and the release archive

- **Release build:** `rollup.config.js` compiles `src/main.ts` to
  `dist/main.js`. `main.ts` imports one Sass entry, `src/plugin.scss`, which
  loads `style.scss` and then `settings.scss` into `dist/style.css`. Babel
  targets Chrome 80 and Safari 13.1 (`.browserslistrc`).
- **Development build:** `build.js` uses esbuild. With `--install`, it copies
  the build into the synthetic `test/vault` fixture.
- **Archive:** `pack.js` writes `plugin.zip`. `scripts/release.mjs` checks that
  it holds only `LICENSE.md`, `THIRD-PARTY-NOTICES.md`, `main.js`,
  `manifest.json` and `style.css`, and that the metadata matches.
- **Stylesheet order:** `rollup-plugin-scss` joins separately imported
  stylesheets in whichever order they finish compiling, which made two builds
  of one commit differ up to 0.1.4. Import new stylesheets through
  `plugin.scss`, never directly from `main.ts`. `scripts/stylesheet.test.ts`
  guards this.

## Tests

Vitest runs every `*.test.ts` file. DOM tests use jsdom, and storage tests use
`fake-indexeddb`. `test/support/typora-core.ts` stands in for Core.
`test/foundation/` checks the public metadata, and `scripts/*.test.ts` check
the build, preview, screenshot, privacy and release scripts. Behavior in Typora
itself is checked by hand with [test/native/README.md](test/native/README.md).
