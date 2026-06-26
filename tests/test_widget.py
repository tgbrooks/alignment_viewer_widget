"""Tests for data extraction from Biopython alignments."""

from Bio.Align import PairwiseAligner
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord

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


def test_extract_parallel_arrays_consistent():
    aligner = _local_aligner()
    seq1 = "TTGCCACGTAGGCTTAGCATCGGGATCGATCGATCGTAGCTAGCATCGATCG"
    seq2 = "AAAGCCACGTAGGCTTAGGATCGGGATCGATCGTAGCTAGCATCGATCGTTT"
    data = _extract(aligner.align(seq1, seq2))

    n = len(data["seq_top"])
    assert len(data["seq_bot"]) == n
    assert len(data["kinds"]) == n
    assert len(data["top_pos"]) == n
    assert len(data["bot_pos"]) == n
    assert set(data["kinds"]) <= set("mxgu")
    assert 0 <= data["aligned_start"] <= data["aligned_end"] <= n


def test_kinds_classify_aligned_region():
    aligner = _local_aligner()
    data = _extract(aligner.align("ACGTACGT", "ACGTTCGT")[0])
    s, e = data["aligned_start"], data["aligned_end"]
    aligned_kinds = data["kinds"][s:e]
    assert "x" in aligned_kinds  # the single substitution
    assert aligned_kinds.count("m") == 7


def test_flanks_present_for_local_overhang():
    aligner = _local_aligner()
    # Alignment sits in the middle of the target, with overhangs both sides.
    target = "CCCCCGGGGG" + "ACGTACGTACGTACGT" + "TTTTTAAAAA"
    query = "GG" + "ACGTACGTAGGTACGT" + "AA"
    data = _extract(aligner.align(target, query)[0])

    # There are unaligned flank columns, and the aligned region is interior.
    assert "u" in data["kinds"]
    assert data["aligned_start"] > 0
    assert data["aligned_end"] < len(data["seq_top"])
    # Totals reflect the full sequences.
    assert data["total_top"] == len(target)
    assert data["total_bot"] == len(query)
    # Flank columns carry real positions for whichever row has a base.
    s = data["aligned_start"]
    assert any(
        data["top_pos"][i] >= 0 or data["bot_pos"][i] >= 0 for i in range(s)
    )


def test_no_flanks_when_alignment_spans_sequences():
    aligner = _local_aligner()
    data = _extract(aligner.align("ACGTACGT", "ACGTACGT")[0])
    assert data["aligned_start"] == 0
    assert data["aligned_end"] == len(data["seq_top"])
    assert "u" not in data["kinds"]


def test_widget_constructs_and_syncs_traits():
    aligner = _local_aligner()
    alns = aligner.align("ACGTACGTAC", "ACGTTCGTAC")
    w = AlignmentViewer(alns, base_width=9)
    assert w.seq_top and w.seq_bot
    assert w.base_width == 9
    assert len(w.top_pos) == len(w.seq_top)
    assert isinstance(view(alns), AlignmentViewer)


def test_custom_names_override_defaults():
    aligner = _local_aligner()
    alns = aligner.align("ACGTACGT", "ACGTTCGT")
    w = AlignmentViewer(alns, name1="Reference", name2="Read 1")
    assert w.label_top == "Reference"
    assert w.label_bottom == "Read 1"


def test_seqrecord_labels_used_when_no_override():
    aligner = _local_aligner()
    a = SeqRecord(Seq("ACGTACGT"), id="chrA")
    b = SeqRecord(Seq("ACGTTCGT"), id="readB")
    data = _extract(aligner.align(a, b)[0])
    assert data["label_top"] == "chrA"
    assert data["label_bottom"] == "readB"
    # Full sequences are recovered from the SeqRecords (not the str summary).
    assert data["total_top"] == 8


def test_explicit_name_beats_seqrecord_id():
    aligner = _local_aligner()
    a = SeqRecord(Seq("ACGTACGT"), id="chrA")
    b = SeqRecord(Seq("ACGTTCGT"), id="readB")
    w = AlignmentViewer(aligner.align(a, b), name1="Custom")
    assert w.label_top == "Custom"
    assert w.label_bottom == "readB"
