"""Tests for the reframed social bucket — see ADR 0013.

The critical invariants:

1. Mention spikes and top-WSB rank pull the score NEGATIVE (fade the crowd)
2. StockTwits bullish ratio is directional, but volume-damped
3. Heavy herding damps the directional component toward zero but does not invert it
4. Calm-mega-cap inputs produce roughly the same score as the prior implementation
   (we didn't want to break the common case while fixing the meme case)
"""
from pipeline.fetchers.types import SocialSnapshot
from pipeline.processors.aggregator import social_score


def _snap(**kwargs) -> SocialSnapshot:
    defaults = dict(
        reddit_mention_count=None,
        reddit_mention_delta=None,
        apewisdom_rank=None,
        stocktwits_bullish=None,
        stocktwits_messages=None,
        google_trend_score=None,
    )
    defaults.update(kwargs)
    return SocialSnapshot(**defaults)


def test_none_input_returns_none():
    score, components = social_score(None)
    assert score is None
    assert components == {}


def test_quiet_megacap_keeps_directional_signal():
    # MSFT-style: no spike, no WSB attention, moderately bullish discussion
    # at low volume → should produce a small positive directional score.
    score, comp = social_score(
        _snap(
            reddit_mention_delta=0,
            stocktwits_bullish=60.0,
            stocktwits_messages=200,
        )
    )
    assert score is not None
    # bullish_signal = +0.1, volume_weight = 1.0, no herding → score = +0.1
    assert score == 0.1
    assert comp["herding_intensity"] == 0.0
    assert comp["herding_damping"] == 1.0


def test_meme_ticker_flips_sign_vs_old_implementation():
    # GME-style viral spike: under the OLD code this would have scored
    # near +1.0 (mention delta + WSB rank + bullish ratio all positive).
    # Under the new code, herding pulls it strongly negative.
    score, comp = social_score(
        _snap(
            reddit_mention_delta=800,   # extreme spike
            apewisdom_rank=2,           # top of WSB
            stocktwits_bullish=75.0,
            stocktwits_messages=5000,   # viral volume
        )
    )
    assert score is not None
    assert score < -0.5, f"meme ticker should be strongly negative, got {score}"
    assert comp["herding_intensity"] == 1.0
    # StockTwits contribution is damped but not inverted — score is dominated
    # by the herding penalty (-0.4 + -0.3 = -0.7), plus a small dampened
    # bullish residual.
    assert comp["herding_damping"] == round(1.0 - 0.7 * 1.0, 2)  # 0.3


def test_informed_signal_at_low_volume_carries_full_directional_weight():
    # Bullish chatter on a low-volume name — no herding triggers.
    # Should produce a positive score driven entirely by StockTwits.
    score, comp = social_score(
        _snap(
            stocktwits_bullish=70.0,
            stocktwits_messages=80,
        )
    )
    assert score is not None
    # bullish_signal = +0.20, volume_weight = 1.0, no herding damping
    assert abs(score - 0.20) < 0.001
    assert comp["herding_intensity"] == 0.0


def test_moderate_herding_damps_directional_signal():
    # Mid-tier WSB rank + bullish chatter — directional gets damped but
    # the herding penalty is small. Final score should be modestly
    # negative (-0.2 from reddit) plus a damped positive.
    score, comp = social_score(
        _snap(
            reddit_mention_delta=250,   # moderate spike → -0.2 penalty, intensity 0.6
            apewisdom_rank=15,           # rank 11-25 → intensity 0.4 (subsumed by 0.6)
            stocktwits_bullish=65.0,
            stocktwits_messages=1200,
        )
    )
    assert score is not None
    # Expected: -0.2 + (0.15 * 0.7 * (1 - 0.7*0.6)) = -0.2 + 0.061 ≈ -0.14
    assert -0.20 < score < -0.05
    assert comp["herding_intensity"] == 0.6


def test_crowd_losing_interest_is_slight_tailwind():
    # Reddit delta strongly negative → modest positive contribution
    # (the crowd giving up on the name is mildly bullish for
    # fundamentals-driven holders).
    score, comp = social_score(
        _snap(
            reddit_mention_delta=-80,
            stocktwits_bullish=50.0,
            stocktwits_messages=100,
        )
    )
    assert score is not None
    assert score > 0
    assert comp["reddit_delta_pct"] == -80


def test_score_is_clamped_to_negative_one():
    # Defensive: extreme herding shouldn't push score below -1.
    score, _ = social_score(
        _snap(
            reddit_mention_delta=999,
            apewisdom_rank=1,
            stocktwits_bullish=10.0,    # also bearish — adds to the penalty
            stocktwits_messages=10000,
        )
    )
    assert score is not None
    assert score >= -1.0
