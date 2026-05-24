"""Network-layer auto-instrumentation for LLM HTTP calls.

Patches ``httpx`` and (optionally) ``requests`` so every outbound call to a
recognised LLM provider endpoint emits a span automatically — no SDK-level
patcher per provider, no decorator required by the caller.

Enabled by default when :func:`agentlens.AgentLens.init` runs. Set the
environment variable ``AGENTLENS_DISABLE_AUTO_INSTRUMENTATION=1`` to skip.
"""

from __future__ import annotations

import os

_enabled = False


def enable_auto_instrumentation() -> None:
    """Patch ``httpx`` and ``requests`` to auto-trace LLM calls.

    Safe to call multiple times — each underlying patcher is idempotent.
    No-op if ``AGENTLENS_DISABLE_AUTO_INSTRUMENTATION`` is truthy.
    """
    global _enabled
    if _enabled:
        return
    if os.environ.get("AGENTLENS_DISABLE_AUTO_INSTRUMENTATION"):
        return

    # httpx is a required dep of agentlens so this import always succeeds.
    from .httpx_patch import patch_httpx

    patch_httpx()

    # requests is an optional extra. Skip silently if not installed.
    try:
        from .requests_patch import patch_requests

        patch_requests()
    except ImportError:
        pass

    _enabled = True
