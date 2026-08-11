/* p5-tip — VSCode-style hover docs for the p5.js web editor.
 *
 * Design notes (these are what keep it from flickering):
 *  - the tooltip anchors to the hovered token's rect, it never follows the cursor
 *  - it is pointer-events:none unless pinned, so it can never steal its own hover
 *  - hit-testing goes through caretRangeFromPoint + an exact rect containment
 *    check, so it works on CodeMirror 5 and 6 and ignores blank space
 *  - show/hide run through timers with hysteresis; re-hovering the same token is
 *    a no-op that writes nothing to the DOM
 */
(() => {
  'use strict';

  const SHOW_DELAY = 140;      // ms of hover intent before the first tooltip
  const RESHOW_DELAY = 40;     // ms when one is already open (feels instant)
  const HIDE_DELAY = 120;      // grace period, absorbs CodeMirror re-renders
  const GAP = 6;               // px between token and tooltip
  const MARGIN = 8;            // px kept clear of the viewport edge
  const DEBUG = (() => {
    try { return localStorage.getItem('p5tip:debug') === '1'; } catch { return false; }
  })();

  const EDITOR_SEL = '.CodeMirror, .cm-editor, .CodeMirror-line, .cm-content';
  // token classes we refuse to look up: comments, strings, literals, and names
  // the user is defining themselves
  const SKIP_TOKEN = /\bcm-(comment|string|string-2|number|atom|def|keyword|operator|meta|tag)\b/;

  // ---------------------------------------------------------------- docs ----

  let docs = null;
  let docsPromise = null;

  function loadDocs() {
    if (docsPromise) return docsPromise;
    docsPromise = fetch(chrome.runtime.getURL('p5-ref-slim.json'))
      .then(r => {
        if (!r.ok) throw new Error(`p5-tip: HTTP ${r.status} loading reference`);
        return r.json();
      })
      .then(raw => {
        for (const v of Object.values(raw)) {
          if (typeof v.description === 'string') {
            v.description = v.description.replace(/\s+/g, ' ').trim();
          }
        }
        docs = raw;
        return raw;
      })
      .catch(err => {
        console.error('p5-tip: failed to load reference', err);
        docs = {};        // fail closed; the extension just does nothing
        return docs;
      });
    return docsPromise;
  }

  function docFor(word) {
    return docs ? (docs[word] || null) : null;
  }

  // --------------------------------------------------------------- shell ----

  const host = document.createElement('div');
  host.className = 'p5-tip-host';
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
    // start off-screen so the very first measurement never flashes in view
    transform: 'translate3d(-9999px, -9999px, 0)',
    visibility: 'hidden',
  });
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .tip {
        box-sizing: border-box;
        font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        color: #d4d4d4;
        background: #1f1f1f;
        border: 1px solid #454545;
        border-radius: 6px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, .45);
        padding: 8px 10px;
        max-width: 460px;
        overflow-y: auto;
        overscroll-behavior: contain;
        word-break: break-word;
        white-space: normal;
      }
      .signature {
        color: #9cdcfe;
        border-bottom: 1px solid #3a3a3a;
        padding-bottom: 6px;
        margin-bottom: 6px;
        white-space: pre-wrap;
      }
      .signature .ret { color: #4ec9b0; font-style: italic; }
      .param-list { margin: 6px 0 0; padding: 0 0 0 2px; }
      .param-item { margin: 5px 0; }
      .param-name { color: #9cdcfe; }
      .param-type { color: #4ec9b0; font-style: italic; }
      .optional { color: #808080; }
      .param-desc { color: #b0b0b0; margin: 1px 0 0 12px; }
      .description { color: #d4d4d4; }
      .signature + .description { margin-top: 0; }
      .returns { color: #b0b0b0; margin-top: 8px; }
      .returns .label { color: #4ec9b0; font-style: italic; }
      .hint {
        margin-top: 8px;
        padding-top: 6px;
        border-top: 1px solid #3a3a3a;
        font-size: 11px;
        color: #7a7a7a;
      }
      .tip.pinned { border-color: #6a6a6a; }
    </style>
    <div class="tip" part="tip"></div>
  `;
  const tip = root.querySelector('.tip');

  // Debug overlay for the hovered token. pointer-events:none is not optional —
  // an interactive overlay here is what made the original build flicker.
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed',
    border: '1px dashed #f0f',
    pointerEvents: 'none',
    zIndex: '2147483646',
    display: 'none',
  });

  function mount() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (DEBUG && !box.isConnected) document.documentElement.appendChild(box);
  }
  mount();
  // some editors wipe <body>; re-attach if we ever get evicted
  new MutationObserver(mount).observe(document.documentElement, { childList: true });

  // ---------------------------------------------------------- hit testing ----

  const WORD_CHAR = /[A-Za-z0-9_$]/;

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) return { node: pos.offsetNode, offset: pos.offset };
    }
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (range) return { node: range.startContainer, offset: range.startOffset };
    }
    return null;
  }

  /** Returns { word, rect, el } for the identifier under (x, y), else null. */
  function tokenAt(x, y) {
    const caret = caretAt(x, y);
    if (!caret || !caret.node || caret.node.nodeType !== Node.TEXT_NODE) return null;

    const node = caret.node;
    const el = node.parentElement;
    if (!el || !el.closest(EDITOR_SEL)) return null;
    if (SKIP_TOKEN.test(el.className || '')) return null;

    const text = node.nodeValue || '';
    let start = Math.max(0, Math.min(caret.offset, text.length));
    let end = start;
    while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
    while (end < text.length && WORD_CHAR.test(text[end])) end++;
    if (start === end) return null;

    const word = text.slice(start, end);
    if (!/^[A-Za-z_$]/.test(word)) return null;

    // The caret API clamps to the nearest character, so hovering the blank space
    // past the end of a line still resolves to a word. Require real containment.
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const rect = [...range.getClientRects()].find(r =>
      x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1
    );
    if (!rect) return null;

    return { word, rect, el };
  }

  // -------------------------------------------------------------- render ----

  function signatureOf(word, doc) {
    const params = doc.params || [];
    const hasReturn = !!(doc.return && doc.return.type);
    if (!params.length && !hasReturn) return null;   // a property, e.g. mouseX
    const args = params.map(p => (p.optional ? `[${p.name}]` : p.name)).join(', ');
    return { call: `${word}(${args})`, ret: hasReturn ? doc.return.type : null };
  }

  function render(word, doc) {
    const frag = document.createDocumentFragment();
    const sig = signatureOf(word, doc);

    if (sig) {
      const line = document.createElement('div');
      line.className = 'signature';
      line.append(sig.call);
      if (sig.ret) {
        const ret = document.createElement('span');
        ret.className = 'ret';
        ret.textContent = ` → ${sig.ret}`;
        line.appendChild(ret);
      }
      frag.appendChild(line);
    }

    if (doc.description) {
      const desc = document.createElement('div');
      desc.className = 'description';
      desc.textContent = doc.description;
      frag.appendChild(desc);
    }

    if (doc.params && doc.params.length) {
      const list = document.createElement('div');
      list.className = 'param-list';
      for (const p of doc.params) {
        const item = document.createElement('div');
        item.className = 'param-item';

        const name = document.createElement('span');
        name.className = 'param-name';
        name.textContent = p.name;
        item.appendChild(name);

        if (p.type) {
          const type = document.createElement('span');
          type.className = 'param-type';
          type.textContent = `: ${p.type}`;
          item.appendChild(type);
        }
        if (p.optional) {
          const opt = document.createElement('span');
          opt.className = 'optional';
          opt.textContent = ' (optional)';
          item.appendChild(opt);
        }
        if (p.description) {
          const d = document.createElement('div');
          d.className = 'param-desc';
          d.textContent = p.description;
          item.appendChild(d);
        }
        list.appendChild(item);
      }
      frag.appendChild(list);
    }

    if (doc.return && doc.return.description) {
      const ret = document.createElement('div');
      ret.className = 'returns';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = 'returns: ';
      ret.appendChild(label);
      ret.append(doc.return.description);
      frag.appendChild(ret);
    }

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Ctrl — pin & scroll';
    frag.appendChild(hint);

    tip.replaceChildren(frag);
  }

  /** Anchors the tooltip under (or above) the token rect, clamped to the viewport. */
  function place(rect) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    const below = vh - rect.bottom - GAP - MARGIN;
    const above = rect.top - GAP - MARGIN;
    const flip = below < 140 && above > below;

    tip.style.maxHeight = `${Math.max(80, Math.floor(flip ? above : below))}px`;
    tip.style.maxWidth = `${Math.min(460, vw - 2 * MARGIN)}px`;

    // measure with the real content in place, while still hidden off-screen
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;

    let left = rect.left;
    if (left + w > vw - MARGIN) left = vw - MARGIN - w;
    if (left < MARGIN) left = MARGIN;

    let top = flip ? rect.top - GAP - h : rect.bottom + GAP;
    if (top < MARGIN) top = MARGIN;
    if (top + h > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - h);

    host.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  // --------------------------------------------------------------- state ----

  let currentKey = null;    // key of the token the tooltip is showing
  let anchorEl = null;      // element the tooltip is anchored to
  let pinned = false;
  let showTimer = 0;
  let hideTimer = 0;
  let pointerX = 0;
  let pointerY = 0;
  let rafId = 0;

  const keyOf = t => `${t.word}@${Math.round(t.rect.left)},${Math.round(t.rect.top)}`;
  const visible = () => host.style.visibility === 'visible';

  function clearTimers() {
    clearTimeout(showTimer); showTimer = 0;
    clearTimeout(hideTimer); hideTimer = 0;
  }

  function show(token, doc) {
    render(token.word, doc);
    currentKey = keyOf(token);
    anchorEl = token.el;
    place(token.rect);
    host.style.visibility = 'visible';
    if (DEBUG) {
      Object.assign(box.style, {
        left: `${token.rect.left}px`,
        top: `${token.rect.top}px`,
        width: `${token.rect.width}px`,
        height: `${token.rect.height}px`,
        display: 'block',
      });
    }
  }

  function hide() {
    clearTimers();
    if (!visible() && !currentKey) return;
    pinned = false;
    host.style.visibility = 'hidden';
    host.style.pointerEvents = 'none';
    host.style.transform = 'translate3d(-9999px, -9999px, 0)';
    tip.classList.remove('pinned');
    tip.scrollTop = 0;
    currentKey = null;
    anchorEl = null;
    box.style.display = 'none';
  }

  function evaluate() {
    if (pinned) return;

    const token = tokenAt(pointerX, pointerY);
    const doc = token && docFor(token.word);

    if (!doc) {
      clearTimeout(showTimer); showTimer = 0;
      if (visible() && !hideTimer) hideTimer = setTimeout(hide, HIDE_DELAY);
      return;
    }

    const key = keyOf(token);
    if (key === currentKey && visible()) {
      // same token, already shown: cancel any pending hide and touch nothing
      clearTimeout(hideTimer); hideTimer = 0;
      return;
    }

    clearTimeout(hideTimer); hideTimer = 0;
    if (key === currentKey && showTimer) return;   // show already queued
    clearTimeout(showTimer);
    currentKey = key;
    showTimer = setTimeout(() => {
      showTimer = 0;
      // re-verify: the pointer may have moved or the line re-rendered since
      const fresh = tokenAt(pointerX, pointerY);
      const freshDoc = fresh && docFor(fresh.word);
      if (!freshDoc) { currentKey = null; return; }
      show(fresh, freshDoc);
    }, visible() ? RESHOW_DELAY : SHOW_DELAY);
  }

  function scheduleEvaluate() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; evaluate(); });
  }

  // ------------------------------------------------------------- events ----

  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (pinned) return;
    if (e.buttons !== 0) { hide(); return; }   // dragging/selecting: get out of the way
    scheduleEvaluate();
  }, { passive: true, capture: true });

  document.addEventListener('pointerdown', () => { if (!pinned) hide(); }, true);
  document.addEventListener('pointerleave', () => { if (!pinned) hide(); });
  window.addEventListener('blur', hide);

  // any layout change invalidates the anchor rect, so drop the tooltip
  document.addEventListener('scroll', () => hide(), { capture: true, passive: true });
  window.addEventListener('resize', hide, { passive: true });
  document.addEventListener('wheel', e => {
    if (pinned && e.composedPath().includes(tip)) return;   // let a pinned tip scroll
    hide();
  }, { capture: true, passive: true });

  document.addEventListener('keydown', e => {
    if (e.key === 'Control') {
      if (pinned) { hide(); return; }
      if (!visible()) return;
      pinned = true;
      host.style.pointerEvents = 'auto';
      tip.classList.add('pinned');
      return;
    }
    if (e.key === 'Escape') { hide(); return; }
    if (!e.ctrlKey && !e.metaKey) hide();   // typing dismisses it
  }, true);

  // CodeMirror recycles line elements constantly; if ours is gone, so are we
  new MutationObserver(() => {
    if (anchorEl && !anchorEl.isConnected) hide();
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Warm the reference up out of band, then re-check in case the pointer is
  // already parked on a symbol.
  const warm = () => loadDocs().then(scheduleEvaluate);
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2000 });
  else setTimeout(warm, 0);

  console.log(`p5-tip loaded${DEBUG ? ' (debug)' : ''}`);
})();
