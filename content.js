console.log("p5-hover-docs v0.2 up");

const tooltip = document.createElement("div");
tooltip.className = "p5-tooltip";
tooltip.style.display = "none";
document.body.appendChild(tooltip);

// visual debug
const box = document.createElement('div');
Object.assign(box.style, {
  position: 'absolute',
  border: '1px dashed #f0f',
  pointerEvents: 'none',
  zIndex: 9998,
});
document.body.appendChild(box);

function showBox(el) {
  const r = el.getBoundingClientRect();
  Object.assign(box.style, {
    left: r.left + window.scrollX + 'px',
    top:  r.top  + window.scrollY + 'px',
    width: r.width + 'px',
    height: r.height + 'px',
    display: 'block',
  });
}

function hideBox() { box.style.display = 'none'; }

function showTip(e, word) {
  tooltip.textContent = p5Docs[word];
  tooltip.style.left = e.pageX + 12 + "px";
  tooltip.style.top  = e.pageY + 12 + "px";
  tooltip.style.display = "block";
}


document.addEventListener("mousemove", (e) => {
  const span = e.target.closest("span[class^='cm-']");
  if (!span) return hideTip();

  const word = span.textContent.trim();
  if (span && p5Docs[word]) {
    showTip(e, word);
    showBox(span);
  } else {
    hideTip();
    hideBox();
  }
  

  tooltip.textContent = p5Docs[word];
  tooltip.style.left = e.pageX + 12 + "px";
  tooltip.style.top  = e.pageY + 12 + "px";
  tooltip.style.display = "block";
});

function hideTip() {
  tooltip.style.display = "none";
}
