"""Thread-safe span buffer with periodic flush.

Flush is triggered by whichever comes first:

1. The periodic timer (``flush_interval_ms``, default 500 ms).
2. The queue reaching ``max_batch_size`` spans (default 100).

Flush errors are caught and logged — they never propagate to callers.
The background thread is a daemon thread so it does not prevent the
interpreter from exiting.
"""

from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .transport import Transport

logger = logging.getLogger(__name__)

_DEFAULT_FLUSH_INTERVAL_MS = 500
_DEFAULT_MAX_BATCH_SIZE = 100


class Buffer:
    """In-memory queue that accumulates finished spans and flushes them
    to the transport in batches.

    Args:
        transport: :class:`~agentlens.transport.Transport` instance used
            to ship batches.
        flush_interval_ms: Timer interval in milliseconds.
        max_batch_size: Flush immediately when the queue reaches this size.
    """

    def __init__(
        self,
        transport: "Transport",
        flush_interval_ms: int = _DEFAULT_FLUSH_INTERVAL_MS,
        max_batch_size: int = _DEFAULT_MAX_BATCH_SIZE,
    ) -> None:
        self._transport = transport
        self._flush_interval_s = flush_interval_ms / 1000.0
        self._max_batch_size = max_batch_size

        self._queue: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._timer_thread: threading.Thread | None = None

    # ── Lifecycle ───────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the periodic background flush thread.

        Idempotent — subsequent calls are no-ops.
        """
        if self._timer_thread is not None:
            return
        self._stop_event.clear()
        self._timer_thread = threading.Thread(
            target=self._timer_loop, daemon=True, name="agentlens-buffer"
        )
        self._timer_thread.start()

    def shutdown(self) -> None:
        """Stop the timer thread and perform a final synchronous flush."""
        self._stop_event.set()
        if self._timer_thread is not None:
            self._timer_thread.join(timeout=5.0)
            self._timer_thread = None
        self._flush_sync()

    # ── Public methods ──────────────────────────────────────────────────────

    def push(self, span_data: dict[str, Any]) -> None:
        """Enqueue a finished span.  Thread-safe.

        Triggers an immediate flush if the queue has reached
        ``max_batch_size``.
        """
        with self._lock:
            self._queue.append(span_data)
            should_flush = len(self._queue) >= self._max_batch_size

        if should_flush:
            self._flush_sync()

    def flush(self) -> None:
        """Drain the queue and send all pending spans.

        Safe to call from any thread at any time (e.g. graceful shutdown).
        """
        self._flush_sync()

    # ── Private helpers ─────────────────────────────────────────────────────

    def _timer_loop(self) -> None:
        while not self._stop_event.wait(timeout=self._flush_interval_s):
            self._flush_sync()

    def _flush_sync(self) -> None:
        with self._lock:
            if not self._queue:
                return
            batch = self._queue[:]
            self._queue.clear()

        try:
            self._transport.send(batch)
        except Exception:
            logger.exception("[AgentLens] Flush failed — %d spans dropped", len(batch))
