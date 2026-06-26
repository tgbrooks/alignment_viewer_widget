// Interactive pairwise-alignment viewer.
//
// The main sequence panel is drawn on a <canvas> and *virtualized*: only the
// columns currently scrolled into view are painted, so multi-kilobase
// alignments stay responsive. A left gutter (fixed) labels the rows, a minimap
// gives a whole-alignment overview, and a tooltip reports exact base positions.
//
// The column model spans the aligned region plus the unaligned flanks
// ("overhangs") on either side of a local alignment; the flanks can be toggled.

const COLORS = {
  matchText: "#3b3b46",
  mismatchText: "#b00020",
  mismatchBg: "#ffdada",
  gapText: "#9aa0a6",
  gapBg: "#eceef0",
  flankText: "#b6bcc4",
  flankBg: "#f3f4f6",
  matchBar: "#2da44e",
  ruler: "#6a737d",
  rulerTick: "#c2c8cf",
  hover: "#0969da",
  boundary: "#b08800",
};

// Below this column width we stop drawing glyphs and draw colored cells
// instead — an overview "heatmap" mode for zoomed-out / very long alignments.
const GLYPH_MIN_WIDTH = 7;
// Reserve vertical room so the horizontal scrollbar doesn't cover the bottom
// ruler row.
const SCROLLBAR_H = 16;

// Kind codes: 0 match, 1 mismatch, 2 gap, 3 unaligned flank.
const KIND = { m: 0, x: 1, g: 2, u: 3 };

function render({ model, el }) {
  const top = model.get("seq_top");
  const bot = model.get("seq_bot");
  const kindsStr = model.get("kinds");
  const topPos = model.get("top_pos");
  const botPos = model.get("bot_pos");
  const alignedStart = model.get("aligned_start");
  const alignedEnd = model.get("aligned_end");
  const totalTop = model.get("total_top");
  const totalBot = model.get("total_bot");
  const tLabel = model.get("label_top") || "target";
  const qLabel = model.get("label_bottom") || "query";
  const score = model.get("score");
  const L = top.length;

  let baseWidth = model.get("base_width") || 11;

  const kind = new Uint8Array(L);
  for (let i = 0; i < L; i++) kind[i] = KIND[kindsStr[i]] ?? 3;

  const hasFlanks = alignedStart > 0 || alignedEnd < L;
  let showFlanks = hasFlanks; // default: show overhangs when present

  // Stats over the aligned region only.
  let matches = 0,
    mismatches = 0,
    gaps = 0;
  for (let i = alignedStart; i < alignedEnd; i++) {
    if (kind[i] === 0) matches++;
    else if (kind[i] === 1) mismatches++;
    else if (kind[i] === 2) gaps++;
  }
  const alignedLen = alignedEnd - alignedStart;
  const identity = alignedLen ? matches / alignedLen : 0;

  const rangeOf = (arr, lo, hi) => {
    let mn = Infinity,
      mx = -Infinity;
    for (let i = lo; i < hi; i++) {
      const p = arr[i];
      if (p < 0) continue;
      if (p < mn) mn = p;
      if (p > mx) mx = p;
    }
    return mn === Infinity ? null : [mn, mx];
  };
  const tR = rangeOf(topPos, alignedStart, alignedEnd);
  const qR = rangeOf(botPos, alignedStart, alignedEnd);
  const rangeStr = (r, total) =>
    r === null ? "—" : `${r[0] + 1}–${r[1] + 1} of ${total}`;

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
      <button class="avw-btn avw-flank-btn" data-act="flanks" title="Toggle unaligned flanks"></button>
      <label class="avw-goto">Go to ${escapeHtml(tLabel)} pos
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
    <span>${alignedLen.toLocaleString()} aln cols</span>
    <span class="avw-chip avw-chip-mm">${mismatches} mismatch</span>
    <span class="avw-chip avw-chip-gap">${gaps} gap</span>
    <span>${escapeHtml(tLabel)}: ${rangeStr(tR, totalTop)}</span>
    <span>${escapeHtml(qLabel)}: ${rangeStr(qR, totalBot)}</span>
    <span>${scoreStr}</span>`;

  const flankBtn = el.querySelector(".avw-flank-btn");
  if (!hasFlanks) flankBtn.style.display = "none";

  const minimap = el.querySelector(".avw-minimap");
  const gutter = el.querySelector(".avw-gutter");
  const scrollEl = el.querySelector(".avw-scroll");
  const spacer = el.querySelector(".avw-spacer");
  const main = el.querySelector(".avw-main");
  const tooltip = el.querySelector(".avw-tooltip");
  const zoomLabel = el.querySelector(".avw-zoomlabel");
  const gotoInput = el.querySelector(".avw-goto-input");

  // --- View range (which columns are shown) -------------------------------
  const viewStart = () => (showFlanks ? 0 : alignedStart);
  const viewEnd = () => (showFlanks ? L : alignedEnd);
  const viewLen = () => viewEnd() - viewStart();

  // --- Row layout (CSS pixels) --------------------------------------------
  const GUTTER_W = 78;
  const rulerH = 18;
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

  let hoverCol = -1; // data column

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

  function rulerStep() {
    const minPx = 56;
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

    const r0 = viewStart();
    const N = viewLen();
    const scrollLeft = scrollEl.scrollLeft;
    const firstS = Math.max(0, Math.floor(scrollLeft / baseWidth));
    const lastS = Math.min(N - 1, Math.ceil((scrollLeft + cssW) / baseWidth));
    const glyphs = baseWidth >= GLYPH_MIN_WIDTH;
    const step = rulerStep();
    const bandH = LY.qY + seqRowH - LY.tY;

    ctx.font = `${fontPx()}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    for (let s = firstS; s <= lastS; s++) {
      const i = r0 + s; // data column
      const x = s * baseWidth - scrollLeft;
      const cx = x + baseWidth / 2;
      const k = kind[i];
      const tc = top[i];
      const qc = bot[i];

      // Column background (none for plain matches).
      const bg =
        k === 1 ? COLORS.mismatchBg : k === 2 ? COLORS.gapBg : k === 3 ? COLORS.flankBg : null;
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(x, LY.tY, baseWidth, bandH);
      }

      if (glyphs) {
        if (tc !== " ") {
          ctx.fillStyle = glyphColor(k);
          ctx.fillText(tc, cx, LY.tY + seqRowH / 2);
        }
        if (k === 0) {
          ctx.fillStyle = COLORS.matchBar;
          ctx.fillText("|", cx, LY.mY + matchRowH / 2);
        } else if (k === 1) {
          ctx.fillStyle = COLORS.mismatchText;
          ctx.fillText("·", cx, LY.mY + matchRowH / 2);
        }
        if (qc !== " ") {
          ctx.fillStyle = glyphColor(k);
          ctx.fillText(qc, cx, LY.qY + seqRowH / 2);
        }
      } else {
        if (tc !== " ") {
          ctx.fillStyle = cellFill(k);
          ctx.fillRect(x + 0.5, LY.tY + 2, baseWidth - 1, seqRowH - 4);
        }
        if (qc !== " ") {
          ctx.fillStyle = cellFill(k);
          ctx.fillRect(x + 0.5, LY.qY + 2, baseWidth - 1, seqRowH - 4);
        }
      }

      tick(ctx, topPos[i], step, LY.tY, -1, cx);
      tick(ctx, botPos[i], step, LY.bottomRulerY, +1, cx);
    }

    // Alignment-boundary markers (where the aligned region starts/ends).
    if (showFlanks && hasFlanks) {
      boundary(ctx, alignedStart - r0, scrollLeft);
      boundary(ctx, alignedEnd - r0, scrollLeft);
    }

    // Hover highlight.
    const hs = hoverCol - r0;
    if (hs >= firstS && hs <= lastS) {
      const x = hs * baseWidth - scrollLeft;
      ctx.strokeStyle = COLORS.hover;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, LY.tY - 1, baseWidth - 1, bandH + 2);
    }

    drawMinimapViewport(firstS, lastS);
  }

  function boundary(ctx, s, scrollLeft) {
    const x = s * baseWidth - scrollLeft;
    ctx.strokeStyle = COLORS.boundary;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, LY.tY);
    ctx.lineTo(x, LY.qY + seqRowH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function tick(ctx, p, step, rowY, dir, cx) {
    if (p < 0 || (p + 1) % step !== 0) return;
    ctx.save();
    ctx.strokeStyle = COLORS.rulerTick;
    ctx.lineWidth = 1;
    ctx.beginPath();
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

  function glyphColor(k) {
    if (k === 3) return COLORS.flankText;
    if (k === 2) return COLORS.gapText;
    if (k === 1) return COLORS.mismatchText;
    return COLORS.matchText;
  }
  function cellFill(k) {
    if (k === 3) return "#cdd2d8";
    if (k === 2) return COLORS.gapText;
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
    const r0 = viewStart();
    const N = viewLen();
    for (let px = 0; px < minimapW; px++) {
      const c0 = r0 + Math.floor((px / minimapW) * N);
      const c1 = r0 + Math.max(1, Math.floor(((px + 1) / minimapW) * N));
      let mm = false,
        grey = false;
      for (let c = c0; c < c1 && c < r0 + N; c++) {
        const k = kind[c];
        if (k === 1) {
          mm = true;
          break;
        }
        if (k === 2 || k === 3) grey = true;
      }
      if (!mm && !grey) continue;
      ctx.fillStyle = mm ? "#e5484d" : "#b0b6bd";
      ctx.fillRect(px, 4, 1, minimapH - 8);
    }
  }
  function drawMinimapViewport(firstS, lastS) {
    if (minimapW <= 0) return;
    const ctx = minimap.getContext("2d");
    drawMinimap();
    const N = viewLen();
    const x0 = (firstS / N) * minimapW;
    const x1 = (Math.min(lastS + 1, N) / N) * minimapW;
    ctx.fillStyle = "rgba(9,105,218,0.15)";
    ctx.fillRect(x0, 0, Math.max(2, x1 - x0), minimapH);
    ctx.strokeStyle = COLORS.hover;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0), minimapH - 1);
  }

  // --- Interaction ---------------------------------------------------------
  function dataColAtClientX(clientX) {
    const rect = main.getBoundingClientRect();
    const local = clientX - rect.left + scrollEl.scrollLeft;
    return viewStart() + Math.floor(local / baseWidth);
  }

  function centerOnColumn(dataCol) {
    const r0 = viewStart();
    const N = viewLen();
    const s = Math.max(0, Math.min(N - 1, dataCol - r0));
    scrollEl.scrollLeft = Math.max(0, s * baseWidth - scrollEl.clientWidth / 2 + baseWidth / 2);
  }
  function centerDataCol() {
    return viewStart() + Math.floor((scrollEl.scrollLeft + scrollEl.clientWidth / 2) / baseWidth);
  }

  scrollEl.addEventListener("scroll", drawMain, { passive: true });

  main.addEventListener("mousemove", (e) => {
    const col = dataColAtClientX(e.clientX);
    if (col < viewStart() || col >= viewEnd()) {
      hideTooltip();
      return;
    }
    hoverCol = col;
    showTooltip(e, col);
    drawMain();
  });
  main.addEventListener("mouseleave", hideTooltip);

  function showTooltip(e, col) {
    const k = kind[col];
    const ti = topPos[col];
    const qi = botPos[col];
    const label =
      k === 0
        ? `<span class="avw-tt-match">match</span>`
        : k === 1
        ? `<span class="avw-tt-mm">mismatch</span>`
        : k === 2
        ? `<span class="avw-tt-gap">gap</span>`
        : `<span class="avw-tt-gap">unaligned</span>`;
    const cell = (name, ch, pos) =>
      `<div><span class="avw-tt-key">${escapeHtml(name)}</span> ` +
      (pos < 0 || ch === " " || ch === "-"
        ? `<i>${ch === "-" ? "gap" : "—"}</i>`
        : `<code>${ch}</code> @ <b>${pos + 1}</b>`) +
      `</div>`;
    tooltip.innerHTML =
      `<div class="avw-tt-head">${label}</div>` +
      cell(tLabel, top[col], ti) +
      cell(qLabel, bot[col], qi);
    tooltip.hidden = false;
    const erect = el.getBoundingClientRect();
    let x = e.clientX - erect.left + 12;
    let y = e.clientY - erect.top + 12;
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
    centerOnColumn(viewStart() + Math.floor(frac * viewLen()));
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

  // Jump to a target-sequence position (1-based) within the current view.
  gotoInput.addEventListener("change", () => {
    const pos = parseInt(gotoInput.value, 10);
    if (!Number.isFinite(pos)) return;
    const want = pos - 1;
    let best = -1,
      bestD = Infinity;
    for (let i = viewStart(); i < viewEnd(); i++) {
      if (topPos[i] < 0) continue;
      const d = Math.abs(topPos[i] - want);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      if (d === 0) break;
    }
    if (best >= 0) centerOnColumn(best);
  });

  // Jump to next/previous mismatch-or-gap.
  function jumpDiff(dir) {
    let i = centerDataCol() + dir;
    while (i >= viewStart() && i < viewEnd()) {
      if (kind[i] === 1 || kind[i] === 2) {
        centerOnColumn(i);
        return;
      }
      i += dir;
    }
  }

  function zoom(factor) {
    const c = centerDataCol();
    baseWidth = Math.max(2, Math.min(28, Math.round(baseWidth * factor)));
    updateZoomLabel();
    resizeAll();
    centerOnColumn(c);
  }
  function updateZoomLabel() {
    zoomLabel.textContent =
      baseWidth < GLYPH_MIN_WIDTH ? `${baseWidth}px/col (overview)` : `${baseWidth}px/col`;
  }
  function updateFlankLabel() {
    flankBtn.textContent = showFlanks ? "Flanks: on" : "Flanks: off";
  }

  el.querySelector(".avw-toolbar").addEventListener("click", (e) => {
    const act = e.target.getAttribute("data-act");
    if (act === "zoomin") zoom(1.4);
    else if (act === "zoomout") zoom(1 / 1.4);
    else if (act === "next") jumpDiff(+1);
    else if (act === "prev") jumpDiff(-1);
    else if (act === "flanks") {
      const c = centerDataCol();
      showFlanks = !showFlanks;
      updateFlankLabel();
      resizeAll();
      centerOnColumn(c);
    }
  });

  // --- Sizing --------------------------------------------------------------
  function resizeAll() {
    spacer.style.width = viewLen() * baseWidth + "px";
    spacer.style.height = LY.total + "px";
    main.style.marginTop = -LY.total + "px";
    // Extra room so the horizontal scrollbar doesn't cover the bottom ruler.
    scrollEl.style.height = LY.total + SCROLLBAR_H + "px";
    drawGutter(LY.total);
    drawMinimap();
    drawMain();
  }

  updateZoomLabel();
  updateFlankLabel();
  requestAnimationFrame(resizeAll);
  const ro = new ResizeObserver(() => resizeAll());
  ro.observe(el);

  return () => ro.disconnect();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export default { render };
