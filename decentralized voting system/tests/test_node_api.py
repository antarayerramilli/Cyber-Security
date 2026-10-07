import json
import threading
import time
import urllib.request
import urllib.error
import pytest

from openballot.crypto import generate_keypair, public_key_to_hex, sign_message
from openballot.ballot import Ballot
from openballot.ledger import Ledger
from openballot.node import NodeServer, NodeHandler





def test_api_health(running_server):
    base_url, _ = running_server
    req = urllib.request.Request(f"{base_url}/health")
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode())
        assert data["status"] == "healthy"
        assert data["blocks"] >= 1
        assert "difficulty" in data


def test_api_elections(running_server):
    base_url, _ = running_server
    req = urllib.request.Request(f"{base_url}/api/v1/elections")
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode())
        assert "elections" in data
        assert len(data["elections"]) >= 2
        assert data["elections"][0]["proposal_id"] == "PROP-2026-01"


def test_api_ballot_submission_and_weight_validation(running_server):
    base_url, ledger = running_server
    priv, pub = generate_keypair()
    vid = public_key_to_hex(pub)
    ledger.register_voter(vid)

    # 1. Invalid weight should be rejected
    ballot_bad_weight = {
        "voter_id": vid,
        "proposal_id": "PROP-2026-01",
        "choice": "YES",
        "weight": 5,
        "signature": "1234"
    }
    req_bad = urllib.request.Request(
        f"{base_url}/api/v1/ballots",
        data=json.dumps(ballot_bad_weight).encode(),
        headers={"Content-Type": "application/json"}
    )
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(req_bad)
    assert exc_info.value.code == 400

    # 2. Valid ballot submission
    ballot = Ballot(vid, "PROP-2026-01", "YES", weight=1)
    ballot.signature = sign_message(priv, ballot.get_digest()).hex()

    req_good = urllib.request.Request(
        f"{base_url}/api/v1/ballots",
        data=json.dumps(ballot.to_dict()).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req_good) as resp:
        assert resp.status == 202
        res = json.loads(resp.read().decode())
        assert res["status"] == "accepted"
        assert "vote_id" in res

    # 3. Duplicate submission while in mempool should be rejected (409)
    req_dup = urllib.request.Request(
        f"{base_url}/api/v1/ballots",
        data=json.dumps(ballot.to_dict()).encode(),
        headers={"Content-Type": "application/json"}
    )
    with pytest.raises(urllib.error.HTTPError) as exc_dup:
        urllib.request.urlopen(req_dup)
    assert exc_dup.value.code == 409


def test_api_verify_ballot_and_chain(running_server):
    base_url, _ = running_server

    # Verify chain
    req_chain = urllib.request.Request(f"{base_url}/api/v1/verify-chain")
    with urllib.request.urlopen(req_chain) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode())
        assert data["valid"] is True
        assert len(data["blocks"]) >= 1

    # Verify audit log
    req_audit = urllib.request.Request(f"{base_url}/api/v1/audit-log")
    with urllib.request.urlopen(req_audit) as resp:
        assert resp.status == 200
        audit_data = json.loads(resp.read().decode())
        assert "events" in audit_data
        assert len(audit_data["events"]) > 0
