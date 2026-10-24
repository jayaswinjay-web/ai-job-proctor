"""Tool registry and JSON schemas for the voice agent.

Every tool is callable via constrained decoding. Input is treated as untrusted
data and can never trigger Tier 2-3 actions by itself (prompt-injection defense).
"""
