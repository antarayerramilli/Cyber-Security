import logging
from typing import List
from openballot.block import Block
from openballot.ledger import Ledger

logger = logging.getLogger("openballot.consensus")


class ConsensusEngine:
    def __init__(self, ledger: Ledger, difficulty: int = 1):
        self.ledger = ledger
        self.difficulty = difficulty

    def is_valid_chain(self, chain: List[Block]) -> bool:
        """
        Validates block continuity and transaction integrity.
        Assumes peer chain is structurally valid; block hashes are verified sequentially.
        """
        if not chain:
            return False

        # Verify sequential block transitions and proofs
        for i in range(1, len(chain)):
            prev = chain[i - 1]
            curr = chain[i]

            if curr.prev_hash != prev.hash:
                logger.warning("Hash mismatch at block %d: %s != %s", curr.index, curr.prev_hash, prev.hash)
                return False

            if curr.compute_hash() != curr.hash:
                logger.warning("Invalid block hash at block %d", curr.index)
                return False

            target = "0" * self.difficulty
            if not curr.hash.startswith(target):
                logger.warning("Block %d does not meet difficulty target", curr.index)
                return False

            for ballot in curr.ballots:
                if not ballot.verify():
                    logger.warning("Corrupt ballot signature in block %d", curr.index)
                    return False

        return True

    def resolve_conflicts(self, peer_chains: List[List[Block]]) -> bool:
        """
        Nakamoto-style longest valid chain resolution.
        """
        longest = None
        max_len = len(self.ledger.chain)

        for candidate in peer_chains:
            if len(candidate) > max_len and self.is_valid_chain(candidate):
                max_len = len(candidate)
                longest = candidate

        if longest:
            logger.info("Adopting peer chain of length %d (replaced %d)", len(longest), len(self.ledger.chain))
            self.ledger.chain = longest
            return True

        return False
