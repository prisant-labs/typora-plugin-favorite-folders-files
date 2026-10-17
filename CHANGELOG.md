# Changelog

All notable changes to Favorites for Typora are recorded here. Versions follow
[semantic versioning](https://semver.org/).

## 0.2.0 (2026-10-17)

### Added

- **Browse tab.** A folder tree that starts at root folders you choose, then
  your **Home** folder and your **Drives** (**Volumes** on macOS). Unlike
  Typora's own file tree, it stays where you left it when Typora opens a file
  in another folder. Click a folder to expand it one level, or a Markdown file
  to open it. A folder's **⋯** menu opens it as Typora's folder or adds it to
  your roots. Arrow keys move through the tree. Browse lists folders and
  Markdown files only, hides hidden and system folders, and never changes
  anything on disk. Not yet tested in Typora.
- **Manage roots** page: add a root by its path or from the folder Typora has
  open, reorder roots by dragging their grip or with arrows, remove roots, and
  show or hide Home and Drives. Roots can be on any drive, including a whole
  drive or a network share path.
- In the **Stacked** layout, Browse is a third collapsible section.
- **Tab order** setting, under **Display**: move **Favorites**, **Recent** and
  **Browse** into any order with arrows. The panel's tabs, its arrow keys and
  the **Stacked** sections all follow it, in every Typora window.

### Changed

- The add page names a location chosen in Browse **Selected**, as it names
  locations from Recent **Recent**.
- The settings page's live preview shows the Browse tab, with sample folders,
  in your tab order.
- The **Layout** setting's description says that **Stacked** shows all the
  collections, not both.
- The README images show the Browse tab and the **Tab order** setting, and a
  new image shows the tree.
- For contributors: CI now also scans every tracked file for private paths and
  keys, as the pre-commit check does for staged files (`pnpm privacy:tracked`).
  New `CONTRIBUTING.md` and `ARCHITECTURE.md` cover setup, the change workflow,
  releases, and how the plugin stores and reads its data. The repository gains
  a pull request template, bug report and feature request forms, a
  `SECURITY.md` for reporting security problems privately, and weekly
  Dependabot updates for the pinned GitHub Actions.
- The README's Privacy section and the user guide describe what Browse saves
  and reads. On macOS, Browse reads each folder with one quoted `ls` command
  through Typora; it is the only shell command Favorites runs.

### Fixed

- The panel no longer redraws itself every 2 seconds when nothing has changed.
  Favorites checks its saved data that often, so changes made in another Typora
  window still appear within a few seconds. Before, each check rebuilt the
  whole panel twice, which could clear a text selection or a hover highlight.
- Upgrading saved data from Favorites' earliest format no longer depends on a
  browser feature (`structuredClone`) that older macOS versions of Typora lack.
- For contributors: building the same commit twice now gives the same
  `style.css`, and so the same `plugin.zip`. The panel and settings styles had
  been joined in whichever order they finished compiling.

## 0.1.4 (2026-10-09)

### Added

- **Update pill.** When the Plugin Marketplace has a newer Favorites, the panel
  header and the settings page show an **Update** pill with the new version.
  Clicking it opens a confirmation; **Update** hands the work to Community
  Plugin Core, which downloads the new version and reloads Favorites. Core
  first reloads its Marketplace lists if its copy is out of date. Saved
  Favorites are kept. If the update cannot start,
  the confirmation says so.
- **Updates** setting: **Check for updates automatically**, on by default. At
  most once a day, when the panel or the settings page opens, Favorites asks
  Core to check the Plugin Marketplace. Core downloads the Marketplace's public
  lists from GitHub; Favorites sends nothing about you or your files. With the
  check off, the pill can still appear after you open Core's own plugin tabs.

### Changed

- The privacy notes in the README and the user guide now describe the update
  check, instead of saying that Favorites makes no network requests.
- The settings page's "Early release" note no longer says that the page does
  not check for updates.
- The README, the user guide and the settings page no longer say that Recent
  on macOS is untested. On a Mac, its **Files** and **Folders** tabs were
  checked against Typora's own Recent list.
- The preview page offers Typora's default and Night palettes beside its own,
  so selected states can be reviewed in those themes without Typora. Its own
  control styling no longer leaks into the panel, which had left-aligned the
  **Views** options there.

### Fixed

- The selected **Favorites** or **Recent** tab, the selected **Files** or
  **Folders** tab and the selected **Views** options no longer look faded on
  themes whose accent color is gray, including Typora's default theme. Their
  text took the accent color, which there is paler than unselected text.
  Selected text now stays at full contrast and bold, and an accent outline and
  tint mark the selection. The **Update** pill uses the same style, and a
  saved star is now filled.
- On themes that define no muted text or border color, such as Typora's Night
  theme, Favorites now derives both from the theme's own text and background
  colors instead of using light-theme grays.
- On Windows, a scrolled **Recent** list no longer jumps back to the top every
  few seconds after you click **Files**, **Folders** or a row. Favorites
  redraws the panel regularly, and each redraw scrolled the clicked control
  back into view. macOS was not affected.

## 0.1.3 (2026-10-01)

### Added

- **Recent** on macOS. It shows Typora's Recent folders, from the same call as
  Typora's sidebar folder menu, and Typora's Recent Markdown files, from the
  list Typora sends to Quick Open. As on Windows, it is read only while the
  panel is visible (or when you run the diagnostics command below), kept in
  memory, and never saved. Typora passes its macOS
  Recent files without dates, so on macOS each tab keeps Typora's order and
  **Recently opened** sorting is unavailable.
- Both macOS channels were found in Typora's page code and confirmed on a Mac
  by the Recent probe in `test/native/probes/`. Favorites' macOS Recent itself
  has not yet been tested in Typora on macOS.
- A **Favorites: Copy Recent diagnostics** command. It reads Typora's Recent
  list through Favorites' own reader, twice on macOS, and shows a report you
  can copy into a bug report. The report lists counts, kinds and timings, never
  paths or names.

### Changed

- When Recent is unavailable, the panel now says "Typora's Recent list isn't
  available in this version of Typora." instead of naming Windows.
- The settings page's Recent section now says Recent is available in Typora for
  Windows, and for macOS, where it has not yet been tested.
- The native test checklist moved from `docs/NATIVE-TESTING.md` to
  [`test/native/README.md`](test/native/README.md), beside the native test
  fixtures. A one-paste Recent probe for Typora's DevTools,
  `test/native/probes/recent.js`, replaces the inline snippets.

## 0.1.2 (2026-09-30)

### Fixed

- On macOS, the **Favorites** panel now fills the sidebar. It had been
  squeezed into the right-hand part of the sidebar, with the header buttons
  overlapping the title and the toolbar cut off. Typora lays out the sidebar
  as a row on macOS and a column on Windows, and the panel now fills it either
  way.
- On macOS, Typora's own sidebar header row no longer shows above Favorites.
  That row kept its last title (for example "Outline") while Favorites was
  open. It returns when you switch to Files or Outline, and the ribbon keeps
  the Files, Outline and Search buttons.
- Both macOS fixes were checked in a browser reproduction of Typora's macOS
  sidebar layout. They have not yet been re-tested in Typora on macOS.
- In the menu that opens when you right-click the ribbon, **Favorites** now
  shows a small star beside its name, like the other entries, instead of a
  large star above it. Checked in a browser reproduction of Core's menu; not
  yet re-tested in Typora.

### Changed

- Favorites is now listed in Typora's **Plugin Marketplace**
  ([typora-plugin-releases#13](https://github.com/typora-community-plugin/typora-plugin-releases/pull/13),
  merged 2026-09-25), so it can be installed from there as well as manually.

## 0.1.1 (2026-09-24)

### Fixed

- **Recent** on Windows now orders files and folders together. Typora stores
  folder dates as ISO 8601 text but file dates as numbers, and folder dates were
  being read as missing. That also re-enables **Recently opened** sorting and
  the **Most recent first** label. Only full ISO 8601 timestamps are accepted;
  looser date text still counts as missing, so no order is guessed.

## 0.1.0 (2026-09-24)

First public release.

### Added

- A **Favorites** sidebar panel, opened from the star in Typora's ribbon or with
  the **Favorites: Toggle panel** command, plus a **Favorites: Settings**
  command.
- Favorites for Markdown files and folders, saved from the current document or
  folder, or with the star on any row.
- Groups: create, rename, delete and reorder them (drag or arrows), and arrange
  the Favorites inside each group. **Ungrouped** always comes last. Editing
  pages apply changes only on **Save**.
- Removing a Favorite offers **Undo**. Favorites whose file or folder has moved
  are marked **Unavailable** and kept until you remove them.
- **Recent** (Windows): a live, read-only view of Typora's own Recent list, with
  **Files** and **Folders** tabs. It is read only while the panel is visible and
  is never saved or changed.
- **Views**: Tabs or Stacked layout, Outline or Filter group view, and Custom,
  A–Z or Recently opened sorting for groups and items. Search matches names and
  paths across Favorites and Recent.
- Opening: a click opens in this window, and the folder already open is marked
  **Current**. **Ctrl+click** opens a new window (Windows). A reveal button
  shows files and folders in Explorer or Finder.
- A settings page aligned with Outline View, with a live preview that uses
  sample data only.
- A [user guide](docs/USER-GUIDE.md) with an FAQ, a
  [native test checklist](test/native/README.md), and a self-contained HTML
  preview that CI keeps in sync with the source.

### Notes

- The plugin ID, install folder and database are
  `prisant-labs.favorite-folders-files`. Pre-release test builds used
  `prisant-labs.quick-access`, and their saved Favorites are not migrated.
- macOS is supported but not yet tested natively, and Recent is Windows-only.
- **Recently opened** sorting needs a date on every entry in Typora's Recent
  list; otherwise each Recent tab keeps Typora's order.
