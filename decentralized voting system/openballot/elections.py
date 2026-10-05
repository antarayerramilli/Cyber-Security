from typing import Dict, List, Optional, Any


DEFAULT_ELECTIONS: Dict[str, Dict[str, Any]] = {
    "PROP-2026-01": {
        "proposal_id": "PROP-2026-01",
        "title": "Campus Student Government President Election 2026",
        "description": "Annual referendum for student body executive governance and campus community leadership.",
        "category": "Student Governance",
        "status": "ACTIVE",
        "choices": ["YES", "NO", "ABSTAIN"]
    },
    "PROP-2026-02": {
        "proposal_id": "PROP-2026-02",
        "title": "University Library 24/7 Extended Hours Referendum",
        "description": "Proposal to allocate student facility endowment funds to keep library study rooms open 24/7.",
        "category": "Campus Facilities",
        "status": "ACTIVE",
        "choices": ["YES", "NO", "ABSTAIN"]
    }
}


class ElectionManager:
    """
    Manages metadata and configuration for elections/proposals.
    Ensures proposals have human-readable context alongside raw ledger IDs.
    """
    def __init__(self):
        self._elections: Dict[str, Dict[str, Any]] = dict(DEFAULT_ELECTIONS)

    def get_all(self) -> List[Dict[str, Any]]:
        return list(self._elections.values())

    def get(self, proposal_id: str) -> Optional[Dict[str, Any]]:
        return self._elections.get(proposal_id.strip())

    def register_proposal(self, proposal_id: str, title: str, description: str, choices: Optional[List[str]] = None) -> Dict[str, Any]:
        p_id = proposal_id.strip()
        election = {
            "proposal_id": p_id,
            "title": title.strip() or f"Referendum {p_id}",
            "description": description.strip() or "General voting referendum.",
            "category": "Governance",
            "status": "ACTIVE",
            "choices": choices or ["YES", "NO", "ABSTAIN"]
        }
        self._elections[p_id] = election
        return election

    def ensure_exists(self, proposal_id: str):
        p_id = proposal_id.strip()
        if p_id and p_id not in self._elections:
            self.register_proposal(p_id, f"Proposal {p_id}", "Referendum recorded on the blockchain ledger.")


# Global instance
election_manager = ElectionManager()
