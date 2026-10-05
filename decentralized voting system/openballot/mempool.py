from typing import List, Optional
from openballot.ballot import Ballot


class Mempool:
    """
    In-memory transaction pool for unconfirmed ballots awaiting block inclusion.
    """
    def __init__(self):
        self._pool: List[Ballot] = []

    def add(self, ballot: Ballot) -> bool:
        self._pool.append(ballot)
        return True

    def drain(self, limit: Optional[int] = None) -> List[Ballot]:
        if limit is None or limit >= len(self._pool):
            items = self._pool[:]
            self._pool.clear()
            return items
        items = self._pool[:limit]
        self._pool = self._pool[limit:]
        return items

    def all(self) -> List[Ballot]:
        return list(self._pool)

    def size(self) -> int:
        return len(self._pool)

    def clear(self):
        self._pool.clear()
