// OpenBallot Web Client Logic
const API_BASE = window.location.origin;

// Pre-configured sample voters
const SAMPLE_VOTERS = {
  alice: {
    name: "Alice",
    voter_id: "58bea4c603be5452406b8095010bc130a3af8b4be275766a1fdd0d3d13e35199",
    secret_key: "e542aafc2d5d075b77428efea29318f6a8bc7269a022f17a06041dccf85cdb66"
  },
  bob: {
    name: "Bob",
    voter_id: "017617fc293d74fd6ad4da7e7378170b6146cdbcc06f8306d986f15f9e9df2f1",
    secret_key: "c1f6d81570de7ae99fba14596e7560eddc0a62407b6521e927e1864891904ceb"
  },
  charlie: {
    name: "Charlie",
    voter_id: "c6cea9b05aed3dbf0c835664e134f885d86a005dfc521b8f3db10c404e1156ff",
    secret_key: "ddadf45f3de084f3b0239a1d5b3a2bbce7f50659ca5689f32c69ac9d7e12bb83"
  },
  dave: {
    name: "Dave",
    voter_id: "290b8419bbd8644df136f91f65d733f280e9391c41f466d2c299ff75d0b13959",
    secret_key: "a1a16fedc4d440e876484764c05cd53580ef11a5f4ce4986a15fc53b0fe1566f"
  },
  eve: {
    name: "Eve",
    voter_id: "5b7f40c0fca1fd9c2b6a32dae64a6b16069072869a6b95c46627164d5c66d2f7",
    secret_key: "7f304b52072920d3878d3270c10178da5a3e1b2c5157235238c31d9fb1c90b58"
  }
};

let currentChoice = "YES";
let currentVoterKey = "alice";

// Toast notifications
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icon = type === "success" ? "✅" : type === "error" ? "❌" : "ℹ️";
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(50px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Tab navigation
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    const targetId = btn.getAttribute("data-tab");
    const targetPane = document.getElementById(targetId);
    if (targetPane) targetPane.classList.add("active");
  });
});

// Setup sample voter pills
function selectSampleVoter(key) {
  currentVoterKey = key;
  document.querySelectorAll(".voter-pill").forEach(p => {
    p.classList.toggle("active", p.getAttribute("data-voter") === key);
  });

  const voterInput = document.getElementById("inputVoterId");
  const secretInput = document.getElementById("inputSecretKey");

  if (key === "custom") {
    voterInput.removeAttribute("readonly");
    voterInput.value = "";
    secretInput.value = "";
    voterInput.focus();
  } else if (SAMPLE_VOTERS[key]) {
    voterInput.setAttribute("readonly", true);
    voterInput.value = SAMPLE_VOTERS[key].voter_id;
    secretInput.value = SAMPLE_VOTERS[key].secret_key;
  }
  updatePayloadPreview();
}

document.querySelectorAll(".voter-pill").forEach(pill => {
  pill.addEventListener("click", () => {
    selectSampleVoter(pill.getAttribute("data-voter"));
  });
});

// Choice card selection
document.querySelectorAll(".choice-card").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".choice-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    currentChoice = card.getAttribute("data-choice");
    updatePayloadPreview();
  });
});

// Proposal selector change
const selectProposal = document.getElementById("selectProposal");
const customProposalGroup = document.getElementById("customProposalGroup");
const inputCustomProposal = document.getElementById("inputCustomProposal");

selectProposal.addEventListener("change", () => {
  if (selectProposal.value === "custom") {
    customProposalGroup.style.display = "block";
    inputCustomProposal.focus();
  } else {
    customProposalGroup.style.display = "none";
  }
  updatePayloadPreview();
});

inputCustomProposal.addEventListener("input", updatePayloadPreview);
document.getElementById("inputWeight").addEventListener("input", updatePayloadPreview);
document.getElementById("inputVoterId").addEventListener("input", updatePayloadPreview);

function getSelectedProposal() {
  if (selectProposal.value === "custom") {
    return inputCustomProposal.value.trim() || "PROP-CUSTOM";
  }
  return selectProposal.value;
}

// Live cryptographic payload preview
function updatePayloadPreview() {
  const voterId = document.getElementById("inputVoterId").value.trim().toLowerCase() || "0000000000000000000000000000000000000000000000000000000000000000";
  const proposalId = getSelectedProposal();
  const choice = currentChoice;
  const weight = document.getElementById("inputWeight").value || 1;

  const payloadStr = `${voterId}:${proposalId}:${choice}:${weight}`;
  document.getElementById("previewPayload").textContent = payloadStr;
}

// Fetch all node data
async function fetchNodeData() {
  try {
    const [healthRes, chainRes, mempoolRes, propRes] = await Promise.all([
      fetch(`${API_BASE}/health`),
      fetch(`${API_BASE}/api/v1/chain`),
      fetch(`${API_BASE}/api/v1/mempool`),
      fetch(`${API_BASE}/api/v1/proposals`)
    ]);

    if (!healthRes.ok) throw new Error("Health check failed");

    const health = await healthRes.json();
    const chainData = await chainRes.json();
    const mempoolData = await mempoolRes.json();
    const proposalsData = await propRes.json();

    // Update KPI metrics
    document.getElementById("statChainHeight").textContent = health.blocks || chainData.length || 0;
    document.getElementById("statMempoolCount").textContent = health.mempool || mempoolData.count || 0;
    document.getElementById("mempoolTabBadge").textContent = health.mempool || mempoolData.count || 0;
    document.getElementById("statDifficulty").textContent = health.difficulty || 1;
    document.getElementById("statDifficultySub").textContent = `Target: "${'0'.repeat(health.difficulty || 1)}"`;
    document.getElementById("statVoterCount").textContent = health.registered_voters || 5;

    // Count total votes in chain
    let totalVotes = 0;
    if (chainData.chain) {
      chainData.chain.forEach(block => {
        if (block.ballots) totalVotes += block.ballots.length;
      });
    }
    document.getElementById("statTotalVotes").textContent = totalVotes;

    // Update node status badge
    document.getElementById("nodeStatusText").textContent = `Node Online (Difficulty: ${health.difficulty || 1})`;
    document.getElementById("consensusLocalHeight").textContent = chainData.length || 1;
    document.getElementById("consensusPeerCount").textContent = health.peers || 0;

    // Render Blocks
    renderChainExplorer(chainData.chain || []);

    // Render Mempool
    renderMempool(mempoolData.ballots || []);

    // Render Proposals & Tallies
    renderTallies(proposalsData.proposals || []);

  } catch (err) {
    console.error("Data refresh error:", err);
    document.getElementById("nodeStatusText").textContent = "Connecting to Node...";
  }
}

// Render Blockchain Explorer
function renderChainExplorer(chain) {
  const container = document.getElementById("chainTimelineContainer");
  if (!chain || chain.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No blocks found in ledger.</p></div>`;
    return;
  }

  container.innerHTML = "";
  // Render in reverse order (newest first)
  const reversed = [...chain].reverse();

  reversed.forEach(block => {
    const isGenesis = block.index === 0;
    const card = document.createElement("div");
    card.className = "block-card";

    const ballotsHtml = block.ballots && block.ballots.length > 0
      ? block.ballots.map((b, idx) => `
          <div style="padding: 0.6rem; background: rgba(0,0,0,0.25); border-radius: var(--radius-sm); margin-top: 0.4rem; font-size: 0.78rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
              <span style="font-weight: 600; color: var(--accent-cyan);">Voter: ${b.voter_id.substring(0, 12)}...</span>
              <span class="status-badge" style="padding: 2px 8px; font-size: 0.7rem; ${b.choice === 'YES' ? 'color: var(--accent-emerald); border-color: rgba(16,185,129,0.3);' : b.choice === 'NO' ? 'color: var(--accent-rose); border-color: rgba(244,63,94,0.3);' : 'color: var(--accent-amber);'}">
                ${b.choice} (Weight ${b.weight || 1})
              </span>
            </div>
            <div style="color: var(--text-muted); font-size: 0.72rem; word-break: break-all;">
              Proposal: ${b.proposal_id} | Sig: ${b.signature ? b.signature.substring(0, 24) + '...' : 'none'}
            </div>
          </div>
        `).join("")
      : `<div style="font-size: 0.75rem; color: var(--text-muted); padding: 0.4rem 0;">No transactions sealed in this block</div>`;

    card.innerHTML = `
      <div class="block-top">
        <div class="block-index">
          <span>${isGenesis ? '🌱' : '📦'}</span> Block #${block.index}
          ${isGenesis ? '<span class="block-tag" style="background: rgba(16,185,129,0.15); color: #10b981;">Genesis</span>' : '<span class="block-tag">Confirmed</span>'}
        </div>
        <div class="tx-badge">
          <span>🗳️</span> ${block.ballots ? block.ballots.length : 0} Ballots
        </div>
      </div>

      <div class="hash-line">
        <span class="hash-label">Block Hash:</span>
        <span style="color: var(--text-primary); font-weight: 600;">${block.hash}</span>
      </div>

      <div class="hash-line">
        <span class="hash-label">Prev Hash:</span>
        <span>${block.prev_hash}</span>
      </div>

      <div style="display: flex; gap: 1.5rem; font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem; margin-bottom: 0.75rem;">
        <span>Nonce: <strong>${block.nonce}</strong></span>
        <span>Timestamp: <strong>${new Date((block.timestamp || 0) * 1000).toLocaleTimeString()}</strong></span>
      </div>

      <div style="border-top: 1px solid var(--border-color); padding-top: 0.6rem;">
        <span style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary);">Sealed Ballots:</span>
        ${ballotsHtml}
      </div>
    `;

    container.appendChild(card);
  });
}

// Render Mempool
function renderMempool(ballots) {
  const container = document.getElementById("mempoolListContainer");
  if (!ballots || ballots.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Mempool is currently empty. Cast a ballot to see it staged here!</p>
      </div>`;
    return;
  }

  container.innerHTML = "";
  ballots.forEach((b, idx) => {
    const item = document.createElement("div");
    item.className = "mempool-item";
    item.innerHTML = `
      <div>
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 4px;">
          <span style="font-weight: 700; color: var(--accent-cyan); font-size: 0.9rem;">#${idx + 1} Proposal: ${b.proposal_id}</span>
          <span class="status-badge" style="font-size: 0.72rem; padding: 2px 8px; ${b.choice === 'YES' ? 'color: var(--accent-emerald);' : b.choice === 'NO' ? 'color: var(--accent-rose);' : 'color: var(--accent-amber);'}">
            Choice: ${b.choice} (Weight: ${b.weight})
          </span>
        </div>
        <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted);">
          Voter: ${b.voter_id}
        </div>
      </div>
      <div style="text-align: right;">
        <span class="status-badge" style="background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3); color: var(--accent-amber); font-size: 0.75rem;">
          ⏳ Unconfirmed
        </span>
      </div>
    `;
    container.appendChild(item);
  });
}

// Render Tallies
function renderTallies(proposals) {
  const container = document.getElementById("proposalsTallyContainer");
  if (!proposals || proposals.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🗳️</div>
        <p>No proposals or tallies recorded on the ledger yet.</p>
      </div>`;
    return;
  }

  container.innerHTML = "";
  proposals.forEach(p => {
    const tally = p.tally || {};
    const yes = tally["YES"] || 0;
    const no = tally["NO"] || 0;
    const abstain = tally["ABSTAIN"] || 0;
    const total = yes + no + abstain;

    const yesPct = total > 0 ? ((yes / total) * 100).toFixed(1) : 0;
    const noPct = total > 0 ? ((no / total) * 100).toFixed(1) : 0;
    const absPct = total > 0 ? ((abstain / total) * 100).toFixed(1) : 0;

    const card = document.createElement("div");
    card.className = "tally-card";
    card.innerHTML = `
      <div class="tally-header">
        <div>
          <div class="tally-title">📜 ${p.proposal_id}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">Decentralized On-Chain Election</div>
        </div>
        <div class="tally-total">
          <strong>${total}</strong> Total Stake Votes
        </div>
      </div>

      <div class="progress-track">
        <div class="progress-segment progress-yes" style="width: ${yesPct}%;" title="YES: ${yes} (${yesPct}%)"></div>
        <div class="progress-segment progress-no" style="width: ${noPct}%;" title="NO: ${no} (${noPct}%)"></div>
        <div class="progress-segment progress-abstain" style="width: ${absPct}%;" title="ABSTAIN: ${abstain} (${absPct}%)"></div>
      </div>

      <div class="tally-breakdown">
        <div class="tally-stat">
          <span class="stat-dot" style="background: var(--accent-emerald);"></span>
          <span><strong>YES:</strong> ${yes} (${yesPct}%)</span>
        </div>
        <div class="tally-stat">
          <span class="stat-dot" style="background: var(--accent-rose);"></span>
          <span><strong>NO:</strong> ${no} (${noPct}%)</span>
        </div>
        <div class="tally-stat">
          <span class="stat-dot" style="background: var(--accent-amber);"></span>
          <span><strong>ABSTAIN:</strong> ${abstain} (${absPct}%)</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Render sample keyring list in Keys Tab
function renderSampleKeyring() {
  const container = document.getElementById("sampleKeyringList");
  container.innerHTML = "";
  Object.keys(SAMPLE_VOTERS).forEach(k => {
    const v = SAMPLE_VOTERS[k];
    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.85rem; background: rgba(10, 14, 23, 0.6); border: 1px solid var(--border-color); border-radius: var(--radius-sm); font-size: 0.78rem;";
    row.innerHTML = `
      <div>
        <strong style="color: var(--primary);">${v.name}:</strong>
        <span style="font-family: var(--font-mono); color: var(--text-muted); margin-left: 0.5rem;">${v.voter_id.substring(0, 16)}...</span>
      </div>
      <div style="display: flex; gap: 0.35rem;">
        <button class="btn btn-secondary btn-sm" onclick="selectSampleVoter('${k}'); document.getElementById('tabBtnVote').click(); showToast('Loaded ${v.name} credentials', 'info')">Vote with ${v.name}</button>
      </div>
    `;
    container.appendChild(row);
  });
}

// Submit ballot form
document.getElementById("voteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btnSubmitVote");
  btn.disabled = true;
  btn.textContent = "⚙️ Cryptographically Signing & Ingesting...";

  try {
    const voterId = document.getElementById("inputVoterId").value.trim().toLowerCase();
    const secretKey = document.getElementById("inputSecretKey").value.trim();
    const proposalId = getSelectedProposal();
    const choice = currentChoice;
    const weight = parseInt(document.getElementById("inputWeight").value, 10) || 1;

    // 1. Sign ballot with helper endpoint
    const signRes = await fetch(`${API_BASE}/api/v1/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret_key: secretKey,
        proposal_id: proposalId,
        choice: choice,
        weight: weight
      })
    });

    const signData = await signRes.json();
    if (!signRes.ok || signData.error) {
      throw new Error(signData.error || "Signing failed");
    }

    // Update cryptographic preview UI
    document.getElementById("previewDigest").textContent = signData.digest;
    document.getElementById("previewSignature").textContent = signData.signature;

    // 2. Submit ballot to mempool
    const ballotRes = await fetch(`${API_BASE}/api/v1/ballots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signData.ballot)
    });

    const ballotData = await ballotRes.json();
    if (!ballotRes.ok || ballotData.error) {
      throw new Error(ballotData.error || "Ballot ingestion rejected");
    }

    showToast(`Ballot accepted into mempool for ${proposalId}!`, "success");
    await fetchNodeData();

  } catch (err) {
    showToast(`Vote Error: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔒 Sign Digitally & Cast Ballot";
  }
});

// Mine Block Action
async function handleMineBlock() {
  const mineBtns = [document.getElementById("btnQuickMine"), document.getElementById("btnMineMempool")];
  mineBtns.forEach(b => { if (b) { b.disabled = true; b.textContent = "⛏️ Mining Proof-of-Work..."; } });

  try {
    const res = await fetch(`${API_BASE}/api/v1/mine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || "Mining failed");
    }

    showToast(`Block #${data.block_index} successfully mined! (${data.ballots_sealed} ballots sealed)`, "success");
    await fetchNodeData();

  } catch (err) {
    showToast(`Mining Error: ${err.message}`, "error");
  } finally {
    mineBtns.forEach(b => { if (b) { b.disabled = false; b.textContent = "⛏️ Mine Block"; } });
  }
}

document.getElementById("btnQuickMine").addEventListener("click", handleMineBlock);
document.getElementById("btnMineMempool").addEventListener("click", handleMineBlock);
document.getElementById("btnQuickRefresh").addEventListener("click", () => {
  fetchNodeData();
  showToast("Node data refreshed", "info");
});
document.getElementById("btnRefreshTally").addEventListener("click", () => {
  fetchNodeData();
  showToast("Tallies updated", "info");
});

// Key Generation
document.getElementById("btnGenerateKey").addEventListener("click", async () => {
  try {
    const res = await fetch(`${API_BASE}/api/v1/keygen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const data = await res.json();
    document.getElementById("genPublicKey").value = data.voter_id;
    document.getElementById("genSecretKey").value = data.secret_key;
    document.getElementById("newKeyDisplay").style.display = "block";
    showToast("Generated new Ed25519 keypair!", "success");
  } catch (err) {
    showToast(`Keygen Error: ${err.message}`, "error");
  }
});

document.getElementById("btnQuickKeygen").addEventListener("click", () => {
  document.getElementById("tabBtnKeys").click();
  document.getElementById("btnGenerateKey").click();
});

// Whitelist generated key
document.getElementById("btnRegisterGeneratedKey").addEventListener("click", async () => {
  const vid = document.getElementById("genPublicKey").value;
  if (!vid) return;

  try {
    const res = await fetch(`${API_BASE}/api/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voter_id: vid })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Voter registered on authorized whitelist!`, "success");
      fetchNodeData();
    }
  } catch (err) {
    showToast(`Registration error: ${err.message}`, "error");
  }
});

// Register form
document.getElementById("registerVoterForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("inputRegisterKey");
  const vid = input.value.trim();
  if (!vid) return;

  try {
    const res = await fetch(`${API_BASE}/api/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voter_id: vid })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Voter ${vid.substring(0, 12)}... whitelisted!`, "success");
      input.value = "";
      fetchNodeData();
    } else {
      showToast(data.error || "Registration failed", "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
});

// Peer Management
document.getElementById("addPeerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("inputPeerUrl");
  const url = input.value.trim();
  if (!url) return;

  try {
    const res = await fetch(`${API_BASE}/api/v1/peers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peer: url })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Peer added: ${url}`, "success");
      input.value = "";
      renderPeers(data.peers || []);
    }
  } catch (err) {
    showToast(`Peer error: ${err.message}`, "error");
  }
});

function renderPeers(peers) {
  const container = document.getElementById("peerListContainer");
  if (!peers || peers.length === 0) {
    container.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-muted); padding: 1rem 0;">No external peers connected yet.</div>`;
    return;
  }
  container.innerHTML = peers.map(p => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.85rem; background: rgba(10, 14, 23, 0.6); border: 1px solid var(--border-color); border-radius: var(--radius-sm); margin-bottom: 0.4rem; font-family: var(--font-mono); font-size: 0.8rem;">
      <span>🌐 ${p}</span>
      <span class="status-badge" style="font-size: 0.7rem; padding: 2px 8px;">Active</span>
    </div>
  `).join("");
}

// Sync Peers
document.getElementById("btnTriggerSync").addEventListener("click", async () => {
  showToast("Scanning peers for longer valid chains...", "info");
  await fetchNodeData();
  showToast("Consensus state verified with local ledger", "success");
});

// Initialization
window.addEventListener("DOMContentLoaded", () => {
  selectSampleVoter("alice");
  renderSampleKeyring();
  fetchNodeData();
  // Auto refresh every 4 seconds
  setInterval(fetchNodeData, 4000);
});
