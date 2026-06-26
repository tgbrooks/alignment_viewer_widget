"""Tests for data extraction from Biopython alignments."""

from Bio.Align import PairwiseAligner

from alignment_viewer_widget import AlignmentViewer, view
from alignment_viewer_widget._widget import _extract


def _local_aligner():
    aligner = PairwiseAligner()
    aligner.mode = "local"
    aligner.match_score = 2
    aligner.mismatch_score = -1
    aligner.open_gap_score = -2
    aligner.extend_gap_score = -0.5
    return aligner


def test_extract_from_alignments_object():
    aligner = _local_aligner()
    seq1 = "TTGCCACGTAGGCTTAGCATCGGGATCGATCGATCGTAGCTAGCATCGATCG"
    seq2 = "AAAGCCACGTAGGCTTAGGATCGGGATCGATCGTAGCTAGCATCGATCGTTT"
    alns = aligner.align(seq1, seq2)

    # Accepts the PairwiseAlignments iterator directly.
    data = _extract(alns)
    assert len(data["target_row"]) == len(data["query_row"])
    assert len(data["target_indices"]) == len(data["target_row"])
    assert len(data["query_indices"]) == len(data["query_row"])
    # Gap columns are marked -1 in the indices.
    assert any(i == -1 for i in data["query_indices"])
    assert data["score"] is not None


def test_extract_matches_aligned_rows():
    aligner = _local_aligner()
    aln = aligner.align("ACGTACGT", "ACGTTCGT")[0]
    data = _extract(aln)
    assert data["target_row"] == str(aln[0])
    assert data["query_row"] == str(aln[1])


def test_indices_track_original_positions():
    aligner = _local_aligner()
    aln = aligner.align("ACGTACGT", "ACGTACGT")[0]
    data = _extract(aln)
    # Perfect match: every column maps to an increasing original position.
    non_gap = [i for i in data["target_indices"] if i >= 0]
    assert non_gap == sorted(non_gap)


def test_widget_constructs_and_syncs_traits():
    aligner = _local_aligner()
    alns = aligner.align("ACGTACGTAC", "ACGTTCGTAC")
    w = AlignmentViewer(alns, base_width=9, height=160)
    assert w.target_row and w.query_row
    assert w.base_width == 9
    assert w.panel_height == 160
    assert len(w.target_indices) == len(w.target_row)

    w2 = view(alns)
    assert isinstance(w2, AlignmentViewer)


def test_seqrecord_labels():
    from Bio.Seq import Seq
    from Bio.SeqRecord import SeqRecord

    aligner = _local_aligner()
    a = SeqRecord(Seq("ACGTACGT"), id="chrA")
    b = SeqRecord(Seq("ACGTTCGT"), id="readB")
    data = _extract(aligner.align(a, b)[0])
    assert data["target_label"] == "chrA"
    assert data["query_label"] == "readB"
