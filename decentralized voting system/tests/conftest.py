import threading
import time
import pytest
from openballot.ledger import Ledger
from openballot.node import NodeServer, NodeHandler


@pytest.fixture(scope="module")
def running_server():
    ledger = Ledger()
    ledger.create_genesis_block()
    # Dynamic or high test port
    port = 8769
    server = NodeServer(("127.0.0.1", port), NodeHandler, ledger=ledger, difficulty=1)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.15)
    base_url = f"http://127.0.0.1:{port}"
    yield base_url, ledger
    server.shutdown()
    server.server_close()
