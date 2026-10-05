import json
import logging
import mimetypes
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from typing import Optional, List, Dict, Any

from openballot.ballot import Ballot
from openballot.block import Block
from openballot.ledger import Ledger
from openballot.mempool import Mempool
from openballot.consensus import ConsensusEngine
from openballot.crypto import (
    generate_keypair,
    public_key_to_hex,
    private_key_to_hex,
    private_key_from_hex,
    sign_message
)

logger = logging.getLogger("openballot.node")
WEB_DIR = Path(__file__).parent / "web"


class NodeServer(HTTPServer):
    allow_reuse_address = True

    def __init__(self, server_address, RequestHandlerClass, ledger: Ledger, difficulty: int = 1):
        super().__init__(server_address, RequestHandlerClass)
        self.ledger = ledger
        self.mempool = Mempool()
        self.consensus = ConsensusEngine(ledger=self.ledger, difficulty=difficulty)
        self.difficulty = difficulty
        self.peers: List[str] = []
        if not self.ledger.chain:
            self.ledger.create_genesis_block()


class NodeHandler(BaseHTTPRequestHandler):
    @property
    def node(self) -> NodeServer:
        return self.server

    def _send_json(self, data: Any, status: int = 200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, filepath: Path, content_type: str = "text/html"):
        try:
            with open(filepath, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self._send_json({"error": f"Failed to read file: {e}"}, 500)

    def _read_json(self) -> Optional[Dict[str, Any]]:
        try:
            content_len = int(self.headers.get("Content-Length", 0))
            if content_len == 0:
                return {}
            raw = self.rfile.read(content_len).decode("utf-8")
            return json.loads(raw)
        except Exception:
            return None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/health":
            reg_count = len(self.node.ledger.voter_registry)
            proposals = self.node.ledger.get_proposals()
            return self._send_json({
                "status": "healthy",
                "blocks": len(self.node.ledger.chain),
                "mempool": self.node.mempool.size(),
                "peers": len(self.node.peers),
                "difficulty": self.node.difficulty,
                "registered_voters": reg_count,
                "proposals": proposals,
                "latest_block_hash": self.node.ledger.latest_block.hash
            })

        elif path == "/api/v1/chain":
            chain_data = [b.to_dict() for b in self.node.ledger.chain]
            return self._send_json({"length": len(chain_data), "chain": chain_data})

        elif path == "/api/v1/mempool":
            ballots_data = [b.to_dict() for b in self.node.mempool.all()]
            return self._send_json({"count": len(ballots_data), "ballots": ballots_data})

        elif path == "/api/v1/proposals":
            proposals_set = set(self.node.ledger.get_proposals())
            for b in self.node.mempool.all():
                if b.proposal_id:
                    proposals_set.add(b.proposal_id)

            if not proposals_set:
                proposals_set = {"PROP-2026-01", "PROP-2026-02"}

            res = []
            for pid in sorted(proposals_set):
                tally = self.node.ledger.tally(pid)
                total_votes = sum(tally.values())
                res.append({
                    "proposal_id": pid,
                    "tally": tally,
                    "total_votes": total_votes
                })
            return self._send_json({"proposals": res})

        elif path == "/api/v1/tally":
            qs = parse_qs(parsed.query)
            proposal = qs.get("proposal", [""])[0]
            if not proposal:
                return self._send_json({"error": "Missing proposal query parameter"}, 400)
            tally = self.node.ledger.tally(proposal)
            return self._send_json({"proposal": proposal, "results": tally})

        elif path == "/api/v1/peers":
            return self._send_json({"peers": self.node.peers})

        # Static web application routes
        if path in ("/", "/index.html"):
            index_path = WEB_DIR / "index.html"
            if index_path.is_file():
                return self._serve_file(index_path, "text/html; charset=utf-8")

        # Static files in web directory
        rel_path = path.lstrip("/")
        candidate_file = WEB_DIR / rel_path
        if candidate_file.is_file():
            try:
                candidate_file.resolve().relative_to(WEB_DIR.resolve())
                mime_type, _ = mimetypes.guess_type(str(candidate_file))
                return self._serve_file(candidate_file, mime_type or "application/octet-stream")
            except ValueError:
                pass

        return self._send_json({"error": "Endpoint not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        data = self._read_json()

        if data is None:
            return self._send_json({"error": "Invalid JSON payload"}, 400)

        if path == "/api/v1/ballots":
            ballot = Ballot.from_dict(data)

            if not ballot.voter_id or not ballot.proposal_id or not ballot.choice:
                return self._send_json({"error": "Missing required ballot fields"}, 400)

            # 1. Verify digital signature
            if not ballot.verify():
                return self._send_json({"error": "Cryptographic signature verification failed"}, 401)

            # 2. Verify voter registration (case-insensitive whitelist)
            if not self.node.ledger.is_registered(ballot.voter_id):
                return self._send_json({"error": "Voter ID not in authorized voter registry"}, 403)

            # 3. Check if voter already cast ballot on confirmed ledger
            if self.node.ledger.has_voted(ballot.proposal_id, ballot.voter_id):
                return self._send_json({"error": "Voter has already cast a ballot for this proposal"}, 409)

            # 4. Check if voter already has a ballot pending in mempool
            if self.node.mempool.has_ballot(ballot.proposal_id, ballot.voter_id):
                return self._send_json({"error": "Voter already has a pending ballot in mempool for this proposal"}, 409)

            # Ingest ballot into mempool
            if not self.node.mempool.add(ballot):
                return self._send_json({"error": "Duplicate ballot in mempool"}, 409)
            return self._send_json({"status": "accepted", "proposal": ballot.proposal_id}, 202)

        elif path == "/api/v1/mine":
            pending = self.node.mempool.drain()
            # Filter and validate pending ballots
            valid_ballots = []
            seen_in_block = set()
            for b in pending:
                vote_key = (b.proposal_id, b.voter_id.lower())
                if (b.verify() and 
                    self.node.ledger.is_registered(b.voter_id) and 
                    not self.node.ledger.has_voted(b.proposal_id, b.voter_id) and 
                    vote_key not in seen_in_block):
                    valid_ballots.append(b)
                    seen_in_block.add(vote_key)
                else:
                    logger.warning("Dropping invalid or duplicate ballot from block: %s", b)

            new_block = Block(
                index=len(self.node.ledger.chain),
                prev_hash=self.node.ledger.chain[-1].hash,
                ballots=valid_ballots
            )
            new_block.mine(difficulty=self.node.difficulty)
            self.node.ledger.chain.append(new_block)
            return self._send_json({
                "status": "mined",
                "block_index": new_block.index,
                "block_hash": new_block.hash,
                "ballots_sealed": len(valid_ballots)
            })

        elif path == "/api/v1/peers":
            peer = data.get("peer")
            if peer and peer not in self.node.peers:
                self.node.peers.append(peer)
            return self._send_json({"peers": self.node.peers})

        elif path == "/api/v1/sync":
            candidate_raw = data.get("chain", [])
            if not candidate_raw:
                return self._send_json({"error": "Empty chain provided"}, 400)
            try:
                candidate = [Block.from_dict(b) for b in candidate_raw]
            except Exception as e:
                return self._send_json({"error": f"Invalid block format: {e}"}, 400)

            replaced = self.node.consensus.resolve_conflicts([candidate])
            return self._send_json({
                "chain_replaced": replaced,
                "current_length": len(self.node.ledger.chain)
            })

        elif path == "/api/v1/register":
            voter_id = data.get("voter_id", "").strip()
            if not voter_id:
                return self._send_json({"error": "Missing voter_id"}, 400)
            self.node.ledger.register_voter(voter_id)
            return self._send_json({"status": "registered", "voter_id": voter_id.lower()}, 200)

        elif path == "/api/v1/keygen":
            priv, pub = generate_keypair()
            return self._send_json({
                "voter_id": public_key_to_hex(pub),
                "secret_key": private_key_to_hex(priv)
            })

        elif path == "/api/v1/sign":
            secret_key_hex = str(data.get("secret_key", "")).strip()
            proposal_id = str(data.get("proposal_id", "")).strip()
            choice = str(data.get("choice", "")).strip().upper()
            weight = int(data.get("weight", 1))

            if not secret_key_hex or not proposal_id or not choice:
                return self._send_json({"error": "secret_key, proposal_id, and choice are required"}, 400)

            try:
                priv = private_key_from_hex(secret_key_hex)
                pub = priv.public_key()
                voter_id = public_key_to_hex(pub)
                ballot = Ballot(
                    voter_id=voter_id,
                    proposal_id=proposal_id,
                    choice=choice,
                    weight=weight
                )
                sig = sign_message(priv, ballot.get_digest())
                ballot.signature = sig.hex()
                return self._send_json({
                    "ballot": ballot.to_dict(),
                    "signature": ballot.signature,
                    "digest": ballot.get_digest().hex(),
                    "voter_id": voter_id
                })
            except Exception as e:
                return self._send_json({"error": f"Signing error: {e}"}, 400)

        else:
            return self._send_json({"error": "Endpoint not found"}, 404)

    def log_message(self, format, *args):
        # Silence default stderr logging for clean test runs
        return
