from openballot.crypto import generate_keypair, public_key_to_hex, sign_message
from openballot.ballot import Ballot
from openballot.block import Block
from openballot.ledger import Ledger


def test_genesis_block():
    ledger = Ledger()
    genesis = ledger.create_genesis_block()
    assert genesis.index == 0
    assert len(ledger.chain) == 1
    assert ledger.latest_block.index == 0


def test_ledger_tally():
    ledger = Ledger()
    ledger.create_genesis_block()

    priv1, pub1 = generate_keypair()
    priv2, pub2 = generate_keypair()

    b1 = Ballot(public_key_to_hex(pub1), "PROP-A", "YES")
    b1.signature = sign_message(priv1, b1.get_digest()).hex()

    b2 = Ballot(public_key_to_hex(pub2), "PROP-A", "NO")
    b2.signature = sign_message(priv2, b2.get_digest()).hex()

    block1 = Block(index=1, prev_hash=ledger.latest_block.hash, ballots=[b1, b2])
    block1.mine(difficulty=1)
    ledger.chain.append(block1)

    tally = ledger.tally("PROP-A")
    assert tally.get("YES") == 1
    assert tally.get("NO") == 1
    assert ledger.has_voted("PROP-A", public_key_to_hex(pub1)) is True
    assert ledger.has_voted("PROP-A", "non-existent-voter") is False
