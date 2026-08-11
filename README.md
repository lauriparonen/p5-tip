# 🎯 p5-tip

browser extension that adds VScode-style hover-tooltips for [p5.js](https://p5js.org/) functions inside the p5 web editor.  
hover over a method -> display info (¯▿¯)

![image](https://github.com/user-attachments/assets/88183796-6dcb-4552-b862-37dfbfe4b668)

## features

- inline tooltips with signatures, parameter lists, return types and descriptions
- uses pre-scraped docs from the official p5.js `.mdx` reference
- works in the default editor.p5js.org environment
- **anchored** to the hovered token like vscode — it doesn't chase your cursor,
  so it doesn't flicker
- skips comments, strings, literals and your own `function` names
- pin the tooltip with **ctrl** to scroll long ones; **esc** (or ctrl again) releases it
- visual debug mode for the token bounding box (dev only)

## controls

| key | what it does |
| --- | --- |
| `ctrl` | pin the open tooltip — it stays put and becomes scrollable |
| `ctrl` / `esc` | release the pin |
| any other key, scroll, click | dismiss |

## how it stays still

the tooltip lives in a shadow root (the editor's css can't reach it) and is
`pointer-events: none` unless pinned, so it can never steal the hover from the
token underneath. hit-testing goes through `caretRangeFromPoint` plus an exact
rect-containment check rather than guessing the nearest `span`, which means
blank space past the end of a line resolves to nothing. show/hide run on timers
with hysteresis, and re-hovering the same token writes nothing to the dom at all.

## status

🧪 prototype — not yet published as a real extension  
🧠 powered by a scraped and sanitized reference json from [p5-reference-scraper](https://github.com/lauriparonen/p5-ref)

## dev

install locally in chrome:

1. go to `chrome://extensions`
2. enable **developer mode**
3. click **Load unpacked**
4. select the `P5-TIP` project folder

files:

- `content.js`: injects tooltip logic into the page
- `p5-ref-slim.json`: json file containing the sanitized documentation
- `manifest.json`: standard extension manifest
- `styles.css`: host element styling (the tooltip itself is styled inside the shadow root)

turn on the debug overlay from the editor's devtools console:

```js
localStorage.setItem('p5tip:debug', '1'); // then reload
```

## todo

- [x] smart position near cursor
- [x] fix occasional flickering of the tooltip when rendering
- [ ] don't match p5 names that are shadowed by the user's own variables
- [ ] code examples in the tooltip
