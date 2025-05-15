# 🎯 p5-tip

browser extension that adds hover-tooltips for [p5.js](https://p5js.org/) functions inside the p5 web editor.  
hover over a function → get the docs. no tab-switching; no friction 🌊

![example_p5tip](https://github.com/user-attachments/assets/0733e743-0961-41ee-b93f-0e3c146c926a)

## features

- inline tooltips with descriptions, return types, and examples
- uses pre-scraped docs from the official p5.js `.mdx` reference
- works in the default editor.p5js.org environment
- visual debug mode for bounding box overlay (dev only)
- locking the tooltip by pressing ctrl
    - enables scrolling lengthy ones

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
- `styles.css`: tooltip & debug box styling

## todo

-  smart position near cursor
-  add caching
-  ship a minified version
-  publish to chrome web store?
