"""Tests for data extraction from Biopython alignments."""

from Bio.Align import PairwiseAligner
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord

from alignment_viewer_widget import AlignmentViewer, stack, view
from alignment_viewer_widget._widget import _extract_chain, _extract_single


def _local_aligner():
    aligner = PairwiseAligner()
    aligner.mode = "local"
    aligner.match_score = 2
    aligner.mismatch_score = -1
    aligner.open_gap_score = -2
    aligner.extend_gap_score = -0.5
    return aligner


def _strip(s):
    return s.replace("-", "").replace(" ", "")


# --- single pairwise -------------------------------------------------------


def test_single_model_shapes():
    aligner = _local_aligner()
    data = _extract_single(aligner.align("ACGTACGT", "ACGTTCGT")[0])
    assert len(data["seqs"]) == 2
    n = len(data["seqs"][0])
    assert all(len(s) == n for s in data["seqs"])
    assert len(data["relations"]) == 1
    assert len(data["relations"][0]) == n
    assert set(data["relations"][0]) <= set("mxg.")
    assert "x" in data["relations"][0]  # the single substitution


def test_single_flank_range():
    aligner = _local_aligner()
    target = "CCCCCGGGGG" + "ACGTACGTACGTACGT" + "TTTTTAAAAA"
    query = "GG" + "ACGTACGTAGGTACGT" + "AA"
    data = _extract_single(aligner.align(target, query)[0])
    assert data["aligned_start"] > 0
    assert data["aligned_end"] < len(data["seqs"][0])
    assert data["show_boundaries"] is True
    assert _strip(data["seqs"][0]) == target
    assert _strip(data["seqs"][1]) == query


def test_widget_constructs_single():
    aligner = _local_aligner()
    w = AlignmentViewer(aligner.align("ACGTACGTAC", "ACGTTCGTAC"), base_width=9)
    assert len(w.seqs) == 2
    assert w.base_width == 9
    assert len(w.positions[0]) == len(w.seqs[0])
    assert isinstance(view(aligner.align("AC", "AC")), AlignmentViewer)


def test_custom_names_single():
    aligner = _local_aligner()
    w = AlignmentViewer(aligner.align("ACGTACGT", "ACGTTCGT"), name1="Ref", name2="Read")
    assert w.labels == ["Ref", "Read"]


def test_seqrecord_labels():
    aligner = _local_aligner()
    a = SeqRecord(Seq("ACGTACGT"), id="chrA")
    b = SeqRecord(Seq("ACGTTCGT"), id="readB")
    data = _extract_single(aligner.align(a, b)[0])
    assert data["labels"] == ["chrA", "readB"]


# --- stacked chain ---------------------------------------------------------


def _chain():
    aligner = _local_aligner()
    import random

    rng = random.Random(0)
    b = "".join(rng.choice("ACGT") for _ in range(80))
    a = "TTTTT" + b[10:60] + "GGG"
    c = b[30:80] + "CCCCC"
    return aligner, a, b, c


def test_chain_reconstructs_all_rows():
    aligner, a, b, c = _chain()
    data = _extract_chain([aligner.align(a, b), aligner.align(b, c)])
    assert len(data["seqs"]) == 3
    n = len(data["seqs"][0])
    assert all(len(s) == n for s in data["seqs"])
    assert len(data["relations"]) == 2
    assert _strip(data["seqs"][0]) == a
    assert _strip(data["seqs"][1]) == b
    assert _strip(data["seqs"][2]) == c
    # A-C are never directly related (only adjacent pairs carry relations).
    assert data["show_boundaries"] is False


def test_chain_labels_unique_default():
    aligner, a, b, c = _chain()
    data = _extract_chain([aligner.align(a, b), aligner.align(b, c)])
    assert data["labels"] == ["seq1", "seq2", "seq3"]


def test_stack_helper_and_names():
    aligner, a, b, c = _chain()
    w = stack([aligner.align(a, b), aligner.align(b, c)], names=["A", "B", "C"])
    assert len(w.seqs) == 3
    assert w.labels == ["A", "B", "C"]
    assert len(w.relations) == 2


def test_chain_requires_shared_sequence():
    aligner = _local_aligner()
    import pytest

    # Both alignments are valid, but the second shares no sequence with the first.
    with pytest.raises(ValueError):
        _extract_chain(
            [aligner.align("ACGTACGT", "ACGTTCGT"), aligner.align("GGGGCCCC", "GGGGACCC")]
        )
