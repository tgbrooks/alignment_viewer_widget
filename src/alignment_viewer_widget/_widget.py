"""anywidget-based viewer for Biopython pairwise alignments."""

from __future__ import annotations

import pathlib
from typing import Any

import anywidget
import traitlets

_STATIC = pathlib.Path(__file__).parent / "static"

# Per-column kind codes (kept in sync with widget.js).
#   m = match, x = mismatch, g = gap, u = unaligned flank/overhang
_EMPTY = " "  # placeholder char for "no base in this row of this column"


def _as_alignment(alignment: Any):
    """Coerce the argument into a single ``Bio.Align.Alignment``.

    Accepts an ``Alignment`` directly, or the ``PairwiseAlignments`` iterator
    returned by ``aligner.align(...)`` (in which case the best/first alignment
    is used).
    """
    if hasattr(alignment, "coordinates") and hasattr(alignment, "indices"):
        return alignment
    try:
        return alignment[0]
    except (TypeError, KeyError, IndexError) as exc:  # pragma: no cover
        raise TypeError(
            "Expected a Bio.Align.Alignment or the result of "
            "aligner.align(...); got %r" % type(alignment)
        ) from exc


def _label_for(seq: Any, fallback: str) -> str:
    """Best-effort human label for a sequence (SeqRecord id, etc.)."""
    for attr in ("id", "name"):
        value = getattr(seq, attr, None)
        if value and value != "<unknown id>":
            return str(value)
    return fallback


def _full_seq(seq: Any) -> str:
    """Full underlying sequence string (handles SeqRecord -> Seq)."""
    return str(getattr(seq, "seq", seq))


def _extract(alignment: Any) -> dict[str, Any]:
    """Build the full renderable column model from a Biopython Alignment.

    The model spans the aligned region *and* the unaligned flanks ("overhangs")
    on either side, so the viewer can show the parts of each sequence that fall
    outside a local alignment. Columns are described by parallel arrays:

    ``seq_top`` / ``seq_bot``
        One character per column for each row (``-`` gap, space = no base).
    ``kinds``
        One code per column: ``m`` match, ``x`` mismatch, ``g`` gap,
        ``u`` unaligned flank.
    ``top_pos`` / ``bot_pos``
        Original 0-based sequence position for each column (``-1`` = none).
    ``aligned_start`` / ``aligned_end``
        Column range [start, end) covering the alignment proper (flanks lie
        before/after).
    """
    aln = _as_alignment(alignment)

    target_row = str(aln[0])
    query_row = str(aln[1])
    indices = aln.indices
    t_idx = [int(i) for i in indices[0]]
    q_idx = [int(i) for i in indices[1]]

    sequences = getattr(aln, "sequences", [None, None])
    full_t = _full_seq(sequences[0]) if sequences[0] is not None else target_row.replace("-", "")
    full_q = _full_seq(sequences[1]) if sequences[1] is not None else query_row.replace("-", "")

    t_used = [i for i in t_idx if i >= 0]
    q_used = [i for i in q_idx if i >= 0]
    t_lo, t_hi = (min(t_used), max(t_used)) if t_used else (0, -1)
    q_lo, q_hi = (min(q_used), max(q_used)) if q_used else (0, -1)

    # Flanking (unaligned) sequence on each side, in original coordinates.
    t_left, q_left = full_t[:t_lo], full_q[:q_lo]
    t_right, q_right = full_t[t_hi + 1 :], full_q[q_hi + 1 :]

    seq_top: list[str] = []
    seq_bot: list[str] = []
    kinds: list[str] = []
    top_pos: list[int] = []
    bot_pos: list[int] = []

    def add(tc: str, qc: str, tp: int, qp: int, kind: str) -> None:
        seq_top.append(tc)
        seq_bot.append(qc)
        top_pos.append(tp)
        bot_pos.append(qp)
        kinds.append(kind)

    # --- Left flank: right-aligned so it butts against the alignment ---------
    wl = max(len(t_left), len(q_left))
    for c in range(wl):
        ti = c - (wl - len(t_left))
        qi = c - (wl - len(q_left))
        tc = t_left[ti] if 0 <= ti < len(t_left) else _EMPTY
        qc = q_left[qi] if 0 <= qi < len(q_left) else _EMPTY
        add(tc, qc, ti if tc != _EMPTY else -1, qi if qc != _EMPTY else -1, "u")

    # --- Aligned region ------------------------------------------------------
    aligned_start = len(seq_top)
    for c in range(len(target_row)):
        tc, qc = target_row[c], query_row[c]
        if tc == "-" or qc == "-":
            kind = "g"
        elif tc.upper() == qc.upper():
            kind = "m"
        else:
            kind = "x"
        add(tc, qc, t_idx[c], q_idx[c], kind)
    aligned_end = len(seq_top)

    # --- Right flank: left-aligned -------------------------------------------
    wr = max(len(t_right), len(q_right))
    for c in range(wr):
        tc = t_right[c] if c < len(t_right) else _EMPTY
        qc = q_right[c] if c < len(q_right) else _EMPTY
        add(
            tc,
            qc,
            (t_hi + 1 + c) if tc != _EMPTY else -1,
            (q_hi + 1 + c) if qc != _EMPTY else -1,
            "u",
        )

    try:
        score = float(aln.score)
    except (AttributeError, TypeError):
        score = None

    return {
        "seq_top": "".join(seq_top),
        "seq_bot": "".join(seq_bot),
        "kinds": "".join(kinds),
        "top_pos": top_pos,
        "bot_pos": bot_pos,
        "aligned_start": aligned_start,
        "aligned_end": aligned_end,
        "total_top": len(full_t),
        "total_bot": len(full_q),
        "label_top": _label_for(sequences[0], "target"),
        "label_bottom": _label_for(sequences[1], "query"),
        "score": score,
    }


class AlignmentViewer(anywidget.AnyWidget):
    """Interactive, horizontally-scrolling viewer for a pairwise alignment.

    Parameters
    ----------
    alignment:
        A ``Bio.Align.Alignment`` (e.g. ``aligner.align(a, b)[0]``) or the
        ``PairwiseAlignments`` object returned by ``aligner.align(a, b)`` (the
        best alignment is shown).
    name1, name2:
        Optional display labels for the first (target) and second (query)
        sequences. Override any ids inferred from ``SeqRecord`` inputs.
    base_width:
        Pixel width allotted to each alignment column (zoom level).
    """

    _esm = _STATIC / "widget.js"
    _css = _STATIC / "widget.css"

    seq_top = traitlets.Unicode("").tag(sync=True)
    seq_bot = traitlets.Unicode("").tag(sync=True)
    kinds = traitlets.Unicode("").tag(sync=True)
    top_pos = traitlets.List(traitlets.Int()).tag(sync=True)
    bot_pos = traitlets.List(traitlets.Int()).tag(sync=True)
    aligned_start = traitlets.Int(0).tag(sync=True)
    aligned_end = traitlets.Int(0).tag(sync=True)
    total_top = traitlets.Int(0).tag(sync=True)
    total_bot = traitlets.Int(0).tag(sync=True)
    label_top = traitlets.Unicode("target").tag(sync=True)
    label_bottom = traitlets.Unicode("query").tag(sync=True)
    score = traitlets.Float(allow_none=True, default_value=None).tag(sync=True)

    base_width = traitlets.Int(11).tag(sync=True)

    def __init__(
        self,
        alignment: Any,
        *,
        name1: str | None = None,
        name2: str | None = None,
        base_width: int = 11,
        **kwargs: Any,
    ) -> None:
        data = _extract(alignment)
        if name1:
            data["label_top"] = str(name1)
        if name2:
            data["label_bottom"] = str(name2)
        data["base_width"] = base_width
        super().__init__(**data, **kwargs)


def view(alignment: Any, **kwargs: Any) -> AlignmentViewer:
    """Convenience constructor: ``view(aligner.align(a, b), name1=..., name2=...)``."""
    return AlignmentViewer(alignment, **kwargs)
