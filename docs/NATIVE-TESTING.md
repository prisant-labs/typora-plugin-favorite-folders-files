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
- Repeat host checks with Core tabs enabled/disabled and separately on macOS.

## Native Recent capability gate

On Windows, Recent is a live view of Typora's native read-only Recent getter.
It is read only while the Favorites panel is visible: on show, on window focus
and after navigation events, throttled and coalesced. The storage poll never
reads it. An unchanged list is not republished. The list exists only in memory; nothing is
saved, and the settings page and its preview never show it. On macOS Recent is
unsupported. Clicking the folder already open does nothing; Ctrl+click opens a
new window through `app.openFileOrFolder` with `forceCreateWindow`.

Dates are accepted in the forms Typora's own Recent menu sorts (numbers, numeric
strings and Date objects). To inspect the payload shape without printing paths,
run this in Typora's DevTools console and record only the table:

```js
Promise.resolve(JSBridge.invoke('setting.getRecentFiles')).then(r => console.table(['files', 'folders'].flatMap(k => (r?.[k] ?? []).map((row, i) => ({ list: k, i, keys: Object.keys(row).sort().join(' '), date: Object.prototype.toString.call(row.date), sortable: Number.isFinite(Number(row.date)) })))))
```

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

## Migration and recovery

The IndexedDB database is `prisant-labs.favorite-folders-files`, object store
`state`. The earlier `prisant-labs.quick-access` database is neither read nor
deleted; it stays on disk untouched. On the first v2 read of a valid v1 `current` record, every pin becomes
one Ungrouped Favorite in retained order. The complete original record is copied
to `recovery:v1` in the same transaction that writes v2 `current`.
Recent-only v1 entries remain exclusively in the recovery copy.

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
rename or delete files/folders. Native bridge dispatch completion is not proof
of a completed navigation; Current derives only from observed host state.
