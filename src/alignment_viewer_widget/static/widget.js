// Interactive pairwise-alignment viewer.
//
// The main sequence panel is drawn on a <canvas> and *virtualized*: only the
// columns currently scrolled into view are painted, so multi-kilobase
// alignments stay responsive. A left gutter (fixed) labels the rows, a minimap
// gives a whole-alignment overview, and a tooltip reports exact base positions.

const COLORS = {
  matchText: "#3b3b46",
  mismatchText: "#b00020",
  mismatchBg: "#ffdada",
  gapText: "#9aa0a6",
  gapBg: "#eceef0",
  matchBar: "#2da44e",
  ruler: "#6a737d",
  rulerTick: "#c2c8cf",
  hover: "#0969da",
};

// Below this column width we stop drawing glyphs and draw colored cells
// instead — an overview "heatmap" mode for zoomed-out / very long alignments.
const GLYPH_MIN_WIDTH = 7;

function render({ model, el }) {
  const target = model.get("target_row");
  const query = model.get("query_row");
  const tIdx = model.get("target_indices");
  const qIdx = model.get("query_indices");
  const tLabel = model.get("target_label") || "target";
  const qLabel = model.get("query_label") || "query";
  const score = model.get("score");
  const L = target.length;

  let baseWidth = model.get("base_width") || 11;
  const panelHeight = model.get("panel_height") || 140;

  // --- Per-column classification (computed once) ---------------------------
  // 0 = match, 1 = mismatch, 2 = gap
  const kind = new Uint8Array(L);
  let matches = 0,
    mismatches = 0,
    gaps = 0;
  for (let i = 0; i < L; i++) {
    const tc = target[i];
    const qc = query[i];
    if (tc === "-" || qc === "-") {
      kind[i] = 2;
      gaps++;
    } else if (tc.toUpperCase() === qc.toUpperCase()) {
      kind[i] = 0;
      matches++;
    } else {
      kind[i] = 1;
      mismatches++;
    }
  }
  const identity = L ? matches / L : 0;

  const firstDefined = (arr) => {
    for (let i = 0; i < arr.length; i++) if (arr[i] >= 0) return arr[i];
    return null;
  };
  const lastDefined = (arr) => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >= 0) return arr[i];
    return null;
  };
  // Ranges are reported 1-based inclusive for readability.
  const tStart = firstDefined(tIdx),
    tEnd = lastDefined(tIdx);
  const qStart = firstDefined(qIdx),
    qEnd = lastDefined(qIdx);
  const rangeStr = (s, e) =>
    s === null ? "—" : `${Math.min(s, e) + 1}–${Math.max(s, e) + 1}`;

  // --- DOM scaffold --------------------------------------------------------
  el.classList.add("avw");
  el.innerHTML = `
    <div class="avw-header">
      <div class="avw-title">Pairwise alignment</div>
      <div class="avw-stats"></div>
    </div>
    <div class="avw-toolbar">
      <button class="avw-btn" data-act="zoomout" title="Zoom out">−</button>
      <button class="avw-btn" data-act="zoomin" title="Zoom in">+</button>
      <button class="avw-btn" data-act="prev" title="Previous mismatch / gap">◀ diff</button>
      <button class="avw-btn" data-act="next" title="Next mismatch / gap">diff ▶</button>
      <label class="avw-goto">Go to ${tLabel} pos
        <input class="avw-goto-input" type="number" min="1" placeholder="…" />
      </label>
      <span class="avw-zoomlabel"></span>
    </div>
    <canvas class="avw-minimap"></canvas>
    <div class="avw-body">
      <canvas class="avw-gutter"></canvas>
      <div class="avw-scroll">
        <div class="avw-spacer"></div>
        <canvas class="avw-main"></canvas>
      </div>
    </div>
    <div class="avw-tooltip" hidden></div>
  `;

  const statsEl = el.querySelector(".avw-stats");
  const scoreStr = score === null || score === undefined ? "" : ` · score ${score}`;
  statsEl.innerHTML = `
    <span><b>${(identity * 100).toFixed(1)}%</b> identity</span>
    <span>${L.toLocaleString()} cols</span>
    <span class="avw-chip avw-chip-mm">${mismatches} mismatch</span>
    <span class="avw-chip avw-chip-gap">${gaps} gap</span>
    <span>${tLabel}: ${rangeStr(tStart, tEnd)}</span>
    <span>${qLabel}: ${rangeStr(qStart, qEnd)}</span>
    <span>${scoreStr}</span>`;

  const minimap = el.querySelector(".avw-minimap");
  const gutter = el.querySelector(".avw-gutter");
  const scrollEl = el.querySelector(".avw-scroll");
  const spacer = el.querySelector(".avw-spacer");
  const main = el.querySelector(".avw-main");
  const tooltip = el.querySelector(".avw-tooltip");
  const zoomLabel = el.querySelector(".avw-zoomlabel");
  const gotoInput = el.querySelector(".avw-goto-input");

  // --- Row layout (CSS pixels) --------------------------------------------
  const GUTTER_W = 78;
  const rulerH = 16;
  const seqRowH = 22;
  const matchRowH = 14;
  const layout = () => {
    let y = rulerH;
    const tY = y;
    y += seqRowH;
    const mY = y;
    y += matchRowH;
    const qY = y;
    y += seqRowH;
    const bottomRulerY = y;
    y += rulerH;
    return { tY, mY, qY, bottomRulerY, total: y };
  };
  const LY = layout();
  const fontPx = () => Math.min(15, Math.max(9, baseWidth + 2));

  let hoverCol = -1;

  // --- High-DPI canvas helper ---------------------------------------------
  function fitCanvas(canvas, cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  // --- Gutter (row labels), redrawn only on resize ------------------------
  function drawGutter(cssH) {
    const ctx = fitCanvas(gutter, GUTTER_W, cssH);
    ctx.clearRect(0, 0, GUTTER_W, cssH);
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    const tx = GUTTER_W - 8;
    ctx.fillStyle = COLORS.ruler;
    ctx.fillText("pos", tx, LY.tY - rulerH / 2);
    ctx.fillStyle = "#24292f";
    ctx.fillText(trunc(tLabel), tx, LY.tY + seqRowH / 2);
    ctx.fillText(trunc(qLabel), tx, LY.qY + seqRowH / 2);
    ctx.fillStyle = COLORS.ruler;
    ctx.fillText("pos", tx, LY.bottomRulerY + rulerH / 2);
  }
  function trunc(s) {
    return s.length > 11 ? s.slice(0, 10) + "…" : s;
  }

  // --- Choose a "nice" ruler step so labels don't collide -----------------
  function rulerStep() {
    const minPx = 56; // min pixels between labels
    const minCols = Math.ceil(minPx / baseWidth);
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 50000];
    for (const n of nice) if (n >= minCols) return n;
    return nice[nice.length - 1];
  }

  // --- Main panel: virtualized draw ---------------------------------------
  function drawMain() {
    const cssW = scrollEl.clientWidth;
    const cssH = LY.total;
    const ctx = fitCanvas(main, cssW, cssH);
    ctx.clearRect(0, 0, cssW, cssH);

    const scrollLeft = scrollEl.scrollLeft;
    const first = Math.max(0, Math.floor(scrollLeft / baseWidth));
    const last = Math.min(L - 1, Math.ceil((scrollLeft + cssW) / baseWidth));
    const glyphs = baseWidth >= GLYPH_MIN_WIDTH;
    const step = rulerStep();

    ctx.font = `${fontPx()}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    for (let i = first; i <= last; i++) {
      const x = i * baseWidth - scrollLeft;
      const cx = x + baseWidth / 2;
      const k = kind[i];

      // Backgrounds for mismatch / gap.
      if (k === 1) {
        ctx.fillStyle = COLORS.mismatchBg;
        ctx.fillRect(x, LY.tY, baseWidth, LY.qY + seqRowH - LY.tY);
      } else if (k === 2) {
        ctx.fillStyle = COLORS.gapBg;
        ctx.fillRect(x, LY.tY, baseWidth, LY.qY + seqRowH - LY.tY);
      }

      if (glyphs) {
        // Target base
        ctx.fillStyle = cellColor(k, target[i]);
        ctx.fillText(target[i], cx, LY.tY + seqRowH / 2);
        // Match bar
        if (k === 0) {
          ctx.fillStyle = COLORS.matchBar;
          ctx.fillText("|", cx, LY.mY + matchRowH / 2);
        } else if (k === 1) {
          ctx.fillStyle = COLORS.mismatchText;
          ctx.fillText("·", cx, LY.mY + matchRowH / 2);
        }
        // Query base
        ctx.fillStyle = cellColor(k, query[i]);
        ctx.fillText(query[i], cx, LY.qY + seqRowH / 2);
      } else {
        // Overview cells.
        ctx.fillStyle = cellFill(k);
        ctx.fillRect(x + 0.5, LY.tY + 2, baseWidth - 1, seqRowH - 4);
        ctx.fillRect(x + 0.5, LY.qY + 2, baseWidth - 1, seqRowH - 4);
      }

      // Ruler ticks (top: target coords; bottom: query coords), 1-based.
      tick(ctx, i, tIdx, step, LY.tY, -1, cx, x);
      tick(ctx, i, qIdx, step, LY.bottomRulerY, +1, cx, x);
    }

    // Hover highlight.
    if (hoverCol >= first && hoverCol <= last) {
      const x = hoverCol * baseWidth - scrollLeft;
      ctx.strokeStyle = COLORS.hover;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, LY.tY - 1, baseWidth - 1, LY.qY + seqRowH - LY.tY + 2);
    }

    drawMinimapViewport(first, last);
  }

  function tick(ctx, i, idx, step, rowY, dir, cx, x) {
    const p = idx[i];
    if (p < 0) return;
    if ((p + 1) % step !== 0) return;
    ctx.save();
    ctx.strokeStyle = COLORS.rulerTick;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Short tick adjacent to the sequence row.
    ctx.moveTo(cx, dir < 0 ? rowY - 5 : rowY);
    ctx.lineTo(cx, dir < 0 ? rowY : rowY + 5);
    ctx.stroke();
    ctx.fillStyle = COLORS.ruler;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = dir < 0 ? "bottom" : "top";
    ctx.textAlign = "center";
    ctx.fillText(String(p + 1), cx, dir < 0 ? rowY - 6 : rowY + 6);
    ctx.restore();
  }

  function cellColor(k, ch) {
    if (k === 2) return COLORS.gapText;
    if (k === 1) return COLORS.mismatchText;
    return COLORS.matchText;
  }
  function cellFill(k) {
    if (k === 2) return COLORS.gapBg;
    if (k === 1) return "#e5484d";
    return "#9fd3a8";
  }

  // --- Minimap -------------------------------------------------------------
  let minimapW = 0;
  const minimapH = 34;
  function drawMinimap() {
    minimapW = el.clientWidth - 4;
    if (minimapW <= 0) return;
    const ctx = fitCanvas(minimap, minimapW, minimapH);
    ctx.clearRect(0, 0, minimapW, minimapH);
    ctx.fillStyle = "#f6f8fa";
    ctx.fillRect(0, 0, minimapW, minimapH);
    // For each pixel column, take the most severe kind among its columns.
    for (let px = 0; px < minimapW; px++) {
      const c0 = Math.floor((px / minimapW) * L);
      const c1 = Math.max(c0 + 1, Math.floor(((px + 1) / minimapW) * L));
      let worst = 0;
      for (let c = c0; c < c1 && c < L; c++) {
        if (kind[c] > worst) worst = kind[c];
        if (worst === 2) break;
      }
      if (worst === 0) continue;
      ctx.fillStyle = worst === 2 ? "#b0b6bd" : "#e5484d";
      ctx.fillRect(px, 4, 1, minimapH - 8);
    }
  }
  function drawMinimapViewport(first, last) {
    if (minimapW <= 0) return;
    const ctx = minimap.getContext("2d");
    // Redraw is cheap enough; but to avoid wiping the density bars we only
    // overlay the viewport box on top of a fresh minimap.
    drawMinimap();
    const x0 = (first / L) * minimapW;
    const x1 = (Math.min(last + 1, L) / L) * minimapW;
    ctx.fillStyle = "rgba(9,105,218,0.15)";
    ctx.fillRect(x0, 0, Math.max(2, x1 - x0), minimapH);
    ctx.strokeStyle = COLORS.hover;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0), minimapH - 1);
  }

  // --- Interaction ---------------------------------------------------------
  function colAtClientX(clientX) {
    const rect = main.getBoundingClientRect();
    const local = clientX - rect.left + scrollEl.scrollLeft;
    return Math.floor(local / baseWidth);
  }

  function centerOnColumn(col) {
    col = Math.max(0, Math.min(L - 1, col));
    const targetLeft = col * baseWidth - scrollEl.clientWidth / 2 + baseWidth / 2;
    scrollEl.scrollLeft = Math.max(0, targetLeft);
  }

  scrollEl.addEventListener("scroll", drawMain, { passive: true });

  main.addEventListener("mousemove", (e) => {
    const col = colAtClientX(e.clientX);
    if (col < 0 || col >= L) {
      hideTooltip();
      return;
    }
    hoverCol = col;
    showTooltip(e, col);
    drawMain();
  });
  main.addEventListener("mouseleave", () => {
    hideTooltip();
  });

  function showTooltip(e, col) {
    const ti = tIdx[col];
    const qi = qIdx[col];
    const k = kind[col];
    const status =
      k === 0
        ? `<span class="avw-tt-match">match</span>`
        : k === 1
        ? `<span class="avw-tt-mm">mismatch</span>`
        : `<span class="avw-tt-gap">gap</span>`;
    const cell = (label, ch, pos) =>
      `<div><span class="avw-tt-key">${label}</span> ` +
      (pos < 0
        ? `<i>gap</i>`
        : `<code>${ch}</code> @ <b>${pos + 1}</b>`) +
      `</div>`;
    tooltip.innerHTML =
      `<div class="avw-tt-head">column ${col + 1} / ${L} · ${status}</div>` +
      cell(tLabel, target[col], ti) +
      cell(qLabel, query[col], qi);
    tooltip.hidden = false;
    const erect = el.getBoundingClientRect();
    let x = e.clientX - erect.left + 12;
    let y = e.clientY - erect.top + 12;
    // Keep inside the widget.
    const tw = tooltip.offsetWidth;
    if (x + tw > el.clientWidth) x = el.clientWidth - tw - 6;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }
  function hideTooltip() {
    tooltip.hidden = true;
    if (hoverCol !== -1) {
      hoverCol = -1;
      drawMain();
    }
  }

  // Minimap navigation (click + drag).
  let dragging = false;
  function minimapJump(clientX) {
    const rect = minimap.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / minimapW));
    centerOnColumn(Math.floor(frac * L));
  }
  minimap.addEventListener("mousedown", (e) => {
    dragging = true;
    minimapJump(e.clientX);
  });
  window.addEventListener("mousemove", (e) => {
    if (dragging) minimapJump(e.clientX);
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });

  // Jump to a target-sequence position (1-based) typed by the user.
  gotoInput.addEventListener("change", () => {
    const pos = parseInt(gotoInput.value, 10);
    if (!Number.isFinite(pos)) return;
    const want = pos - 1; // back to 0-based
    // Find the column whose target index is nearest to `want`.
    let best = -1,
      bestD = Infinity;
    for (let i = 0; i < L; i++) {
      if (tIdx[i] < 0) continue;
      const d = Math.abs(tIdx[i] - want);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      if (d === 0) break;
    }
    if (best >= 0) centerOnColumn(best);
  });

  // Jump to next/previous mismatch-or-gap from the current view center.
  function jumpDiff(dir) {
    const centerCol = Math.floor(
      (scrollEl.scrollLeft + scrollEl.clientWidth / 2) / baseWidth
    );
    let i = centerCol + dir;
    while (i >= 0 && i < L) {
      if (kind[i] !== 0) {
        centerOnColumn(i);
        return;
      }
      i += dir;
    }
  }

  // Zoom, preserving the centered column.
  function zoom(factor) {
    const centerCol = Math.floor(
      (scrollEl.scrollLeft + scrollEl.clientWidth / 2) / baseWidth
    );
    baseWidth = Math.max(2, Math.min(28, Math.round(baseWidth * factor)));
    updateZoomLabel();
    resizeAll();
    centerOnColumn(centerCol);
  }
  function updateZoomLabel() {
    zoomLabel.textContent =
      baseWidth < GLYPH_MIN_WIDTH ? `${baseWidth}px/col (overview)` : `${baseWidth}px/col`;
  }

  el.querySelector(".avw-toolbar").addEventListener("click", (e) => {
    const act = e.target.getAttribute("data-act");
    if (act === "zoomin") zoom(1.4);
    else if (act === "zoomout") zoom(1 / 1.4);
    else if (act === "next") jumpDiff(+1);
    else if (act === "prev") jumpDiff(-1);
  });

  // --- Sizing --------------------------------------------------------------
  function resizeAll() {
    spacer.style.width = L * baseWidth + "px";
    spacer.style.height = LY.total + "px";
    // The spacer carries the scroll width/height; pull the sticky canvas up to
    // overlay it instead of flowing beneath it.
    main.style.marginTop = -LY.total + "px";
    scrollEl.style.height = LY.total + "px";
    gutter.parentElement.style.height = LY.total + "px";
    drawGutter(LY.total);
    drawMinimap();
    drawMain();
  }

  updateZoomLabel();
  // Defer first layout until the element has a width.
  requestAnimationFrame(resizeAll);
  const ro = new ResizeObserver(() => resizeAll());
  ro.observe(el);

  return () => {
    ro.disconnect();
  };
}

export default { render };
