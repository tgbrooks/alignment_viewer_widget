# alignment_viewer_widget

An interactive widget for viewing **Biopython** pairwise alignments
(`Bio.Align.PairwiseAligner`) in **marimo** and Jupyter notebooks.

Biopython's default alignment printing wraps long alignments across many
blocks and makes it hard to read off the exact base position of a mismatch.
This widget instead shows the alignment as a **single, horizontally-scrolling
strip** with:

- a **position ruler** in original-sequence coordinates (1-based) for both
  sequences;
- **mismatch / gap highlighting** so differences pop out at a glance;
- the unaligned **flanks / overhangs** of a local alignment shown greyed on
  either side (with dashed markers at the alignment boundaries), toggleable
  with the `Flanks` button;
- **custom row names** via `name1=` / `name2=` (falling back to `SeqRecord`
  ids);
- a **hover tooltip** reporting the exact base and position in each sequence
  for any column;
- a **minimap** showing where mismatches (red) and gaps/overhangs (grey) occur
  across the whole alignment — click or drag to jump;
- **zoom** from per-base glyphs down to an overview "heatmap" for kilobase
  alignments, plus **next/previous-difference** navigation and a
  **go-to-position** box;
- a **virtualized canvas renderer**, so multi-kilobase alignments stay
  responsive (only the visible columns are drawn).

## Install

```bash
pip install -e .
# or, once published:
# pip install alignment-viewer-widget
```

Dependencies: `anywidget`, `biopython`. For notebooks, install `marimo` (or
Jupyter).

## Usage

```python
from Bio.Align import PairwiseAligner
from alignment_viewer_widget import AlignmentViewer

aligner = PairwiseAligner()
aligner.mode = "local"
aligner.match_score = 2
aligner.mismatch_score = -1
aligner.open_gap_score = -2
aligner.extend_gap_score = -0.5

alignments = aligner.align(seq1, seq2)

AlignmentViewer(alignments)          # shows the best (first) alignment
# or pick a specific one:
AlignmentViewer(alignments[0])
```

In **marimo**, returning the widget from a cell renders it. To wire it into
marimo's reactive state, wrap it with `mo.ui.anywidget`:

```python
import marimo as mo
viewer = mo.ui.anywidget(AlignmentViewer(alignments))
viewer
```

In **Jupyter**, just make the widget the last expression in a cell.

### Options

```python
AlignmentViewer(
    alignments,
    name1="reference",   # label for the first (target) sequence
    name2="read_001",    # label for the second (query) sequence
    base_width=11,       # pixels per alignment column (zoom level)
)
```

You can pass either the `PairwiseAlignments` object returned by
`aligner.align(...)` (the best alignment is shown) or an individual
`Bio.Align.Alignment`. Row labels come from `name1` / `name2` if given,
otherwise from the inputs' `SeqRecord` ids, otherwise default to
"target" / "query".

## Example notebook

A runnable marimo notebook lives in [`examples/demo.py`](examples/demo.py):

```bash
marimo edit examples/demo.py
```

## Development

```bash
pip install -e ".[dev]"
pytest
```

The frontend is a single ES module (`src/alignment_viewer_widget/static/widget.js`)
loaded by [anywidget](https://anywidget.dev); no build step is required.

## License

MIT
