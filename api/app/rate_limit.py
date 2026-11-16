"""In-memory request limit per client address, to protect the Gemini quota.

One process serves the site, so memory is enough; the counts reset on restart.
"""

import math
import time
from collections import deque
from collections.abc import Callable
from threading import Lock

from fastapi import Request


class RateLimiter:
    def __init__(
        self,
        limit: int,
        window_seconds: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.limit = limit
        self.window = window_seconds
        self.clock = clock
        self._used: dict[str, deque[float]] = {}
        self._lock = Lock()

    def reset(self) -> None:
        with self._lock:
            self._used.clear()

    def take(self, key: str, units: int = 1) -> int | None:
        """Use `units` of the key's allowance. Returns None, or the seconds to wait."""
        if self.limit <= 0:
            return None

        now = self.clock()
        with self._lock:
            self._forget_before(now - self.window)
            used = self._used.setdefault(key, deque())

            if len(used) + units > self.limit:
                oldest = used[0] if used else now
                return max(1, math.ceil(oldest + self.window - now))

            used.extend([now] * units)
            return None

    def _forget_before(self, cutoff: float) -> None:
        for key in list(self._used):
            used = self._used[key]
            while used and used[0] <= cutoff:
                used.popleft()
            if not used:
                del self._used[key]


def client_address(request: Request) -> str:
    """The caller's address. Behind Render's proxy the real one is the last forwarded entry;
    earlier entries come from the caller and can be forged."""
    forwarded = request.headers.get("x-forwarded-for", "")
    entries = [entry.strip() for entry in forwarded.split(",") if entry.strip()]
    if entries:
        return entries[-1]
    return request.client.host if request.client else "unknown"
