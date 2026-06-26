"""anywidget-based viewer for Biopython pairwise alignments.

Supports a single pairwise alignment (two rows) as well as a *chain* of
pairwise alignments that share sequences (e.g. A-B and B-C), which are merged
on the shared sequence and stacked so A, B and C are shown together.
"""

from __future__ import annotations

import pathlib
from typing import Any

import anywidget
import traitlets

_STATIC = pathlib.Path(__file__).parent / "static"

_GAP = "-"
_EMPTY = " "


def _as_alignment(alignment: Any):
    """Coerce into a single ``Bio.Align.Alignment``."""
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
    for attr in ("id", "name"):
        value = getattr(seq, attr, None)
        if value and value != "<unknown id>":
            return str(value)
    return fallback


def _full_seq(seq: Any) -> str:
    return str(getattr(seq, "seq", seq))


def _relation(ca: str, cb: str) -> str:
    """Relation between two aligned-region characters."""
    if ca == _GAP or cb == _GAP:
        return "g"
    return "m" if ca.upper() == cb.upper() else "x"


def _pair_columns(aln: Any) -> dict[str, Any]:
    """Column model for one pairwise alignment, including unaligned flanks.

    Returns columns as a list of ``[(char, pos), (char, pos)]`` (two rows) plus
    the per-column relation, labels, full-sequence strings, totals, the
    aligned column range and the score.
    """
    aln = _as_alignment(aln)
    target_row = str(aln[0])
    query_row = str(aln[1])
    idx = aln.indices
    t_idx = [int(i) for i in idx[0]]
    q_idx = [int(i) for i in idx[1]]

    seqs = getattr(aln, "sequences", [None, None])
    full_t = _full_seq(seqs[0]) if seqs[0] is not None else target_row.replace(_GAP, "")
    full_q = _full_seq(seqs[1]) if seqs[1] is not None else query_row.replace(_GAP, "")

    t_used = [i for i in t_idx if i >= 0]
    q_used = [i for i in q_idx if i >= 0]
    t_lo, t_hi = (min(t_used), max(t_used)) if t_used else (0, -1)
    q_lo, q_hi = (min(q_used), max(q_used)) if q_used else (0, -1)

    t_left, q_left = full_t[:t_lo], full_q[:q_lo]
    t_right, q_right = full_t[t_hi + 1 :], full_q[q_hi + 1 :]

    cols: list[list[tuple[str, int]]] = []
    rels: list[str] = []

    def flank_cell(s: str, i: int):
        ok = 0 <= i < len(s)
        return (s[i], i) if ok else (_EMPTY, -1)

    # Left flank, right-aligned against the alignment.
    wl = max(len(t_left), len(q_left))
    for c in range(wl):
        ti = c - (wl - len(t_left))
        qi = c - (wl - len(q_left))
        cols.append([flank_cell(t_left, ti), flank_cell(q_left, qi)])
        rels.append(".")

    aligned_start = len(cols)
    for c in range(len(target_row)):
        tc, qc = target_row[c], query_row[c]
        cols.append([(tc, t_idx[c]), (qc, q_idx[c])])
        rels.append(_relation(tc, qc))
    aligned_end = len(cols)

    # Right flank, left-aligned.
    wr = max(len(t_right), len(q_right))
    for c in range(wr):
        tc, tp = (t_right[c], t_hi + 1 + c) if c < len(t_right) else (_EMPTY, -1)
        qc, qp = (q_right[c], q_hi + 1 + c) if c < len(q_right) else (_EMPTY, -1)
        cols.append([(tc, tp), (qc, qp)])
        rels.append(".")

    try:
        score = float(aln.score)
    except (AttributeError, TypeError):
        score = None

    return {
        "cols": cols,
        "rels": rels,
        "labels": [_label_for(seqs[0], ""), _label_for(seqs[1], "")],
        "fulls": [full_t, full_q],
        "totals": [len(full_t), len(full_q)],
        "aligned_range": (aligned_start, aligned_end),
        "score": score,
    }


def _anchor_present(cell: tuple[str, int]) -> bool:
    return cell[0] != _EMPTY and cell[0] != _GAP


def _merge(p_cols, p_rels, pa, q_cols, q_rels, qa, qn):
    """Merge profile columns with a pairwise alignment on a shared sequence.

    ``pa`` is the anchor row index within the profile; ``qa`` / ``qn`` are the
    anchor / new row indices within the pairwise alignment. Both anchor rows
    contain the *complete* shared sequence, so columns are merged by anchor
    residue index.
    """
    nrows_p = len(p_cols[0])
    empty = (_EMPTY, -1)

    def collect(cols, rels, i, anchor):
        """Run of columns with no anchor residue (insertions/flanks)."""
        run = []
        while i < len(cols) and not _anchor_present(cols[i][anchor]):
            run.append((cols[i], rels[i]))
            i += 1
        return run, i

    def combine(prun, qrun, leading):
        """Overlay a P run and a Q run into shared columns.

        Leading runs (before the first shared residue) are right-aligned so the
        overhangs butt against the alignment start; all other runs are
        left-aligned so they butt against the preceding residue / sequence end.
        This keeps the trailing overhangs of both partners in the *same* columns
        instead of one after the other.
        """
        width = max(len(prun), len(qrun))
        oc: list = []
        orl: list = []
        for k in range(width):
            pi = k - (width - len(prun)) if leading else k
            qi = k - (width - len(qrun)) if leading else k
            pv = 0 <= pi < len(prun)
            qv = 0 <= qi < len(qrun)
            if pv:
                cells = list(prun[pi][0])
                rl = list(prun[pi][1])
            else:
                cells = [empty] * nrows_p
                rl = ["."] * (nrows_p - 1)
            if not pv and qv:
                cells[pa] = qrun[qi][0][qa]  # keep anchor gap/empty consistent
            if qv:
                cnew, crel = qrun[qi][0][qn], qrun[qi][1]
            else:
                cnew, crel = empty, "."
            oc.append(cells + [cnew])
            orl.append(rl + [crel])
        return oc, orl

    out_cols: list = []
    out_rels: list = []
    p = q = 0
    seen_anchor = False

    while p < len(p_cols) or q < len(q_cols):
        prun, p = collect(p_cols, p_rels, p, pa)
        qrun, q = collect(q_cols, q_rels, q, qa)
        cc, rr = combine(prun, qrun, leading=not seen_anchor)
        out_cols += cc
        out_rels += rr

        if p < len(p_cols) and q < len(q_cols):
            bp, bq = p_cols[p][pa][1], q_cols[q][qa][1]
            if bp == bq:
                out_cols.append(list(p_cols[p]) + [q_cols[q][qn]])
                out_rels.append(list(p_rels[p]) + [q_rels[q]])
                p += 1
                q += 1
            elif bp < bq:
                out_cols.append(list(p_cols[p]) + [empty])
                out_rels.append(list(p_rels[p]) + ["."])
                p += 1
            else:
                col = [empty] * nrows_p
                col[pa] = q_cols[q][qa]
                out_cols.append(col + [q_cols[q][qn]])
                out_rels.append(["."] * (nrows_p - 1) + [q_rels[q]])
                q += 1
            seen_anchor = True
        elif p < len(p_cols):
            out_cols.append(list(p_cols[p]) + [empty])
            out_rels.append(list(p_rels[p]) + ["."])
            p += 1
            seen_anchor = True
        elif q < len(q_cols):
            col = [empty] * nrows_p
            col[pa] = q_cols[q][qa]
            out_cols.append(col + [q_cols[q][qn]])
            out_rels.append(["."] * (nrows_p - 1) + [q_rels[q]])
            q += 1
            seen_anchor = True

    return out_cols, out_rels


def _finalize_labels(labels: list) -> list:
    """Give every row a unique, non-empty label (default ``seqN``)."""
    out: list[str] = []
    seen: set[str] = set()
    for i, lab in enumerate(labels):
        name = lab or f"seq{i + 1}"
        if name in seen:
            name = f"{name} ({i + 1})"
        seen.add(name)
        out.append(name)
    return out


def _model_from_columns(cols, rels, labels, totals, scores, aligned_range):
    """Turn the merged column model into the trait payload."""
    nrows = len(cols[0]) if cols else 0
    ncols = len(cols)
    seqs = ["".join(cols[c][r][0] for c in range(ncols)) for r in range(nrows)]
    positions = [[cols[c][r][1] for c in range(ncols)] for r in range(nrows)]
    relations = ["".join(rels[c][a] for c in range(ncols)) for a in range(nrows - 1)]
    return {
        "seqs": seqs,
        "positions": positions,
        "relations": relations,
        "labels": _finalize_labels(labels),
        "totals": list(totals),
        "scores": list(scores),
        "aligned_start": aligned_range[0],
        "aligned_end": aligned_range[1],
        "show_boundaries": nrows == 2,
    }


def _extract_single(alignment: Any) -> dict[str, Any]:
    pc = _pair_columns(alignment)
    return _model_from_columns(
        pc["cols"], [[r] for r in pc["rels"]], pc["labels"], pc["totals"],
        [pc["score"]], pc["aligned_range"],
    )


def _extract_chain(alignments: list) -> dict[str, Any]:
    parts = [_pair_columns(a) for a in alignments]
    first = parts[0]
    cols = first["cols"]
    rels = [[r] for r in first["rels"]]
    labels = list(first["labels"])
    fulls = list(first["fulls"])
    totals = list(first["totals"])
    scores = [first["score"]]

    for part in parts[1:]:
        f2 = part["fulls"]
        candidates = [i for i, f in enumerate(fulls) if f in f2]
        if not candidates:
            raise ValueError(
                "Consecutive alignments must share a sequence to be stacked; "
                "no shared sequence found between rows %r and %r"
                % (labels, part["labels"])
            )
        pa = candidates[-1]  # most recently added shared row
        anchor = fulls[pa]
        qa = f2.index(anchor)
        qn = 1 - qa
        cols, rels = _merge(cols, rels, pa, part["cols"], part["rels"], qa, qn)
        labels.append(part["labels"][qn])
        fulls.append(f2[qn])
        totals.append(part["totals"][qn])
        scores.append(part["score"])

    return _model_from_columns(cols, rels, labels, totals, scores, (0, 0))


class AlignmentViewer(anywidget.AnyWidget):
    """Interactive, horizontally-scrolling viewer for pairwise alignment(s).

    Parameters
    ----------
    alignment:
        A single ``Bio.Align.Alignment`` / ``PairwiseAlignments`` (two rows),
        **or** a list of pairwise alignments that share sequences in a chain
        (e.g. ``[align_AB, align_BC]``); these are merged on the shared
        sequence and stacked so A, B and C are shown together.
    name1, name2:
        Optional labels for the two rows of a single alignment.
    names:
        Optional list of labels for every row (length = number of sequences).
        Overrides inferred / ``name1``/``name2`` labels.
    base_width:
        Pixel width allotted to each alignment column (zoom level).
    """

    _esm = _STATIC / "widget.js"
    _css = _STATIC / "widget.css"

    seqs = traitlets.List(traitlets.Unicode()).tag(sync=True)
    positions = traitlets.List(traitlets.List(traitlets.Int())).tag(sync=True)
    relations = traitlets.List(traitlets.Unicode()).tag(sync=True)
    labels = traitlets.List(traitlets.Unicode()).tag(sync=True)
    totals = traitlets.List(traitlets.Int()).tag(sync=True)
    scores = traitlets.List(traitlets.Float(allow_none=True)).tag(sync=True)
    aligned_start = traitlets.Int(0).tag(sync=True)
    aligned_end = traitlets.Int(0).tag(sync=True)
    show_boundaries = traitlets.Bool(True).tag(sync=True)

    base_width = traitlets.Int(11).tag(sync=True)

    def __init__(
        self,
        alignment: Any,
        *,
        name1: str | None = None,
        name2: str | None = None,
        names: list | None = None,
        base_width: int = 11,
        **kwargs: Any,
    ) -> None:
        if isinstance(alignment, (list, tuple)):
            data = _extract_chain(list(alignment))
        else:
            data = _extract_single(alignment)

        if name1:
            data["labels"][0] = str(name1)
        if name2 and len(data["labels"]) > 1:
            data["labels"][1] = str(name2)
        if names:
            for i, nm in enumerate(names):
                if i < len(data["labels"]) and nm:
                    data["labels"][i] = str(nm)

        data["base_width"] = base_width
        super().__init__(**data, **kwargs)


def view(alignment: Any, **kwargs: Any) -> AlignmentViewer:
    """Convenience constructor; see :class:`AlignmentViewer`."""
    return AlignmentViewer(alignment, **kwargs)


def stack(alignments: list, **kwargs: Any) -> AlignmentViewer:
    """Stack a chain of pairwise alignments that share sequences.

    Example: ``stack([aligner.align(A, B), aligner.align(B, C)])``.
    """
    return AlignmentViewer(list(alignments), **kwargs)
