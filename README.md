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
- **stacking of multiple pairwise alignments** that share a sequence (A–B and
  B–C → A, B, C shown together), merged on the shared sequence;
- **custom row names** via `name1=` / `name2=` / `names=[...]` (falling back to
  `SeqRecord` ids, else `seq1`, `seq2`, …);
- a **hover tooltip** reporting the exact base and position in each sequence
  for any column;
- a **minimap with one band per sequence** (blank where a sequence is absent,
  so you can see where each starts/ends), red for mismatches and grey for
  gaps/overhangs — click or drag to jump;
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
`seq1`, `seq2`, ….

### Stacking pairwise alignments through a shared sequence

If you have two (or more) pairwise alignments that share a sequence — say A
aligned to B and B aligned to C — `stack(...)` merges them on the shared
sequence and shows A, B and C together (the A–C alignment is not required):

```python
from alignment_viewer_widget import stack

ab = aligner.align(seq_a, seq_b)
bc = aligner.align(seq_b, seq_c)
stack([ab, bc], names=["A", "B", "C"])
```

Consecutive alignments must share a sequence (matched by identity). The
minimap shows one band per sequence, blank where that sequence isn't present,
so you can see where each one begins and ends.

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
