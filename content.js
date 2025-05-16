const docs = {};
const lru = new Map();
const lruCap = 64;
let db;
const COMMON_FUNCTIONS = ['createCanvas', 'rect', 'ellipse', 'line', 'mouseX', 'mouseY', 'background', 'fill', 'stroke'];
let remainingDocsLoaded = false;

function strip(htmlString) {
  const tmp = document.createElement('div');
  tmp.innerHTML = htmlString;
  return tmp.textContent.trim().replace(/\s+/g, ' ');
}

function docFor(sym) {
  if (lru.has(sym)) return lru.get(sym);
  const d = docs[sym];
  if (!d && !remainingDocsLoaded) {
    // If doc not found and remaining docs aren't loaded, load them now
    loadRemainingDocs();
  }
  if (!d) return null;
  lru.set(sym, d);
  if (lru.size > lruCap) lru.delete(lru.keys().next().value);
  return d;
}

// Initialize IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('p5DocsDB', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('docs')) {
        db.createObjectStore('docs');
      }
    };
  });
}

async function loadRemainingDocs() {
  if (remainingDocsLoaded) return;
  
  try {
    const store = db.transaction('docs', 'readonly').objectStore('docs');
    const request = store.get('remainingDocs');
    
    request.onsuccess = () => {
      if (request.result) {
        Object.assign(docs, request.result);
        remainingDocsLoaded = true;
      } else {
        // If not in IndexedDB, fetch from file
        fetch(chrome.runtime.getURL('p5-ref-slim.json'))
          .then(r => r.json())
          .then(raw => {
            const remaining = {};
            for (const [k, v] of Object.entries(raw)) {
              if (!COMMON_FUNCTIONS.includes(k)) {
                v.description = strip(v.description || '');
                remaining[k] = v;
                docs[k] = v;
              }
            }
            // Store remaining docs in IndexedDB
            const writeStore = db.transaction('docs', 'readwrite').objectStore('docs');
            writeStore.put(remaining, 'remainingDocs');
            remainingDocsLoaded = true;
          });
      }
    };
  } catch (error) {
    console.error('Error loading remaining docs:', error);
  }
}

async function loadDocs(callback) {
  try {
    await initDB();
    const store = db.transaction('docs', 'readonly').objectStore('docs');
    const request = store.get('commonDocs');
    
    request.onsuccess = async () => {
      if (request.result) {
        // Use cached common functions
        Object.assign(docs, request.result);
        callback();
        
        // Start loading remaining docs in background
        setTimeout(loadRemainingDocs, 1000);
      } else {
        // Initial load of everything
        const response = await fetch(chrome.runtime.getURL('p5-ref-slim.json'));
        const raw = await response.json();
        
        // Split into common and remaining docs
        const common = {};
        const remaining = {};
        
        for (const [k, v] of Object.entries(raw)) {
          v.description = strip(v.description || '');
          if (COMMON_FUNCTIONS.includes(k)) {
            common[k] = v;
            docs[k] = v;
          } else {
            remaining[k] = v;
          }
        }
        
        // Store both separately in IndexedDB
        const writeStore = db.transaction('docs', 'readwrite').objectStore('docs');
        writeStore.put(common, 'commonDocs');
        writeStore.put(remaining, 'remainingDocs');
        
        callback();
        remainingDocsLoaded = true;
      }
    };
  } catch (error) {
    console.error('Error in progressive loading:', error);
    // Fallback to original method
    fetch(chrome.runtime.getURL('p5-ref-slim.json'))
      .then(r => r.json())
      .then(raw => {
        for (const [k, v] of Object.entries(raw)) {
          v.description = strip(v.description || '');
          docs[k] = v;
        }
        callback();
        remainingDocsLoaded = true;
      });
  }
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
let currentWord = null;
let lastX = null;
let lastY = null;
let lastMoveTime = 0;
const MOVE_THRESHOLD = 5; // minimum pixels moved before updating
const THROTTLE_MS = 16; // roughly 60fps

// Add styles for parameter display
const styles = document.createElement('style');
styles.textContent = `
  .p5-tooltip .signature {
    color: #9cdcfe;
    border-bottom: 1px solid #444;
    padding-bottom: 6px;
    margin-bottom: 6px;
  }
  .p5-tooltip .param-name {
    color: #9cdcfe;
  }
  .p5-tooltip .param-type {
    color: #4ec9b0;
    font-style: italic;
  }
  .p5-tooltip .optional {
    color: #666;
  }
  .p5-tooltip .description {
    margin-top: 8px;
    color: #d4d4d4;
  }
  .p5-tooltip .param-list {
    margin-top: 4px;
    padding-left: 12px;
  }
  .p5-tooltip .param-item {
    margin: 4px 0;
  }
`;
document.head.appendChild(styles);

function shouldUpdatePosition(x, y) {
  if (lastX === null || lastY === null) return true;
  
  const dx = Math.abs(x - lastX);
  const dy = Math.abs(y - lastY);
  const timeSinceLastMove = Date.now() - lastMoveTime;
  
  return (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) && timeSinceLastMove >= THROTTLE_MS;
}

function updateTooltipPosition(x, y) {
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
  
  lastX = x;
  lastY = y;
  lastMoveTime = Date.now();
}

function formatSignature(word, params) {
  let signature = `${word}(`;
  if (params) {
    signature += params.map(p => {
      let paramStr = p.name;
      if (p.optional) {
        paramStr = `[${paramStr}]`;
      }
      return paramStr;
    }).join(', ');
  }
  signature += ')';
  return signature;
}

function showTip(x, y, text, word) {
  // Only update if it's a different word/documentation
  if (currentWord === word) {
    // Just update position if needed
    if (shouldUpdatePosition(x, y)) {
      updateTooltipPosition(x, y);
    }
    return;
  }

  currentWord = word;
  lastX = x;
  lastY = y;
  lastMoveTime = Date.now();
  
  tooltip.innerHTML = ''; // Clear previous content
  
  const doc = docFor(word);
  if (!doc) return;

  const content = document.createElement('div');
  
  // Add function signature if params exist
  if (doc.params && doc.params.length > 0) {
    const signatureDiv = document.createElement('div');
    signatureDiv.className = 'signature';
    signatureDiv.textContent = formatSignature(word, doc.params);
    content.appendChild(signatureDiv);

    const paramList = document.createElement('div');
    paramList.className = 'param-list';
    
    doc.params.forEach(param => {
      const paramItem = document.createElement('div');
      paramItem.className = 'param-item';
      
      const paramName = document.createElement('span');
      paramName.className = 'param-name';
      paramName.textContent = param.name;
      
      const paramType = document.createElement('span');
      paramType.className = 'param-type';
      paramType.textContent = `: ${param.type}`;
      
      paramItem.appendChild(paramName);
      paramItem.appendChild(paramType);
      
      if (param.optional) {
        const optional = document.createElement('span');
        optional.className = 'optional';
        optional.textContent = ' (optional)';
        paramItem.appendChild(optional);
      }
      
      if (param.description) {
        const desc = document.createElement('div');
        desc.className = 'description';
        desc.textContent = param.description;
        paramItem.appendChild(desc);
      }
      
      paramList.appendChild(paramItem);
    });
    
    content.appendChild(paramList);
  }

  // Add main description
  const descDiv = document.createElement('div');
  descDiv.className = 'description';
  descDiv.style.marginTop = doc.params && doc.params.length > 0 ? '12px' : '0';
  descDiv.textContent = text;
  content.appendChild(descDiv);

  content.style.paddingRight = '20px'; // Make space for lock indicator
  tooltip.appendChild(content);
  tooltip.appendChild(lockIndicator);
  tooltip.style.display = "block";

  updateTooltipPosition(x, y);
  lockIndicator.style.display = isTooltipLocked ? "block" : "none";
}

function hideTip() {
  if (isTooltipLocked) return;
  tooltip.style.display = "none";
  hideBox();
  currentWord = null;
  lastX = null;
  lastY = null;
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
  let activeElement = null;

  function findTargetElement(e) {
    if (!(e.target instanceof Element)) return null;

    let tok = e.target.closest("span[class^='cm-']");
    
    if (!tok) {
      const line = e.target.closest('.CodeMirror-line');
      if (line) {
        const spans = [...line.querySelectorAll("span[class^='cm-']")];
        if (spans.length === 0) return null;
        
        // pick the nearest span to mouse X
        const nearest = spans.reduce((a, b) => {
          const aDist = Math.abs(a.getBoundingClientRect().left - e.clientX);
          const bDist = Math.abs(b.getBoundingClientRect().left - e.clientX);
          return aDist < bDist ? a : b;
        }, spans[0]);

        tok = nearest;
      }
    }

    return tok;
  }

  // Handle showing tooltip when mouse enters a code element
  document.addEventListener('mouseover', e => {
    const tok = findTargetElement(e);
    if (!tok) return;

    const word = tok.textContent.trim();
    const doc = docFor(word);
    
    if (doc) {
      activeElement = tok;
      currentDoc = doc;
      showTip(e.pageX, e.pageY, doc.description, word);
      showBox(tok);
    }
  }, true);

  // Handle hiding tooltip when mouse leaves a code element
  document.addEventListener('mouseout', e => {
    if (!(e.target instanceof Element)) return;
    
    const tok = e.target.closest("span[class^='cm-']") || e.target.closest('.CodeMirror-line');
    if (!tok) return;
    
    // Check if we're moving to the tooltip or a child of the current element
    const relatedTarget = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    if (!isHoveringTooltip && 
        (!relatedTarget || 
         (!relatedTarget.closest('.p5-tooltip') && 
          !tok.contains(relatedTarget)))) {
      hideTip();
    }
  }, true);

  // Only update position when tooltip is already visible
  document.addEventListener('mousemove', e => {
    if (!tooltip.style.display || tooltip.style.display === 'none') return;
    if (isTooltipLocked || isHoveringTooltip) return;

    // Update position if we've moved enough
    if (shouldUpdatePosition(e.pageX, e.pageY)) {
      updateTooltipPosition(e.pageX, e.pageY);
    }
  });
});
