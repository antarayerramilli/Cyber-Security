import json
import logging
import mimetypes
import urllib.request
import urllib.error
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from typing import Optional, List, Dict, Any

from openballot.ballot import Ballot
from openballot.block import Block
from openballot.ledger import Ledger
from openballot.mempool import Mempool
from openballot.consensus import ConsensusEngine
from openballot.audit import audit_log
from openballot.elections import election_manager
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
            audit_log.log("GENESIS_CREATED", "Genesis block #0 created with initial proof", "SUCCESS")


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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        # Health
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

        # Elections configuration with live tallies
        elif path == "/api/v1/elections":
            all_elections = election_manager.get_all()
            result = []
            for e in all_elections:
                pid = e["proposal_id"]
                tally = self.node.ledger.tally(pid)
                total_votes = sum(tally.values())
                result.append({
                    **e,
                    "tally": tally,
                    "total_votes": total_votes
                })
            return self._send_json({"elections": result})

        # Blockchain Ledger
        elif path == "/api/v1/chain":
            chain_data = [b.to_dict() for b in self.node.ledger.chain]
            return self._send_json({"length": len(chain_data), "chain": chain_data})

        # Blockchain Integrity Verification
        elif path == "/api/v1/verify-chain":
            detailed_report = self.node.consensus.verify_chain_detailed()
            audit_log.log(
                "CHAIN_VERIFICATION",
                f"Full chain verification executed: {detailed_report['total_blocks']} blocks evaluated",
                "SUCCESS" if detailed_report["valid"] else "ERROR"
            )
            return self._send_json(detailed_report)

        # Individual Vote / Ballot Verification
        elif path == "/api/v1/verify-ballot":
            query = qs.get("query", [""])[0].strip().lower()
            if not query:
                return self._send_json({"error": "Missing 'query' parameter (enter voter public key or vote digest)"}, 400)

            # Search in confirmed blockchain blocks
            found = False
            result = None
            for block in self.node.ledger.chain:
                for ballot in block.ballots:
                    digest_hex = ballot.get_digest().hex().lower()
                    if query in (ballot.voter_id.lower(), digest_hex, ballot.signature.lower()):
                        sig_valid = ballot.verify()
                        found = True
                        result = {
                            "found": True,
                            "location": "CONFIRMED_BLOCK",
                            "block_index": block.index,
                            "block_hash": block.hash,
                            "block_timestamp": block.timestamp,
                            "voter_id": ballot.voter_id,
                            "proposal_id": ballot.proposal_id,
                            "choice": ballot.choice,
                            "weight": ballot.weight,
                            "vote_id": digest_hex,
                            "signature": ballot.signature,
                            "signature_valid": sig_valid,
                            "block_valid": True,
                            "status": "VERIFIED_ON_CHAIN"
                        }
                        break
                if found:
                    break

            # Search in unconfirmed mempool if not on chain
            if not found:
                for ballot in self.node.mempool.all():
                    digest_hex = ballot.get_digest().hex().lower()
                    if query in (ballot.voter_id.lower(), digest_hex, ballot.signature.lower()):
                        sig_valid = ballot.verify()
                        found = True
                        result = {
                            "found": True,
                            "location": "MEMPOOL",
                            "block_index": None,
                            "block_hash": None,
                            "voter_id": ballot.voter_id,
                            "proposal_id": ballot.proposal_id,
                            "choice": ballot.choice,
                            "weight": ballot.weight,
                            "vote_id": digest_hex,
                            "signature": ballot.signature,
                            "signature_valid": sig_valid,
                            "block_valid": None,
                            "status": "PENDING_CONFIRMATION"
                        }
                        break

            if found:
                audit_log.log("BALLOT_VERIFY", f"Verified ballot {result['voter_id'][:8]}... for {result['proposal_id']}: {result['status']}", "SUCCESS")
                return self._send_json(result)
            else:
                audit_log.log("BALLOT_VERIFY", f"Ballot lookup failed for query: {query[:12]}...", "WARNING")
                return self._send_json({
                    "found": False,
                    "status": "NOT_FOUND",
                    "message": "No matching ballot found on the confirmed blockchain or in the mempool."
                }, 404)

        # Mempool
        elif path == "/api/v1/mempool":
            ballots_data = [b.to_dict() for b in self.node.mempool.all()]
            return self._send_json({"count": len(ballots_data), "ballots": ballots_data})

        # Proposals list
        elif path == "/api/v1/proposals":
            proposals_set = set(self.node.ledger.get_proposals())
            for b in self.node.mempool.all():
                if b.proposal_id:
                    proposals_set.add(b.proposal_id)
            for e in election_manager.get_all():
                proposals_set.add(e["proposal_id"])

            res = []
            for pid in sorted(proposals_set):
                tally = self.node.ledger.tally(pid)
                total_votes = sum(tally.values())
                election_meta = election_manager.get(pid)
                res.append({
                    "proposal_id": pid,
                    "title": election_meta["title"] if election_meta else f"Proposal {pid}",
                    "tally": tally,
                    "total_votes": total_votes
                })
            return self._send_json({"proposals": res})

        # Tally for a specific proposal
        elif path == "/api/v1/tally":
            proposal = qs.get("proposal", [""])[0]
            if not proposal:
                return self._send_json({"error": "Missing proposal query parameter"}, 400)
            tally = self.node.ledger.tally(proposal)
            return self._send_json({"proposal": proposal, "results": tally})

        # Voter Registry list
        elif path == "/api/v1/voters":
            voters_list = []
            registry = sorted(self.node.ledger.voter_registry)
            proposals = self.node.ledger.get_proposals() or ["PROP-2026-01"]
            for vid in registry:
                voted_props = [p for p in proposals if self.node.ledger.has_voted(p, vid)]
                pending_props = [b.proposal_id for b in self.node.mempool.all() if b.voter_id.lower() == vid.lower()]
                voters_list.append({
                    "voter_id": vid,
                    "voter_id_short": f"{vid[:8]}...{vid[-6:]}",
                    "authorized": True,
                    "voted_proposals": voted_props,
                    "pending_proposals": pending_props,
                    "has_voted": len(voted_props) > 0
                })
            return self._send_json({
                "count": len(voters_list),
                "open_policy": len(registry) == 0,
                "voters": voters_list
            })

        # Audit Log
        elif path == "/api/v1/audit-log":
            return self._send_json({
                "events": audit_log.get_events()
            })

        # Peers
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

        # Cast Ballot
        if path == "/api/v1/ballots":
            try:
                ballot = Ballot.from_dict(data)
            except ValueError as ve:
                return self._send_json({"error": str(ve)}, 400)

            if not ballot.voter_id or not ballot.proposal_id or not ballot.choice:
                return self._send_json({"error": "Missing required ballot fields"}, 400)

            # Security Rule: Enforce standard weight = 1
            if ballot.weight != 1:
                audit_log.log("BALLOT_REJECTED", f"Unauthorized voting weight {ballot.weight} from voter {ballot.voter_id[:8]}", "WARNING")
                return self._send_json({"error": "Invalid vote weight: standard elections require weight=1"}, 400)

            # 1. Verify digital signature with Ed25519
            if not ballot.verify():
                audit_log.log("SIGNATURE_FAILED", f"Cryptographic signature check failed for voter {ballot.voter_id[:8]}", "ERROR")
                return self._send_json({"error": "Cryptographic signature verification failed"}, 401)
            audit_log.log("SIGNATURE_VERIFIED", f"Ed25519 signature verified for voter {ballot.voter_id[:8]}", "SUCCESS")

            # 2. Verify voter registration (case-insensitive whitelist)
            if not self.node.ledger.is_registered(ballot.voter_id):
                audit_log.log("UNAUTHORIZED_VOTER", f"Voter {ballot.voter_id[:8]} not in authorized registry", "WARNING")
                return self._send_json({"error": "Voter ID not in authorized voter registry"}, 403)

            # 3. Check if voter already cast ballot on confirmed ledger
            if self.node.ledger.has_voted(ballot.proposal_id, ballot.voter_id):
                audit_log.log("DOUBLE_VOTE_CONFIRMED", f"Duplicate vote attempted on confirmed ledger by {ballot.voter_id[:8]} on {ballot.proposal_id}", "WARNING")
                return self._send_json({"error": "You have already submitted a vote for this proposal"}, 409)

            # 4. Check if voter already has a ballot pending in mempool
            if self.node.mempool.has_ballot(ballot.proposal_id, ballot.voter_id):
                audit_log.log("DOUBLE_VOTE_MEMPOOL", f"Duplicate vote attempted in mempool by {ballot.voter_id[:8]} on {ballot.proposal_id}", "WARNING")
                return self._send_json({"error": "A ballot for this voter is already pending in the mempool"}, 409)

            # Ingest ballot into mempool
            if not self.node.mempool.add(ballot):
                return self._send_json({"error": "Duplicate ballot in mempool"}, 409)

            vote_id = ballot.get_digest().hex()
            audit_log.log("BALLOT_INGESTED", f"Ballot added to mempool: {ballot.choice} on {ballot.proposal_id} (Vote ID: {vote_id[:8]}...)", "SUCCESS")
            election_manager.ensure_exists(ballot.proposal_id)

            return self._send_json({
                "status": "accepted",
                "vote_id": vote_id,
                "proposal": ballot.proposal_id,
                "message": "Ballot verified and queued into mempool"
            }, 202)

        # Mine Block
        elif path == "/api/v1/mine":
            pending = self.node.mempool.drain()
            audit_log.log("MINING_STARTED", f"Proof-of-work mining initiated for {len(pending)} pending ballots", "INFO")

            # Filter and validate pending ballots
            valid_ballots = []
            seen_in_block = set()
            for b in pending:
                vote_key = (b.proposal_id, b.voter_id.lower())
                if (b.verify() and 
                    b.weight == 1 and
                    self.node.ledger.is_registered(b.voter_id) and 
                    not self.node.ledger.has_voted(b.proposal_id, b.voter_id) and 
                    vote_key not in seen_in_block):
                    valid_ballots.append(b)
                    seen_in_block.add(vote_key)
                else:
                    logger.warning("Dropping invalid or duplicate ballot from block: %s", b)
                    audit_log.log("BALLOT_DROPPED", f"Invalid or duplicate ballot dropped from mining pool: {b.voter_id[:8]}", "WARNING")

            new_block = Block(
                index=len(self.node.ledger.chain),
                prev_hash=self.node.ledger.chain[-1].hash,
                ballots=valid_ballots
            )
            new_block.mine(difficulty=self.node.difficulty)
            self.node.ledger.chain.append(new_block)

            audit_log.log(
                "BLOCK_MINED",
                f"Block #{new_block.index} successfully mined: {len(valid_ballots)} votes sealed (Hash: {new_block.hash[:12]}...)",
                "SUCCESS"
            )

            return self._send_json({
                "status": "mined",
                "block_index": new_block.index,
                "block_hash": new_block.hash,
                "nonce": new_block.nonce,
                "ballots_sealed": len(valid_ballots),
                "timestamp": new_block.timestamp
            })

        # Peers
        elif path == "/api/v1/peers":
            peer = data.get("peer", "").strip()
            if peer and peer not in self.node.peers:
                self.node.peers.append(peer)
                audit_log.log("PEER_ADDED", f"New peer registered: {peer}", "INFO")
            return self._send_json({"peers": self.node.peers})

        # Sync with peers
        elif path == "/api/v1/sync":
            # If peer sent a candidate chain, resolve it
            candidate_raw = data.get("chain", [])
            if candidate_raw:
                try:
                    candidate = [Block.from_dict(b) for b in candidate_raw]
                except Exception as e:
                    return self._send_json({"error": f"Invalid block format: {e}"}, 400)

                replaced = self.node.consensus.resolve_conflicts([candidate])
                if replaced:
                    audit_log.log("CHAIN_SYNC", f"Adopted authoritative peer chain of length {len(candidate)}", "SUCCESS")
                return self._send_json({
                    "chain_replaced": replaced,
                    "current_length": len(self.node.ledger.chain)
                })

            # Otherwise, pull chain from registered peers
            synced_any = False
            errors = []
            for peer_url in list(self.node.peers):
                try:
                    req_url = f"{peer_url.rstrip('/')}/api/v1/chain"
                    with urllib.request.urlopen(req_url, timeout=3) as resp:
                        peer_data = json.loads(resp.read().decode("utf-8"))
                        peer_chain = [Block.from_dict(b) for b in peer_data.get("chain", [])]
                        if self.node.consensus.resolve_conflicts([peer_chain]):
                            synced_any = True
                            audit_log.log("PEER_SYNC", f"Synchronized longer chain from peer {peer_url}", "SUCCESS")
                except Exception as err:
                    errors.append(f"{peer_url}: {err}")

            return self._send_json({
                "synced": synced_any,
                "current_length": len(self.node.ledger.chain),
                "peers_checked": len(self.node.peers),
                "errors": errors
            })

        # Register voter public key
        elif path == "/api/v1/register":
            voter_id = data.get("voter_id", "").strip()
            if not voter_id:
                return self._send_json({"error": "Missing voter_id"}, 400)
            self.node.ledger.register_voter(voter_id)
            audit_log.log("VOTER_REGISTERED", f"Voter {voter_id[:8]}... whitelisted in authorized registry", "INFO")
            return self._send_json({"status": "registered", "voter_id": voter_id.lower()}, 200)

        # Key generation
        elif path == "/api/v1/keygen":
            priv, pub = generate_keypair()
            pub_hex = public_key_to_hex(pub)
            priv_hex = private_key_to_hex(priv)
            return self._send_json({
                "voter_id": pub_hex,
                "secret_key": priv_hex
            })

        # Safe signing helper for web demonstration
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

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        data = self._read_json() or {}

        if path == "/api/v1/peers":
            peer = data.get("peer", "").strip()
            if peer in self.node.peers:
                self.node.peers.remove(peer)
                audit_log.log("PEER_REMOVED", f"Removed peer: {peer}", "INFO")
                return self._send_json({"status": "removed", "peers": self.node.peers})
            return self._send_json({"error": "Peer not found in registry"}, 404)

        return self._send_json({"error": "Endpoint not found"}, 404)

    def log_message(self, format, *args):
        # Silence default stderr logging for clean test runs
        return
