import marimo

__generated_with = "0.9.0"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    from Bio.Align import PairwiseAligner
    from alignment_viewer_widget import AlignmentViewer
    return AlignmentViewer, PairwiseAligner, mo


@app.cell
def _(mo):
    mo.md(
        """
        # Alignment Viewer Widget

        An interactive viewer for Biopython `PairwiseAligner` alignments.

        - Scroll horizontally through the whole alignment on one line.
        - Hover any column for the exact base **and position** in each sequence.
        - Mismatches (red) and gaps (grey) are highlighted; the minimap shows
          where they occur — click it to jump.
        - Use `+ / −` to zoom (down to an overview heatmap for long alignments)
          and `◀ diff / diff ▶` to hop between differences.
        """
    )
    return


@app.cell
def _(PairwiseAligner):
    aligner = PairwiseAligner()
    aligner.mode = "local"
    aligner.match_score = 2
    aligner.mismatch_score = -1
    aligner.open_gap_score = -2
    aligner.extend_gap_score = -0.5
    return (aligner,)


@app.cell
def _(mo):
    mo.md("""## A short alignment""")
    return


@app.cell
def _(AlignmentViewer, aligner):
    seq_a = "TTGCCACGTAGGCTTAGCATCGGGATCGATCGATCGTAGCTAGCATCGATCG"
    seq_b = "AAAGCCACGTAGGCTTAGGATCGGGATCGATCGTAGCTAGCATCGATCGTTT"
    AlignmentViewer(aligner.align(seq_a, seq_b))
    return seq_a, seq_b


@app.cell
def _(mo):
    mo.md(
        """
        ## A ~1 kb local alignment

        Two ~1 kb sequences with scattered substitutions and a couple of indels.
        Zoom out with `−` to get the overview heatmap, then click the minimap or
        use `diff ▶` to land on each difference.
        """
    )
    return


@app.cell
def _(random):
    def mutate(seq, n_subs=25, n_indels=6, seed=0):
        rng = random.Random(seed)
        bases = "ACGT"
        s = list(seq)
        for _ in range(n_subs):
            i = rng.randrange(len(s))
            s[i] = rng.choice([b for b in bases if b != s[i]])
        for _ in range(n_indels):
            i = rng.randrange(len(s))
            if rng.random() < 0.5:
                del s[i]
            else:
                s.insert(i, rng.choice(bases))
        return "".join(s)
    return (mutate,)


@app.cell
def _():
    import random
    return (random,)


@app.cell
def _(AlignmentViewer, aligner, mutate, random):
    _rng = random.Random(42)
    ref = "".join(_rng.choice("ACGT") for _ in range(1000))
    read = mutate(ref, n_subs=30, n_indels=8, seed=7)
    AlignmentViewer(aligner.align(ref, read), base_width=10)
    return read, ref


@app.cell
def _(mo):
    mo.md(
        """
        ## Reactive use

        Wrap the widget with `mo.ui.anywidget(...)` to plug it into marimo's
        reactive graph.
        """
    )
    return


@app.cell
def _(AlignmentViewer, aligner, mo, ref, read):
    viewer = mo.ui.anywidget(AlignmentViewer(aligner.align(ref, read), base_width=10))
    viewer
    return (viewer,)


if __name__ == "__main__":
    app.run()
