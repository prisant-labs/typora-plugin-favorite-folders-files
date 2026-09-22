# Initial plugin installation and native checks

The current package is an unpublished development candidate. Run these checks
with disposable Markdown documents before relying on it with working files.
Windows and macOS native acceptance are separate requirements.

## Build and install

1. Use Node 22 and the pnpm version declared in `package.json`.
2. Run `pnpm install --frozen-lockfile`, `pnpm prototype:check`,
   `pnpm test:run`, `pnpm typecheck`, `pnpm run pack`, and `pnpm release:check`.
3. Install Typora Community Plugin if it is not already installed. The
   manifest declares core 2.10.21 as the minimum.
4. Extract `plugin.zip` into a plugin folder named `prisant-labs.quick-access`
   under the Community Plugin installation's `plugins` directory, or use its
   vault-local `.typora/plugins/` directory. Enable **Quick Access** in the
   Community Plugin settings and restart Typora when necessary.

For development, `pnpm install:dev` installs into the repository's disposable
`test/vault/.typora/` directory and enables the plugin there. Open
`test/vault/doc.md` in Typora to begin; the script does not launch the app.
The sibling `test/outside-vault/outside.md` supplies an outside-root target.

## Record the environment

Record plugin commit and ZIP SHA-256, OS, Typora version, core version, core
tabs enabled/disabled, global/vault config scope, and tester. Store receipts
locally; avoid real document paths, screenshots or history in commits.

## Native checklist

Recent-history collection is inactive in this candidate pending the history-source
decision. Visit-history assertions below become acceptance checks once collection
is approved and enabled; they are not expected to pass in the current candidate.

- Enable the plugin and open Quick Access from the left ribbon or command.
  Switch to Files and back, hide/show the sidebar and disable/re-enable.
  Expect one panel/button and no detached or duplicated controls.
- Pin the current folder and current document. Change sort and collapse state,
  switch tabs and restart. Verify pins and preferences persist.
- Open another fixture from Typora while Quick Access is hidden. Verify its
  Current indicator and recent visit after returning to Quick Access.
- Open same-root and outside-root Markdown files. Verify actual document,
  root and tabs. A file request must not issue an extra folder switch.
- Switch between two disposable folders. Verify the observed root, document,
  tab and window effects.
- Make a disposable document dirty. Attempt file and folder transitions;
  cancel first. Verify the original document/root stay current and the
  attempted destination gains no visit. Then save and retry.
- Test a missing file/folder pin. The pin must survive and the UI must explain
  failure. Test names with spaces, apostrophes, Unicode and `#`.
- Reveal a file in Explorer/Finder and open a folder's contents there. Neither
  should change recency or the Typora Current indicator.
- With two Typora windows, change different pins and preferences, then unpin
  one in a window with older data. Check updates converge without resurrecting
  a removed pin. Repeat after changing core global/vault configuration.
- Confirm the plugin-owned IndexedDB database has the same origin/profile
  across the tested windows and vaults. Browser transaction tests do not prove
  Typora origin sharing. An origin difference blocks the global-pins claim.
- Inspect light/dark and narrow panels, long duplicate basenames and Unicode.
  Tab through all actions and change tabs with arrow keys.
- Repeat with core tabs enabled and disabled, and on macOS before declaring
  two-platform support.

## Initial behavior boundaries

Pins and preferences use the plugin-owned `prisant-labs.quick-access` IndexedDB
database in Typora's browser profile. Transactions reread current state before
updates. Malformed data produces an error and is preserved rather than reset.
Clearing the application's browser data can remove this database.

Folder switching and file-manager actions use narrowly isolated native bridge
calls because the core does not export these operations. Native validation is
required for their platform-specific behavior. Quick Access does not move,
rename or delete target files.

Known candidate limitation: after a failed target becomes available again,
successfully revealing it in the file manager can leave its Unavailable badge
visible. Observing that location as current in Typora clears the badge. A native
dispatch alone is not treated as proof that the target exists or opened.
