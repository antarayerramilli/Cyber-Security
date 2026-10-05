from openballot.block import Block
from openballot.ledger import Ledger
from openballot.consensus import ConsensusEngine


def test_chain_validation_valid():
    ledger = Ledger()
    ledger.create_genesis_block()
    engine = ConsensusEngine(ledger=ledger, difficulty=1)

    b1 = Block(index=1, prev_hash=ledger.chain[0].hash, ballots=[])
    b1.mine(difficulty=1)
    ledger.chain.append(b1)

    assert engine.is_valid_chain(ledger.chain) is True


def test_chain_validation_broken_link():
    ledger = Ledger()
    ledger.create_genesis_block()
    engine = ConsensusEngine(ledger=ledger, difficulty=1)

    b1 = Block(index=1, prev_hash="bad_previous_hash" + "0" * 47, ballots=[])
    b1.mine(difficulty=1)
    ledger.chain.append(b1)

    assert engine.is_valid_chain(ledger.chain) is False


def test_conflict_resolution_honest_fork():
    ledger_a = Ledger()
    ledger_a.create_genesis_block()
    engine_a = ConsensusEngine(ledger=ledger_a, difficulty=1)

    # Node B builds 2 blocks from the same genesis
    ledger_b = Ledger()
    genesis_b = Block.from_dict(ledger_a.chain[0].to_dict())
    ledger_b.chain = [genesis_b]

    b1 = Block(index=1, prev_hash=genesis_b.hash, ballots=[])
    b1.mine(difficulty=1)
    ledger_b.chain.append(b1)

    b2 = Block(index=2, prev_hash=b1.hash, ballots=[])
    b2.mine(difficulty=1)
    ledger_b.chain.append(b2)

    # Node A syncs with Node B's longer chain
    result = engine_a.resolve_conflicts([ledger_b.chain])
    assert result is True
    assert len(ledger_a.chain) == 3
