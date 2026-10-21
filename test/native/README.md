# Favorites installation and native checks

Use this checklist to test a build with disposable Markdown documents.
Windows and macOS acceptance are separate. The HTML preview and automated
DOM/storage tests do not establish native behavior.

## Build and install

1. Use Node 22 and the pnpm version declared in `package.json`.
2. Run `pnpm install --frozen-lockfile`, `pnpm prototype:check`,
   `pnpm test:run`, `pnpm typecheck`, `pnpm run pack`, and `pnpm release:check`.
3. Install Typora Community Plugin if needed. Core 2.10.21 is the tested type/API baseline.
4. Extract `plugin.zip` into a plugin folder named `prisant-labs.favorite-folders-files`
   under the Community Plugin installation's `plugins` directory, or a disposable
   vault-local `.typora/plugins/` directory. Enable **Favorites** in Core settings.
   Its sidebar is titled **Favorites**.

To check the published build instead, install **Favorites** from Core's
**Plugin Marketplace**. The marketplace always installs the latest GitHub
release, not a local candidate.

The identical `plugin_typora-favorite-folders-files.zip` archive can also be
used. The repository and package slug is `typora-plugin-favorite-folders-files`;
the plugin folder, plugin ID and saved database are `prisant-labs.favorite-folders-files`.

Earlier unpublished candidates used `prisant-labs.quick-access`. Core treats a
different ID as a different plugin, so remove or disable that old folder first;
otherwise two Favorites panels load. Favorites saved under the old ID are not
carried over. Enable state is per Core scope: enabling under Global Settings does
not enable the plugin inside a folder that has its own `.typora` settings.

For development, `pnpm install:dev` installs into the repository's disposable
`test/vault/.typora/` fixture. It does not launch Typora. Open `test/vault/doc.md`
to begin; `test/outside-vault/outside.md` supplies an outside-root target.
While that folder is open, its vault copy overrides a global install with the
same ID. Opening fixture folders also adds them to Typora's native Recent list.
Coordinate installation and testing before touching a real profile.

## Record the environment

Record source revision/dirty status, ZIP SHA-256, OS, Typora/Core versions,
Core tabs enabled/disabled, global/vault configuration scope, and tester.
Keep real paths, screenshots and native history in local-only receipts.

## Native checklist

- Enable, hide/show, disable/re-enable and unload the plugin. Expect one ribbon
  button and one Favorites panel, with no detached controls or leftover timers.
- Add the current eligible Markdown file and working folder. Verify selection
  does not save early; saved cards name their group and Go reveals the shortcut
  without opening the target. Test all-saved, mixed, unsaved-document and no-folder cases.
- Create/rename groups, move Favorites, delete a group, reorder groups with
  arrows and pointer, and arrange a group's Favorites with arrows. Cancel leaves
  saved membership/order untouched; group deletion transfers members to Ungrouped.
- Exercise dirty Back/Cancel/Escape/Go, Keep editing, pending inline names,
  double Save and failed Save. Confirm draft retention and focus restoration.
- Switch Tabs/Stacked, Outline/Filter, A–Z/Custom and collapsed state. Restart
  Typora and verify Favorites and presentation preferences persist.
- Open fixtures within and outside the current root. Verify actual document,
  folder, tabs and window effects. Make a disposable document dirty and test
  Save/Discard/Cancel for file and folder transitions. A canceled request must
  never become Current.
- Test missing file/folder Favorites and paths with spaces, apostrophes, Unicode,
  `#` and `?` where valid on the platform. The shortcut survives failure.
- Reveal a file or open a folder in Explorer/Finder. Verify the Typora Current
  location does not change merely because of the reveal request.
- Use the header gear. It should open the real Community Plugin options UI.
  Select Favorites manually if Core cannot publicly select the plugin tab.
  Change a shared preference there and verify the panel reflects it.
- With two windows sharing the same origin/profile, save independent edits,
  conflict on the same group order, delete a destination while another draft
  is open, and remove an item while another editor arranges it. Independent
  changes survive; incompatible changes report a conflict and retain the draft.
- Verify the actual IndexedDB origin/profile sharing across windows and vaults.
  Synthetic transaction tests do not establish global sharing in Typora.
- Review light/dark at 280px and 340px, larger text, long group names and duplicate
  basenames. Check hover/focus/touch actions, keyboard radio/menu behavior, input
  composition, narrow popover bounds, drag autoscroll and outside-drop cancellation.
- With Typora's default Github theme, and again with Night, check that the
  selected **Favorites**/**Recent** tab, the selected **Files**/**Folders** tab
  and the selected **Views** options read as selected rather than faded, and
  that a saved star is filled. Typora's default palette makes the theme accent
  gray, which is the case 0.1.4 fixes; the preview page's "Typora default" and
  "Typora Night" themes approximate it.
- On Windows, with more Recent files than fit in the panel, click **Files**,
  scroll the list to the bottom and wait five seconds; repeat after clicking a
  row. The list should stay where you left it. Before 0.1.4 it jumped back to
  the top within about two seconds.
- Repeat host checks with Core tabs enabled/disabled and separately on macOS.
- Check that the panel fills the sidebar at narrow and wide sidebar widths, on
  Windows and on macOS. On macOS, Typora's own header row (the "Outline" or
  "Files" title and its search button) should be hidden while Favorites is open
  and should return after switching to Files or Outline from the ribbon. Also
  switch with Typora's View menu or shortcuts while Favorites is open; Core does
  not intercept those. Right-click the ribbon: the Favorites entry should show a
  small star beside its name, like Files and Outline.

## Native Recent capability gate

On Windows, Recent is a live view of Typora's native read-only Recent getter.
It is read only while the Favorites panel is visible, or when **Favorites: Copy
Recent diagnostics** runs: on show, on window focus
and after navigation events, throttled and coalesced. The storage poll never
reads it. An unchanged list is not republished. The list exists only in memory; nothing is
saved, and the settings page and its preview never show it. Clicking the folder
already open does nothing; on Windows, Ctrl+click opens a new window through
`app.openFileOrFolder` with `forceCreateWindow`.

On macOS, Typora has no Recent getter, so Favorites reads two other channels
with the same triggers and limits. Folders come from
`bridge.callHandler('library.getRecentFolders')`, the call Typora's own sidebar
folder menu makes. Files come from the list Typora's macOS app sends to Quick
Open after `bridge.callHandler('quickOpen.cacheRecentFiles')`. Favorites sees
that list through pass-through wrappers on `File.editor.quickOpenPanel`'s
`setRecentFiles` and `initFileCache`, the two Quick Open methods that replace
the whole list. The wrappers are installed on the first read and removed when
Favorites unloads. Both channels were found in Typora's page code. On
2026-10-01, the Recent probe confirmed both on the maintainer's Mac (see
[macOS Recent](#macos-recent)). Favorites' own macOS Recent has not yet been
tested in Typora on macOS.

### Copy Recent diagnostics

With a Favorites build installed, run **Favorites: Copy Recent diagnostics**
from the command palette. It needs no DevTools. It reads Recent through
Favorites' own reader, twice on macOS, and shows a report with a **Copy
report** button. The report shows each read's timing, the shapes of the
files and folders lists, and what the panel would show. It ends with
`RESULT: PASS` or `RESULT: FAIL`, and it holds no paths or names. Use it for
every native Recent check, and ask users to attach it to Recent bug reports.

The probe below checks Typora's channels without any Favorites build, which
helps when a new Typora version changes them.

### Recent probe

[`probes/recent.js`](probes/recent.js) checks Typora's Recent channels on
Windows or macOS and reports what it finds. The report holds counts, kinds, key
names, date types and timings, but never paths or names. A channel that does not
answer within 5 seconds is reported as "no answer", so the probe never leaves a
request pending.

1. Hide the Favorites panel by switching the sidebar to Files. Favorites then
   does not read Recent while the probe runs.
2. Open Typora's DevTools, as described in Typora's
   [Debug Themes](https://support.typora.io/Debug-Themes/) page:
   - **macOS 13.3 or later, Typora 1.9 or later:** turn on Safari's developer
     features (Safari's Web Inspector setting), then in Safari choose
     **Develop → [this Mac's name] → Typora**. The inspector opens in Safari.
   - **Older macOS:** turn on debug mode in Typora's preferences under
     **General**, restart Typora, right-click the writing area, and choose
     **Inspect Element**.
   - **Windows:** **View → Toggle DevTools**.
3. Open [`probes/recent.js`](probes/recent.js) on GitHub, use **Copy raw file**,
   paste it into the DevTools console, and press Enter.
4. Wait for the report window. It takes up to 10 seconds on macOS, which asks
   twice, and under a second on Windows. **Copy report** copies the whole
   report. The console also prints it as plain text.
5. Record the report. Its last lines read `RESULT: PASS`, or `RESULT: FAIL`
   followed by the reasons.

On Windows, the report shows the shapes of the getter's `files` and `folders`
lists and their date types. Typora's own Recent menu sorts by those dates, and
Favorites accepts the same forms: numbers, numeric strings, Date objects, and
full ISO 8601 text.

Using disposable native history, check:

- Show Recent with files, folders, empty history and Unicode paths. Verify
  Markdown filtering, deduplication and order against Typora's own menu.
- Open a location outside Favorites; Recent should update within a few seconds
  while the panel is visible. Hide the panel: no reads should occur.
- Clear Typora's list (File → Open Recent → Clear Items); Recent must empty on
  the next read. Open a second window: it shows the same list.
- Disable/re-enable and restart. No late read may publish after unload. No saved
  Favorite may be removed or auto-added.
- Click the folder marked Current: nothing should happen. Click another folder:
  it should switch this window. Ctrl+click: a new window should open.
- Test recording-off behavior explicitly. The bridge's privacy semantics are
  not yet runtime-verified; no automatic recording-off detection is claimed.
- If native date fields are missing, the label reads "Typora's order" and
  Recently opened sorting stays unavailable. Dates have no assumed epoch and are
  not shown as ages. Unsupported payloads show a safe error.
- Check the header remains in normal flow, the star ribbon is 24px, and all
  visible plugin labels read Favorites. In settings, inspect compact controls
  and preview at narrow/wide widths and light/dark themes; close/reopen repeatedly.

The observed Windows consumer contract supports the implementation, but real
bridge, clear/privacy and native visual acceptance remain unrun. Preview fixtures
and automated tests do not establish those results. Do not add a history collector.

### macOS Recent

Run the [Recent probe](#recent-probe) first. On macOS it asks for both lists
twice, because the second request shows whether Typora sends the files list
again. It watches the three Quick Open methods that can carry Recent files:
`setRecentFiles` and `initFileCache` replace the whole list, and `updateCache`
edits one entry. Read the report this way:

- **`RESULT: PASS`** means both passes received a full files list of absolute
  paths, and the folders call answered both times. Continue with the checks
  below.
- **"Pass 2 returned no full Recent files list"** means Typora sends the list
  only once. macOS Recent would work once and then fail on every later read, so
  it must not be released.
- **"not absolute paths (file URL)"** means Favorites would show an error
  instead of a list.
- **"Already wrapped before the probe"** names Quick Open methods that something
  had wrapped before the probe ran. `initFileCache` is normal: Community Plugin
  Core wraps it for its ignored-files setting, and Favorites forwards to Core's
  wrapper. Any other name means another plugin, or a Favorites build with macOS
  Recent whose panel was showing. Hide that panel or disable that plugin, then
  run the probe again.
- **Date types** other than `none` on folder rows change nothing in Favorites,
  which keeps Typora's order on macOS. Record them anyway; they decide whether
  macOS could ever offer **Recently opened** sorting.
- **Timings** show how fast each channel answers. Favorites waits 5 seconds for
  both.

First observation on a Mac, 2026-10-01: `JSBridge.invoke` exists on macOS, and
`JSBridge.invoke('setting.getRecentFiles')` returned a promise that was still
pending while the maintainer watched. That matches Typora's page code, where
only the Electron build answers that call.

Probe result on the maintainer's Mac, 2026-10-01: **`RESULT: PASS`**.

- Both passes received `setRecentFiles` with 10 Recent files, all absolute
  paths, after 159 ms and 31 ms. Typora sends the list again on every request.
- `library.getRecentFolders` answered both times, within 12 ms. It returned 103
  folder rows shaped `{name path pinned}`, with no dates and absolute paths.
  The two pinned folders came first.
- `initFileCache` was already wrapped, by Core.

On that Mac, Recent → **Folders** will therefore list 103 folders, with Typora's
pinned folders first, and **Files** will list up to 10.

Then show the Favorites panel again and check, using disposable native history:

- Recent → **Files** matches Quick Open's recent files (Cmd+Shift+O with an empty
  query), filtered to Markdown files and in the same order.
- Recent → **Folders** contains the folders in the sidebar's folder menu. The
  menu is not an exact reference: it shows at most six folders and lists the
  open folder separately. Favorites keeps the order Typora returns, which puts
  pinned folders first.
- Quick Open still lists recent files while Favorites is enabled, and after
  Favorites is disabled.
- Open a file from outside Recent. While the panel is visible, Recent shows it
  within a few seconds. Hide the panel: no reads should occur.
- Clear Typora's list (**File → Open Recent**, then the clear command at the
  bottom of that menu). Record what happens to **Files** and to **Folders** on
  the next read. Typora's code does not show whether that command clears the
  folders list too.
- Disable and re-enable Favorites, then restart Typora. No late read may
  publish after unload.
- Click a Recent folder to switch this window to it. On macOS, Cmd+click opens
  it in this window too, because Favorites opens new windows only on Windows.

## Update pill

The pill appears only when the Plugin Marketplace offers a version newer than
the installed one. Until a newer release exists, test with a build that claims
an older version:

1. Run `pnpm build`. Copy `dist/` into Community Plugin's `plugins` folder as
   `prisant-labs.favorite-folders-files`, as a real folder and not a link.
   Core's update deletes the plugin folder before it downloads, and a link
   could expose the build output.
2. In the copied `manifest.json`, set `version` to an older version, such as
   `0.1.2`. Restart Typora.
3. Open the Favorites panel. Within a few seconds, a pill naming the newest
   released version appears in the header. At a narrow sidebar width, it shows
   only an arrow and the version. The settings page shows the same version
   beside **Installed**.
4. Click the panel pill. Check the confirmation text, and that the release link
   opens the GitHub release page. Click **Cancel**: nothing changes. Open it
   again with the keyboard (Tab to the pill, then Enter) and press **Escape**:
   the dialog closes, focus returns to the pill, and nothing changes.
5. Click the pill again, then **Update**. Core reports success, the panel
   reloads without a pill, and your saved Favorites are intact.
6. Repeat steps 1 and 2, then start the update from the **settings page** pill.
   Core unloads Favorites while its own settings window shows the Favorites
   tab. Record what that window shows afterwards.
7. Turn off **Check for updates automatically**, repeat steps 1 and 2, and open
   the panel. No pill appears until you open Core's **Installed Plugins** or
   **Plugin Marketplace** tab and return to the panel.
8. With two Typora windows open, update in one. The other window keeps working
   on the old version, including editing Favorites, until it restarts.

Record each step in the native acceptance worksheet. Until then, describe the
pill as implemented but not verified in Typora.

## Browse

Browse reads folders with Node's `fs` on Windows, and with one quoted `ls`
command through Typora's `controller.runCommand` bridge on macOS. The Windows
path has run in Typora: the maintainer used the 0.2.0 release archive in Typora
1.14.10 with Core 2.10.23 on 2026-10-19, without recording each step. The macOS
path has not run in Typora yet. Use disposable folders with synthetic names.

On both platforms:

1. Open the panel and click **Browse**. It shows **Home** and **Drives**
   (Windows) or **Volumes** (macOS). Nothing is read until you expand a row.
2. Click the **gear** at the right end of the **Views** row to open **Manage
   Browse roots**.
   Add the open folder with **Add current folder**, add a second folder by
   typing its full path, reorder them, and **Save**. The roots appear above
   Home in that order.
3. Expand a root, then a subfolder inside it. Only folders and Markdown files
   appear, folders first. A dot-folder, such as `.git`, does not appear.
4. Open a Markdown file from Browse that sits **outside** the folder Typora has
   open. The file opens. Record whether Typora's own file tree moves to that
   file's folder. Browse must stay as it was.
5. Use a folder's **⋯** menu → **Open in Typora**. Typora's own file tree
   switches to that folder.
6. Create a Markdown file in an expanded folder from Explorer or Finder, then
   switch back to Typora. The file appears in Browse within a few seconds.
7. Restart Typora. The roots, and which folders were expanded, are kept.
8. With a 0.1.4 window still open, select **Browse** in a newer window. The
   0.1.4 window keeps showing and editing its Favorites without an error.

On Windows:

9. Expand **Drives**. Record how long the drive list takes, and whether a
   disconnected network drive delays it. `$Recycle.Bin` and
   `System Volume Information` do not appear under `C:`.
10. Expand Home, then a legacy junction such as `Application Data`, if it is
    shown. It shows **No access**, and the panel keeps working.
11. **Ctrl+click** a Markdown file in Browse: it opens in a new window.

On macOS:

12. Add a root whose name contains an apostrophe, such as `It's here`, and
    expand it. Its contents appear.
13. Expand Home → **Documents** or **Desktop**. If macOS asks whether Typora
    may access the folder, record the prompt. After **Don't Allow**, the folder
    shows **No access** or no entries; record which.
14. Expand **Volumes**. The startup volume and any mounted disks appear.
15. Record how long a large folder, such as one with 500 entries, takes to
    appear.

Tab order and root order, on both platforms:

16. In the settings, under **Display → Tab order**, move **Browse** to the top.
    The panel's tabs read Browse, Favorites, Recent, and the selected tab does
    not change. The live preview shows the same order. Keyboard focus stays on
    Browse's other arrow.
17. In the panel, the Left, Right, Home and End keys on the tabs follow the new
    order. Switch **Views** to **Stacked**: the sections follow it too.
18. With two Typora windows open, change the tab order in one. The other
    follows within a few seconds. Restart Typora: the order is kept.
19. In **Manage Browse roots**, drag a root by its dotted grip above another,
    then **Save**. The tree shows the new order. Press **Escape** in the middle
    of a drag: nothing moves.

More than one drive, on Windows:

20. Add a root on a second drive, such as a USB drive, and expand it. Then
    eject the drive and switch back to Typora. The drive leaves **Drives**.
    Expanding the root shows **Unavailable** or **Could not be read**; record
    which.
21. If a network share is available, add it as a root by its `\\server\share`
    path, and expand it. Record whether its contents appear and how long they
    take.

Choosing roots and the settings page, on both platforms:

22. On **Manage Browse roots**, click **Choose folder…**. Typora's own folder
    dialog opens at the folder Typora has open. Pick a disposable folder: it
    joins the list, and nothing is saved until **Save**. Open the dialog again
    and cancel it: nothing changes and no message appears. On Windows, record
    whether the chosen folder appears in the Windows Recent list (it should
    not). On macOS, record whether the dialog opens at all.
23. Type `Notes` in the path field and click **Add folder**. The message
    "Enter a full folder path" appears directly below the path field, not at
    the bottom of the page. Typing clears it. Choose a folder that is already a
    root: "That folder is already a root." appears in the same place.
24. In Typora's settings, under **Favorites → Browse**, move a root, remove
    one, add one with **Choose folder…** and one by its path, and hide
    **Home** with its eye button. Each change shows in the panel at once and
    survives a restart.
25. In the settings, type a relative path such as `Notes` and click **Add
    folder**. The message appears in the **Add a root** row, below the path
    field, and the typed text stays.
26. On **Manage Browse roots**, drag **Home** above your first root, move
    **Drives** (**Volumes**) up one place with its arrow, and hide it with its
    eye button. It stays in the list, dimmed and marked **Hidden**. **Save**:
    the tree shows Home first and no Drives. Show Drives again and **Save**: it
    comes back in the same place. Restart Typora: the order is kept.
27. With Home placed first, expand a folder in a window that still runs 0.2.0.
    In the newer window, Home and Drives go back to after the roots, and every
    root is still there.

Record each step in the native acceptance worksheet. Until then, describe
Browse as implemented but not verified in Typora.

## Migration and recovery

The IndexedDB database is `prisant-labs.favorite-folders-files`, object store
`state`. The earlier `prisant-labs.quick-access` database is neither read nor
deleted; it stays on disk untouched. On the first v2 read of a valid v1 `current` record, every pin becomes
one Ungrouped Favorite in retained order. The complete original record is copied
to `recovery:v1` in the same transaction that writes v2 `current`.
Recent-only v1 entries remain exclusively in the recovery copy.
The update setting and the last update check live in a separate `updates`
record. Saved Favorites accept an exact set of preference keys, so this record
stays outside `current`, and older versions never read it. Browse's roots,
expanded folders, selected tab and tab order live in a `browse` record for the
same reason.

Before testing an upgrade, back up the browser profile or export the original
record. Use disposable seeded v1 data to test migration, interrupted writes,
retry and corrupt/unknown versions. Invalid records disable unsafe writes;
they are not reset to defaults. Verify recovery data independently.

An older plugin binary cannot read v2 state. Rollback is an explicit recovery
operation: close all plugin windows, preserve the v2 record separately, validate
the v1 backup, restore it as `current`, then reopen the matching older binary.
No automatic restore/delete control is shipped. Clearing application browser
data can remove both records.

## Filesystem boundary

The plugin navigates to targets and asks the OS to reveal them. It does not move,
rename or delete files/folders. The update pill only asks Community Plugin Core
to update Favorites after the user confirms; Core replaces the plugin's own
folder. Native bridge dispatch completion is not proof
of a completed navigation; Current derives only from observed host state.
