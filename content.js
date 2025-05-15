const docs = {};
const lru = new Map();
const lruCap = 64;

function strip(htmlString) {
  const tmp = document.createElement('div');
  tmp.innerHTML = htmlString;
  return tmp.textContent.trim().replace(/\s+/g, ' ');
}

function docFor(sym) {
  if (lru.has(sym)) return lru.get(sym);
  const d = docs[sym];
  if (!d) return null;
  lru.set(sym, d);
  if (lru.size > lruCap) lru.delete(lru.keys().next().value);
  return d;
}

function loadDocs(callback) {
  fetch(chrome.runtime.getURL('p5-ref-slim.json')) // use the cleaned file
    .then(r => r.json())
    .then(raw => {
      for (const [k, v] of Object.entries(raw)) {
        v.description = strip(v.description || '');
        docs[k] = v;
      }

      ['createCanvas','rect','ellipse','line','mouseX','mouseY'].forEach(docFor);
      callback();
    });
}

// -------------------------------------

console.log("p5-hover-docs v0.2 loaded");

const tooltip = document.createElement("div");
tooltip.className = "p5-tooltip";
tooltip.style.display = "none";
tooltip.style.position = "absolute";
tooltip.style.background = "#222";
tooltip.style.color = "#fff";
tooltip.style.padding = "6px 10px";
tooltip.style.borderRadius = "6px";
tooltip.style.fontSize = "14px";
tooltip.style.fontFamily = "monospace";

tooltip.style.maxWidth = "400px";
tooltip.style.maxHeight = "200px";
tooltip.style.overflowY = "auto";
tooltip.style.wordBreak = "break-word";
tooltip.style.boxSizing = "border-box";

tooltip.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";
tooltip.style.background = "#222";
tooltip.style.border = "1px solid #555";
tooltip.style.pointerEvents = "auto";
tooltip.style.zIndex = "9999";

document.body.appendChild(tooltip);

// visual debug box for hovered symbol
const box = document.createElement('div');
Object.assign(box.style, {
  position: 'absolute',
  border: '1px dashed #f0f',
  pointerEvents: 'auto',
  zIndex: 9998,
  display: 'none',
});
document.body.appendChild(box);

function showBox(el) {
  const r = el.getBoundingClientRect();
  Object.assign(box.style, {
    left: `${r.left + window.scrollX}px`,
    top:  `${r.top  + window.scrollY}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    display: 'block',
  });
}

function hideBox() {
  box.style.display = 'none';
}

// Add a small indicator for locked state
const lockIndicator = document.createElement("div");
lockIndicator.style.position = "absolute";
lockIndicator.style.top = "2px";
lockIndicator.style.right = "4px";
lockIndicator.style.fontSize = "10px";
lockIndicator.style.color = "#666";
lockIndicator.textContent = "🔒 Press Ctrl to unlock";
lockIndicator.style.display = "none";
tooltip.appendChild(lockIndicator);

let isHoveringTooltip = false;
let currentDoc = null;
let isTooltipLocked = false;
let currentWord = null; // Track the current word being shown

function showTip(x, y, text, word) {
  // Only update if it's a different word/documentation
  if (currentWord === word) {
    // Just update position if needed
    const padding = 12;
    const rect = tooltip.getBoundingClientRect();
    const pageW = window.innerWidth;
    const pageH = window.innerHeight;

    // adjust X
    if (x + rect.width + padding > pageW) {
      x = pageW - rect.width - padding;
    }

    // flip Y if tooltip would overflow bottom
    if (y + rect.height + padding > pageH) {
      y = y - rect.height - padding;
    }

    tooltip.style.left = `${x + padding}px`;
    tooltip.style.top = `${y + padding}px`;
    return;
  }

  currentWord = word;
  tooltip.innerHTML = ''; // Clear previous content
  const content = document.createElement('div');
  content.textContent = text;
  content.style.paddingRight = '20px'; // Make space for lock indicator
  tooltip.appendChild(content);
  tooltip.appendChild(lockIndicator);
  tooltip.style.display = "block";

  const padding = 12;
  const rect = tooltip.getBoundingClientRect();
  const pageW = window.innerWidth;
  const pageH = window.innerHeight;

  // adjust X
  if (x + rect.width + padding > pageW) {
    x = pageW - rect.width - padding;
  }

  // flip Y if tooltip would overflow bottom
  if (y + rect.height + padding > pageH) {
    y = y - rect.height - padding;
  }

  tooltip.style.left = `${x + padding}px`;
  tooltip.style.top = `${y + padding}px`;
  
  lockIndicator.style.display = isTooltipLocked ? "block" : "none";
}

function hideTip() {
  if (isTooltipLocked) return; // Don't hide if locked
  tooltip.style.display = "none";
  hideBox();
  currentWord = null; // Reset current word when hiding
}

// Handle Control key events
document.addEventListener('keydown', (e) => {
  if (e.key === 'Control' && tooltip.style.display === 'block') {
    isTooltipLocked = true;
    lockIndicator.style.display = 'block';
    lockIndicator.textContent = "🔒 Press Ctrl to unlock";
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'Control' && isTooltipLocked) {
    isTooltipLocked = false;
    lockIndicator.style.display = 'none';
    if (!isHoveringTooltip && !currentDoc) {
      hideTip();
    }
  }
});

tooltip.addEventListener("mouseenter", () => {
  isHoveringTooltip = true;
});

tooltip.addEventListener("mouseleave", () => {
  isHoveringTooltip = false;
  if (!currentDoc && !isTooltipLocked) {
    hideTip();
  }
});

loadDocs(() => {
  document.addEventListener('mousemove', e => {
    // If tooltip is locked or we're hovering it, don't do anything
    if (isTooltipLocked || isHoveringTooltip) {
      return;
    }

    let tok = e.target.closest("span[class^='cm-']");

    if (!tok) {
      const line = e.target.closest('.CodeMirror-line');
      if (line) {
        const spans = [...line.querySelectorAll("span[class^='cm-']")];
        // pick the nearest span to mouse X
        const nearest = spans.reduce((a, b) => {
          const aDist = Math.abs(a.getBoundingClientRect().left - e.clientX);
          const bDist = Math.abs(b.getBoundingClientRect().left - e.clientX);
          return aDist < bDist ? a : b;
        }, spans[0]);

        tok = nearest;
      }
    }

    if (!tok) {
      currentDoc = null;
      if (!isHoveringTooltip) {
        hideTip();
      }
      return;
    }

    const word = tok.textContent.trim();
    const doc = docFor(word);
    currentDoc = doc;

    if (doc) {
      showTip(e.pageX, e.pageY, doc.description, word);
      showBox(tok);
    } else {
      currentDoc = null;
      hideTip();
    }
  });
});
