"""Tests for the labeled-output parser in summarizer.py."""
from pipeline.processors.summarizer import _parse_labeled_output, _trim


def test_parses_clean_three_field_output():
    raw = (
        "TLDR: NVDA earnings beat by 12%.\n"
        "SUMMARY: NVIDIA reported Q3 revenue of $35B, exceeding the $33B consensus. "
        "Datacenter remained the growth engine. Forward guidance was raised.\n"
        "INFLUENCE: Bullish — beat plus raised guidance argues for continued upside."
    )
    parsed = _parse_labeled_output(raw)
    assert parsed["tldr"].startswith("NVDA earnings beat")
    assert "datacenter" in parsed["summary"].lower()
    assert parsed["influence"].startswith("Bullish")


def test_handles_mixed_case_labels():
    raw = "tldr: a thing happened\nSummary: more detail\nINFLUENCE: Neutral — no signal"
    parsed = _parse_labeled_output(raw)
    assert parsed["tldr"] == "a thing happened"
    assert parsed["summary"] == "more detail"
    assert parsed["influence"] == "Neutral — no signal"


def test_strips_quotes_and_trailing_punctuation():
    raw = 'TLDR: "Something happened."'
    parsed = _parse_labeled_output(raw)
    assert parsed["tldr"] == "Something happened"


def test_skips_unrecognized_lines():
    raw = (
        "Here is the analysis:\n"
        "TLDR: ok\n"
        "Some other commentary that should be ignored.\n"
        "INFLUENCE: Bullish — really good"
    )
    parsed = _parse_labeled_output(raw)
    assert set(parsed.keys()) == {"tldr", "influence"}


def test_empty_input_returns_empty_dict():
    assert _parse_labeled_output("") == {}


def test_trim_short_string_unchanged():
    assert _trim("hello", 100) == "hello"


def test_trim_long_string_at_word_boundary():
    result = _trim("the quick brown fox jumps over", 16)
    assert result.endswith("…")
    assert len(result) <= 16
    assert " " not in result[-3:-1]  # no broken word at the cut
