// Interactive viewer for one or more stacked pairwise alignments.
//
// The sequence panel is drawn on a <canvas> and *virtualized*: only the columns
// scrolled into view are painted, so multi-kilobase alignments stay responsive.
// It renders R sequence rows with connector rows between adjacent pairs, a left
// gutter of labels, a per-row minimap (one band per sequence, blank where a
// sequence is absent), and a tooltip with exact base positions.

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
  mmMini: "#e5484d",
  matchMini: "#cfe8d4",
  greyMini: "#b0b6bd",
};

const GLYPH_MIN_WIDTH = 7;
const SCROLLBAR_H = 16;

function render({ model, el }) {
  const seqs = model.get("seqs");
  const positions = model.get("positions");
  const relations = model.get("relations");
  const labels = model.get("labels");
  const totals = model.get("totals");
  const scores = model.get("scores") || [];
  const alignedStart = model.get("aligned_start");
  const alignedEnd = model.get("aligned_end");
  const showBoundaries = model.get("show_boundaries");
  const R = seqs.length;
  const L = R ? seqs[0].length : 0;

  let baseWidth = model.get("base_width") || 11;

  // --- Per-cell classification --------------------------------------------
  // 'e' empty, 'g' gap, 'x' mismatch, 'a' aligned match, 'u' unaligned flank
  function classify(r, c) {
    const ch = seqs[r][c];
    if (ch === " ") return "e";
    if (ch === "-") return "g";
    let mism = false,
      aligned = false;
    if (r > 0) {
      const rr = relations[r - 1][c];
      if (rr === "x") mism = true;
      if (rr !== ".") aligned = true;
    }
    if (r < R - 1) {
      const rr = relations[r][c];
      if (rr === "x") mism = true;
      if (rr !== ".") aligned = true;
    }
    if (mism) return "x";
    if (aligned) return "a";
    return "u";
  }
  const isDiffCol = (c) => {
    for (let a = 0; a < R - 1; a++) {
      const rr = relations[a][c];
      if (rr === "x" || rr === "g") return true;
    }
    return false;
  };

  const hasFlanks =
    showBoundaries && (alignedStart > 0 || alignedEnd < L);
  let showFlanks = true;

  // --- Stats ---------------------------------------------------------------
  const pairStats = [];
  for (let a = 0; a < R - 1; a++) {
    let m = 0,
      x = 0,
      g = 0;
    for (let c = 0; c < L; c++) {
      const rr = relations[a][c];
      if (rr === "m") m++;
      else if (rr === "x") x++;
      else if (rr === "g") g++;
    }
    const denom = m + x + g;
    pairStats.push({ m, x, g, identity: denom ? m / denom : 0 });
  }
  function rowRange(r) {
    let mn = Infinity,
      mx = -Infinity;
    for (let c = 0; c < L; c++) {
      const k = classify(r, c);
      if (k !== "a" && k !== "x") continue;
      const p = positions[r][c];
      if (p < 0) continue;
      if (p < mn) mn = p;
      if (p > mx) mx = p;
    }
    return mn === Infinity ? null : [mn, mx];
  }

  // --- DOM scaffold --------------------------------------------------------
  el.classList.add("avw");
  el.innerHTML = `
    <div class="avw-header">
      <div class="avw-title">${R > 2 ? "Stacked alignment" : "Pairwise alignment"}</div>
      <div class="avw-stats"></div>
    </div>
    <div class="avw-toolbar">
      <button class="avw-btn" data-act="zoomout" title="Zoom out">−</button>
      <button class="avw-btn" data-act="zoomin" title="Zoom in">+</button>
      <button class="avw-btn" data-act="prev" title="Previous mismatch / gap">◀ diff</button>
      <button class="avw-btn" data-act="next" title="Next mismatch / gap">diff ▶</button>
      <button class="avw-btn avw-flank-btn" data-act="flanks" title="Toggle unaligned flanks"></button>
      <label class="avw-goto">Go to ${escapeHtml(labels[0])} pos
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
  const pairHtml = pairStats
    .map(
      (s, a) =>
        `<span><b>${(s.identity * 100).toFixed(1)}%</b> ${escapeHtml(labels[a])}↔${escapeHtml(
          labels[a + 1]
        )}</span>` +
        `<span class="avw-chip avw-chip-mm">${s.x}</span>` +
        `<span class="avw-chip avw-chip-gap">${s.g}</span>`
    )
    .join("");
  const rangeHtml = labels
    .map((lab, r) => {
      const rr = rowRange(r);
      const txt = rr === null ? "—" : `${rr[0] + 1}–${rr[1] + 1}/${totals[r]}`;
      return `<span class="avw-range">${escapeHtml(lab)}: ${txt}</span>`;
    })
    .join("");
  statsEl.innerHTML = pairHtml + rangeHtml;

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

  const viewStart = () => (showFlanks ? 0 : alignedStart);
  const viewEnd = () => (showFlanks ? L : alignedEnd);
  const viewLen = () => viewEnd() - viewStart();

  // --- Row layout ----------------------------------------------------------
  const GUTTER_W = 86;
  const rulerH = 18;
  const seqRowH = 22;
  const connH = 14;
  const rowY = [];
  const connY = [];
  let yy = rulerH;
  for (let r = 0; r < R; r++) {
    rowY.push(yy);
    yy += seqRowH;
    if (r < R - 1) {
      connY.push(yy);
      yy += connH;
    }
  }
  const bottomRulerY = yy;
  yy += rulerH;
  const TOTAL_H = yy;
  const bandTop = rowY[0];
  const bandBot = rowY[R - 1] + seqRowH;
  const fontPx = () => Math.min(15, Math.max(9, baseWidth + 2));

  let hoverCol = -1;

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

  function drawGutter() {
    const ctx = fitCanvas(gutter, GUTTER_W, TOTAL_H);
    ctx.clearRect(0, 0, GUTTER_W, TOTAL_H);
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    const tx = GUTTER_W - 8;
    ctx.fillStyle = COLORS.ruler;
    ctx.fillText("pos", tx, rowY[0] - rulerH / 2);
    ctx.fillStyle = "#24292f";
    for (let r = 0; r < R; r++) ctx.fillText(trunc(labels[r]), tx, rowY[r] + seqRowH / 2);
    ctx.fillStyle = COLORS.ruler;
    ctx.fillText("pos", tx, bottomRulerY + rulerH / 2);
  }
  function trunc(s) {
    return s.length > 12 ? s.slice(0, 11) + "…" : s;
  }

  function rulerStep() {
    const minPx = 56;
    const minCols = Math.ceil(minPx / baseWidth);
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 50000];
    for (const n of nice) if (n >= minCols) return n;
    return nice[nice.length - 1];
  }

  // --- Main panel ----------------------------------------------------------
  function drawMain() {
    const cssW = scrollEl.clientWidth;
    const ctx = fitCanvas(main, cssW, TOTAL_H);
    ctx.clearRect(0, 0, cssW, TOTAL_H);

    const r0 = viewStart();
    const N = viewLen();
    const scrollLeft = scrollEl.scrollLeft;
    const firstS = Math.max(0, Math.floor(scrollLeft / baseWidth));
    const lastS = Math.min(N - 1, Math.ceil((scrollLeft + cssW) / baseWidth));
    const glyphs = baseWidth >= GLYPH_MIN_WIDTH;
    const step = rulerStep();

    ctx.font = `${fontPx()}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    for (let s = firstS; s <= lastS; s++) {
      const c = r0 + s;
      const x = s * baseWidth - scrollLeft;
      const cx = x + baseWidth / 2;

      for (let r = 0; r < R; r++) {
        const k = classify(r, c);
        const yMid = rowY[r] + seqRowH / 2;
        const bg = k === "x" ? COLORS.mismatchBg : k === "g" ? COLORS.gapBg : k === "u" ? COLORS.flankBg : null;
        if (bg) {
          ctx.fillStyle = bg;
          ctx.fillRect(x, rowY[r], baseWidth, seqRowH);
        }
        const ch = seqs[r][c];
        if (glyphs) {
          if (ch !== " ") {
            ctx.fillStyle = glyphColor(k);
            ctx.fillText(ch, cx, yMid);
          }
        } else if (k !== "e" && k !== "g") {
          ctx.fillStyle = cellFill(k);
          ctx.fillRect(x + 0.5, rowY[r] + 2, baseWidth - 1, seqRowH - 4);
        }
      }

      // Connectors between adjacent rows.
      if (glyphs) {
        for (let a = 0; a < R - 1; a++) {
          const rr = relations[a][c];
          if (rr === "m") {
            ctx.fillStyle = COLORS.matchBar;
            ctx.fillText("|", cx, connY[a] + connH / 2);
          } else if (rr === "x") {
            ctx.fillStyle = COLORS.mismatchText;
            ctx.fillText("·", cx, connY[a] + connH / 2);
          }
        }
      }

      tick(ctx, positions[0][c], step, rowY[0], -1, cx);
      tick(ctx, positions[R - 1][c], step, bottomRulerY, +1, cx);
    }

    if (showFlanks && hasFlanks) {
      boundary(ctx, alignedStart - r0, scrollLeft);
      boundary(ctx, alignedEnd - r0, scrollLeft);
    }

    const hs = hoverCol - r0;
    if (hs >= firstS && hs <= lastS) {
      const x = hs * baseWidth - scrollLeft;
      ctx.strokeStyle = COLORS.hover;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, bandTop - 1, baseWidth - 1, bandBot - bandTop + 2);
    }

    drawMinimapViewport(firstS, lastS);
  }

  function boundary(ctx, s, scrollLeft) {
    const x = s * baseWidth - scrollLeft;
    ctx.strokeStyle = COLORS.boundary;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, bandTop);
    ctx.lineTo(x, bandBot);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draws a ruler tick + label at the baseline `baseY`. dir < 0 puts it above
  // the baseline (top ruler), dir > 0 below it (bottom ruler).
  function tick(ctx, p, step, baseY, dir, cx) {
    if (p < 0 || (p + 1) % step !== 0) return;
    ctx.save();
    ctx.strokeStyle = COLORS.rulerTick;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, dir < 0 ? baseY - 5 : baseY);
    ctx.lineTo(cx, dir < 0 ? baseY : baseY + 5);
    ctx.stroke();
    ctx.fillStyle = COLORS.ruler;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = dir < 0 ? "bottom" : "top";
    ctx.textAlign = "center";
    ctx.fillText(String(p + 1), cx, dir < 0 ? baseY - 6 : baseY + 6);
    ctx.restore();
  }

  function glyphColor(k) {
    if (k === "u") return COLORS.flankText;
    if (k === "g") return COLORS.gapText;
    if (k === "x") return COLORS.mismatchText;
    return COLORS.matchText;
  }
  function cellFill(k) {
    if (k === "u") return COLORS.greyMini;
    if (k === "x") return COLORS.mmMini;
    return "#9fd3a8";
  }

  // --- Minimap (one band per sequence) ------------------------------------
  let minimapW = 0;
  const bandH = 9;
  const minimapH = 4 + R * bandH;
  function drawMinimap() {
    minimapW = el.clientWidth - 4;
    if (minimapW <= 0) return;
    const ctx = fitCanvas(minimap, minimapW, minimapH);
    ctx.clearRect(0, 0, minimapW, minimapH);
    ctx.fillStyle = "#fbfcfd";
    ctx.fillRect(0, 0, minimapW, minimapH);
    const r0 = viewStart();
    const N = viewLen();
    for (let px = 0; px < minimapW; px++) {
      const c0 = r0 + Math.floor((px / minimapW) * N);
      const c1 = r0 + Math.max(1, Math.floor(((px + 1) / minimapW) * N));
      for (let r = 0; r < R; r++) {
        let col = null; // priority: mismatch > match > grey
        for (let c = c0; c < c1 && c < r0 + N; c++) {
          const k = classify(r, c);
          if (k === "x") {
            col = COLORS.mmMini;
            break;
          }
          if (k === "a") col = col === COLORS.greyMini || col === null ? COLORS.matchMini : col;
          else if (k === "g" || k === "u") col = col === null ? COLORS.greyMini : col;
        }
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(px, 2 + r * bandH, 1, bandH - 1);
      }
    }
    // Row separators.
    ctx.strokeStyle = "#e6e9ec";
    for (let r = 1; r < R; r++) {
      ctx.beginPath();
      ctx.moveTo(0, 2 + r * bandH + 0.5);
      ctx.lineTo(minimapW, 2 + r * bandH + 0.5);
      ctx.stroke();
    }
  }
  function drawMinimapViewport(firstS, lastS) {
    if (minimapW <= 0) return;
    const ctx = minimap.getContext("2d");
    drawMinimap();
    const N = viewLen();
    const x0 = (firstS / N) * minimapW;
    const x1 = (Math.min(lastS + 1, N) / N) * minimapW;
    ctx.fillStyle = "rgba(9,105,218,0.12)";
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
    let rows = "";
    for (let r = 0; r < R; r++) {
      const ch = seqs[r][col];
      const p = positions[r][col];
      const body =
        ch === " " ? "<i>—</i>" : ch === "-" ? "<i>gap</i>" : `<code>${ch}</code> @ <b>${p + 1}</b>`;
      rows += `<div><span class="avw-tt-key">${escapeHtml(labels[r])}</span> ${body}</div>`;
    }
    tooltip.innerHTML = `<div class="avw-tt-head">column ${col + 1} / ${L}</div>${rows}`;
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

  gotoInput.addEventListener("change", () => {
    const pos = parseInt(gotoInput.value, 10);
    if (!Number.isFinite(pos)) return;
    const want = pos - 1;
    let best = -1,
      bestD = Infinity;
    for (let i = viewStart(); i < viewEnd(); i++) {
      if (positions[0][i] < 0) continue;
      const d = Math.abs(positions[0][i] - want);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      if (d === 0) break;
    }
    if (best >= 0) centerOnColumn(best);
  });

  function jumpDiff(dir) {
    let i = centerDataCol() + dir;
    while (i >= viewStart() && i < viewEnd()) {
      if (isDiffCol(i)) {
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

  function resizeAll() {
    spacer.style.width = viewLen() * baseWidth + "px";
    spacer.style.height = TOTAL_H + "px";
    main.style.marginTop = -TOTAL_H + "px";
    scrollEl.style.height = TOTAL_H + SCROLLBAR_H + "px";
    drawGutter();
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
