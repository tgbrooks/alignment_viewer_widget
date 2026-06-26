import marimo

__generated_with = "0.9.0"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    from Bio.Align import PairwiseAligner
    from alignment_viewer_widget import AlignmentViewer, stack
    return AlignmentViewer, PairwiseAligner, mo, stack


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
        - For local alignments, the unaligned **flanks/overhangs** on either
          side are shown greyed (toggle with the `Flanks` button); a dashed
          marker shows where the alignment begins/ends.
        - **Stack multiple pairwise alignments** that share a sequence (A–B and
          B–C) with `stack([...])` to see A, B, C together. The minimap has one
          band per sequence — blank where a sequence is absent — so you can see
          where each one starts and ends.
        - Name the rows with `name1=` / `name2=` / `names=[...]` (or they
          default to the `SeqRecord` ids, else `seq1`, `seq2`, …).
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
    AlignmentViewer(aligner.align(seq_a, seq_b), name1="reference", name2="sample")
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
        ## Local alignment with overhangs

        Here a ~500 bp region is embedded in longer sequences with
        non-homologous flanks. The aligned core is shown in colour between two
        greyed overhangs; the dashed markers show where the local alignment
        starts and ends. Toggle the flanks off with the `Flanks` button to focus
        on just the aligned region.
        """
    )
    return


@app.cell
def _(AlignmentViewer, aligner, random):
    _rng = random.Random(3)
    _core = "".join(_rng.choice("ACGT") for _ in range(500))
    _core_mut = list(_core)
    for _ in range(15):
        _j = _rng.randrange(len(_core_mut))
        _core_mut[_j] = _rng.choice([b for b in "ACGT" if b != _core_mut[_j]])
    _core_mut = "".join(_core_mut)

    def _flank(n):
        return "".join(_rng.choice("ACGT") for _ in range(n))

    ref_genome = _flank(300) + _core + _flank(700)        # 1500 bp
    sample_read = _flank(40) + _core_mut + _flank(60)      # ~600 bp
    AlignmentViewer(
        aligner.align(ref_genome, sample_read),
        name1="chr1",
        name2="read_001",
        base_width=10,
    )
    return ref_genome, sample_read


@app.cell
def _(mo):
    mo.md(
        """
        ## Stacking multiple pairwise alignments

        If you have A aligned to B and B aligned to C, `stack([...])` merges
        them on the shared sequence B and shows all three rows at once (the
        A–C alignment is not needed). Each sequence gets its own minimap band,
        blank where that sequence isn't present — so you can see, for example,
        that `readC` only covers the right portion of the reference.
        """
    )
    return


@app.cell
def _(aligner, random, stack):
    _rng = random.Random(11)
    ref_B = "".join(_rng.choice("ACGT") for _ in range(700))

    def _mut(seq, n):
        s = list(seq)
        for _ in range(n):
            j = _rng.randrange(len(s))
            s[j] = _rng.choice([b for b in "ACGT" if b != s[j]])
        return "".join(s)

    def _flank(n):
        return "".join(_rng.choice("ACGT") for _ in range(n))

    read_A = _flank(80) + _mut(ref_B[50:450], 12) + _flank(40)
    read_C = _flank(30) + _mut(ref_B[250:700], 14) + _flank(90)

    stack(
        [aligner.align(read_A, ref_B), aligner.align(ref_B, read_C)],
        names=["readA", "refB", "readC"],
        base_width=10,
    )
    return read_A, read_C, ref_B


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
