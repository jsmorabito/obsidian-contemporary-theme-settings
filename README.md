# Contemporary Theme Settings

Companion plugin for the Contemporary theme (`.obsidian/themes/Contemporary`).

Adds a "..." button to the **Files** row in the left sidebar (shown on hover or keyboard
focus). Its menu holds the file explorer's actions (new note, new folder, sort order,
auto-reveal, expand/collapse). The explorer's own button row is hidden once the menu
button is in place.

Editor tabs: the close button only shows while you hover a tab (the active tab too), and a
link button appears next to it that copies `[[Note name]]` to the clipboard. Long titles fade
out at the end instead of showing "…", and scroll once to the end while you hover the tab.

- Desktop only.
- Uses a few non-public Obsidian internals (`leaf.tabHeaderEl`, `leaf.loadIfDeferred`,
  the explorer's `.nav-buttons-container`); all are guarded so a change degrades to the
  normal explorer buttons.
- No build step: `main.js`, `styles.css` and `manifest.json` are loaded directly.
