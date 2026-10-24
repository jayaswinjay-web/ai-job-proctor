"""Tiered autonomy policy engine for the voice agent.

Tiers (prompt section 6):
  0 Read-only        (search, lookup, calculate)  -> act freely
  1 Reversible       (draft, schedule, update)    -> act, then inform
  2 External/costly (send email, place order)    -> act within preset limits; else one-line confirm
  3 Irreversible    (payments, deletion)         -> always confirm; always log

Enforcement is deterministic code; the LLM never decides alone.
"""
