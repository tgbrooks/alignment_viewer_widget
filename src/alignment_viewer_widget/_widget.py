"""anywidget-based viewer for Biopython pairwise alignments."""

from __future__ import annotations

import pathlib
from typing import Any

import anywidget
import traitlets

_STATIC = pathlib.Path(__file__).parent / "static"


def _as_alignment(alignment: Any):
    """Coerce the argument into a single ``Bio.Align.Alignment``.

    Accepts an ``Alignment`` directly, or the ``PairwiseAlignments`` iterator
    returned by ``aligner.align(...)`` (in which case the best/first alignment
    is used).
    """
    # A single Alignment exposes ``coordinates``.
    if hasattr(alignment, "coordinates") and hasattr(alignment, "indices"):
        return alignment
    # ``aligner.align(...)`` returns an indexable iterator of alignments.
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


def _extract(alignment: Any) -> dict[str, Any]:
    """Pull the renderable data out of a Biopython Alignment."""
    aln = _as_alignment(alignment)

    # Gapped, aligned rows (one character per alignment column).
    target_row = str(aln[0])
    query_row = str(aln[1])

    # ``indices`` maps each column to the original sequence position, with -1
    # for gaps. This is correct even for reverse-strand query alignments.
    indices = aln.indices
    target_indices = [int(i) for i in indices[0]]
    query_indices = [int(i) for i in indices[1]]

    try:
        score = float(aln.score)
    except (AttributeError, TypeError):
        score = None

    sequences = getattr(aln, "sequences", [None, None])
    target_label = _label_for(sequences[0], "target")
    query_label = _label_for(sequences[1], "query")

    return {
        "target_row": target_row,
        "query_row": query_row,
        "target_indices": target_indices,
        "query_indices": query_indices,
        "target_label": target_label,
        "query_label": query_label,
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
    height:
        Pixel height of the sequence panel.
    base_width:
        Pixel width allotted to each alignment column (zoom level).
    """

    _esm = _STATIC / "widget.js"
    _css = _STATIC / "widget.css"

    target_row = traitlets.Unicode("").tag(sync=True)
    query_row = traitlets.Unicode("").tag(sync=True)
    target_indices = traitlets.List(traitlets.Int()).tag(sync=True)
    query_indices = traitlets.List(traitlets.Int()).tag(sync=True)
    target_label = traitlets.Unicode("target").tag(sync=True)
    query_label = traitlets.Unicode("query").tag(sync=True)
    score = traitlets.Float(allow_none=True, default_value=None).tag(sync=True)

    base_width = traitlets.Int(11).tag(sync=True)
    panel_height = traitlets.Int(140).tag(sync=True)

    def __init__(
        self,
        alignment: Any,
        *,
        base_width: int = 11,
        height: int = 140,
        **kwargs: Any,
    ) -> None:
        data = _extract(alignment)
        data["base_width"] = base_width
        data["panel_height"] = height
        super().__init__(**data, **kwargs)


def view(alignment: Any, **kwargs: Any) -> AlignmentViewer:
    """Convenience constructor: ``view(aligner.align(a, b))``."""
    return AlignmentViewer(alignment, **kwargs)
