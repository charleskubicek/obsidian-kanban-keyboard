# Kanban (keyboard)

A fork of the [Obsidian Kanban plugin](https://github.com/mgmeyers/obsidian-kanban) (v2.0.51) that adds keyboard navigation to boards. Everything else, including the board file format, is unchanged.

It uses the same view type as the original, so disable "Kanban" before enabling "Kanban (keyboard)".

## Keyboard

Click a board (or open it) and use:

| Key | Action |
|---|---|
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Next / previous list (wraps around, skips collapsed lists) |
| <kbd>↓</kbd> / <kbd>↑</kbd> | Next / previous card in the list |
| <kbd>Enter</kbd> | Edit the selected card |
| <kbd>Escape</kbd> | Clear the selection |
| <kbd>Space</kbd> | Tick or untick the selected card |
| <kbd>n</kbd> | Add a new card to the selected list |
| <kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>Alt</kbd>+<kbd>↓</kbd> | Move the card up / down within its list |
| <kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>Alt</kbd>+<kbd>→</kbd> | Move the card to the previous / next list, keeping its row where possible |

Archive and delete have commands but no default key, so a single keystroke can't remove a card.

Clicking a card also selects it. Keys are ignored while you're typing in a card, a search box or any other input, and while a menu, modal or the command palette is open. Works in board and list view; table view is unaffected.

### Rebinding

Every action is an Obsidian command named **Kanban (keyboard): Keyboard: …**. Assign or change keys in **Settings → Hotkeys**.

## Building

```sh
npx yarn@1.22.22 install --frozen-lockfile --ignore-engines
node esbuild.config.mjs production
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/obsidian-kanban-keyboard/`, then enable the plugin (or toggle it off and on after an update).

## Original plugin

Create markdown-backed Kanban boards in [Obsidian](https://obsidian.md/). Documentation for everything apart from the keyboard features: [Obsidian Kanban Plugin Documentation](https://publish.obsidian.md/kanban/).

![Board view](https://github.com/mgmeyers/obsidian-kanban/blob/main/docs/Assets/Screen%20Shot%202021-09-16%20at%2012.58.22%20PM.png)

![Board settings](https://github.com/mgmeyers/obsidian-kanban/blob/main/docs/Assets/Screen%20Shot%202021-09-16%20at%201.10.38%20PM.png)
