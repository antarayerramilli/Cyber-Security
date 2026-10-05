import time
from typing import List, Dict, Any


class AuditLogger:
    """
    Lightweight structured in-memory chronological event logger for OpenBallot.
    Records system actions, ballot receipts, validations, block creation, and peer syncs.
    """
    def __init__(self, max_events: int = 500):
        self.max_events = max_events
        self.events: List[Dict[str, Any]] = []

    def log(self, event_type: str, details: str, status: str = "INFO"):
        now = time.time()
        record = {
            "timestamp": now,
            "time_str": time.strftime("%H:%M:%S", time.localtime(now)),
            "date_str": time.strftime("%Y-%m-%d", time.localtime(now)),
            "event_type": event_type,
            "details": details,
            "status": status  # "INFO", "SUCCESS", "WARNING", "ERROR"
        }
        self.events.append(record)
        if len(self.events) > self.max_events:
            self.events.pop(0)

    def get_events(self, limit: int = 100) -> List[Dict[str, Any]]:
        # Return newest first
        return list(reversed(self.events[-limit:]))


# Global instance for node server
audit_log = AuditLogger()
