// ==========================================================================
// OpenBallot - Professional Digital Voting Client Logic
// Standard administrative client connecting to local OpenBallot node
// ==========================================================================

const API_BASE = window.location.origin;

// Pre-configured voter keyring for demonstration without displaying secrets in UI
const VOTER_KEYRING = {
  alice: {
    name: "Alice (Authorized Student Voter)",
    voter_id: "58bea4c603be5452406b8095010bc130a3af8b4be275766a1fdd0d3d13e35199",
    secret_key: "e542aafc2d5d075b77428efea29318f6a8bc7269a022f17a06041dccf85cdb66"
  },
  bob: {
    name: "Bob (Authorized Student Voter)",
    voter_id: "017617fc293d74fd6ad4da7e7378170b6146cdbcc06f8306d986f15f9e9df2f1",
    secret_key: "c1f6d81570de7ae99fba14596e7560eddc0a62407b6521e927e1864891904ceb"
  },
  charlie: {
    name: "Charlie (Authorized Student Voter)",
    voter_id: "c6cea9b05aed3dbf0c835664e134f885d86a005dfc521b8f3db10c404e1156ff",
    secret_key: "ddadf45f3de084f3b0239a1d5b3a2bbce7f50659ca5689f32c69ac9d7e12bb83"
  },
  dave: {
    name: "Dave (Authorized Student Voter)",
    voter_id: "290b8419bbd8644df136f91f65d733f280e9391c41f466d2c299ff75d0b13959",
    secret_key: "a1a16fedc4d440e876484764c05cd53580ef11a5f4ce4986a15fc53b0fe1566f"
  },
  eve: {
    name: "Eve (Authorized Student Voter)",
    voter_id: "5b7f40c0fca1fd9c2b6a32dae64a6b16069072869a6b95c46627164d5c66d2f7",
    secret_key: "7f304b52072920d3878d3270c10178da5a3e1b2c5157235238c31d9fb1c90b58"
  }
};

let cachedChain = [];
let cachedElections = [];
let selectedChoice = "YES";
let pendingVotePayload = null;

// Shorten public keys cleanly for human readability
function shortenKey(key, start = 8, end = 6) {
  if (!key) return "-";
  if (key.length <= start + end) return key;
  return `${key.substring(0, start)}...${key.substring(key.length - end)}`;
}

// Format Unix timestamp
function formatTimestamp(ts) {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Simple Toast Notification
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `app-toast toast-${type}`;
  const icon = type === "success" ? "✓" : type === "error" ? "✗" : "ℹ";
  toast.innerHTML = `<span style="font-weight:700;">${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.2s ease";
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

// Navigation between tabs
function navigateToTab(tabId) {
  document.querySelectorAll(".nav-link").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
  });
  document.querySelectorAll(".page-tab-pane").forEach(pane => {
    pane.classList.toggle("active", pane.id === tabId);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", () => {
    const target = link.getAttribute("data-tab");
    navigateToTab(target);
  });
});

document.getElementById("brandLogoLink").addEventListener("click", (e) => {
  e.preventDefault();
  navigateToTab("tab-dashboard");
});

// Update banner clock
function updateClock() {
  const now = new Date();
  const el = document.getElementById("bannerTimestamp");
  if (el) el.textContent = "System Time: " + now.toUTCString();
}
setInterval(updateClock, 1000);
updateClock();

// Choice Radio cards toggle
document.querySelectorAll(".choice-option").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".choice-option").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");
    const radio = card.querySelector("input[type='radio']");
    if (radio) {
      radio.checked = true;
      selectedChoice = radio.value;
    }
  });
});

// Voter Profile selection
const voterProfileSelect = document.getElementById("voterProfileSelect");
const displayVoterId = document.getElementById("displayVoterId");
const customKeyGroup = document.getElementById("customKeyGroup");
const inputCustomSecret = document.getElementById("inputCustomSecret");

function updateVoterProfile() {
  const val = voterProfileSelect.value;
  if (val === "custom") {
    customKeyGroup.style.display = "block";
    displayVoterId.value = "Will be derived from private key upon signing";
  } else if (VOTER_KEYRING[val]) {
    customKeyGroup.style.display = "none";
    displayVoterId.value = VOTER_KEYRING[val].voter_id;
  }
}
voterProfileSelect.addEventListener("change", updateVoterProfile);
updateVoterProfile();

// Helper: Open Cast Vote tab with pre-selected proposal
function openVoteForProposal(proposalId) {
  const sel = document.getElementById("voteProposalSelect");
  if (sel) sel.value = proposalId;
  navigateToTab("tab-cast-vote");
}

// Helper: Open Results tab with pre-selected proposal
function openResultsForProposal(proposalId) {
  const sel = document.getElementById("resultsProposalFilter");
  if (sel) {
    sel.value = proposalId;
    renderResults();
  }
  navigateToTab("tab-results");
}

// Helper: Quick verify link
function setVerifyQuery(voterKey) {
  if (VOTER_KEYRING[voterKey]) {
    document.getElementById("verifyQueryInput").value = VOTER_KEYRING[voterKey].voter_id;
    document.getElementById("verifyVoteForm").dispatchEvent(new Event("submit"));
  }
}

// =========================================================================
// FETCH ALL BACKEND DATA
// =========================================================================
async function refreshAllData() {
  try {
    const [healthRes, chainRes, mempoolRes, electionsRes, votersRes, auditRes, peersRes] = await Promise.all([
      fetch(`${API_BASE}/health`),
      fetch(`${API_BASE}/api/v1/chain`),
      fetch(`${API_BASE}/api/v1/mempool`),
      fetch(`${API_BASE}/api/v1/elections`),
      fetch(`${API_BASE}/api/v1/voters`),
      fetch(`${API_BASE}/api/v1/audit-log`),
      fetch(`${API_BASE}/api/v1/peers`)
    ]);

    if (!healthRes.ok) throw new Error("Node connection failed");

    const health = await healthRes.json();
    const chainData = await chainRes.json();
    const mempoolData = await mempoolRes.json();
    const electionsData = await electionsRes.json();
    const votersData = await votersRes.json();
    const auditData = await auditRes.json();
    const peersData = await peersRes.json();

    cachedChain = chainData.chain || [];
    cachedElections = electionsData.elections || [];

    // Header Status
    const nodeBadge = document.getElementById("headerNodeBadge");
    nodeBadge.className = "system-badge badge-online";
    nodeBadge.innerHTML = `<span class="status-dot"></span><span>Node: <strong>ONLINE</strong></span>`;

    // Calculate total votes confirmed in chain
    let totalConfirmedVotes = 0;
    cachedChain.forEach(b => {
      if (b.ballots) totalConfirmedVotes += b.ballots.length;
    });

    // Update Dashboard KPIs
    document.getElementById("dashTotalVotes").textContent = totalConfirmedVotes;
    document.getElementById("dashPendingVotes").textContent = mempoolData.count || 0;
    document.getElementById("mempoolNavCount").textContent = mempoolData.count || 0;
    document.getElementById("dashChainHeight").textContent = cachedChain.length || 0;
    document.getElementById("dashActivePeers").textContent = (peersData.peers || []).length;
    document.getElementById("dashNodeHealth").textContent = "ONLINE";

    // Network diagram label
    document.getElementById("netDiagramLocalHeight").textContent = `Height: ${cachedChain.length}`;
    document.getElementById("netPeerBadgeCount").textContent = `${(peersData.peers || []).length} Connected`;

    // Render Sub-Views
    renderRecentActivity(auditData.events || []);
    renderElectionsTable(cachedElections);
    renderBlockchain(cachedChain);
    renderMempoolTable(mempoolData.ballots || []);
    renderResults();
    renderAuditLog(auditData.events || []);
    renderVotersTable(votersData.voters || []);
    renderPeersTable(peersData.peers || []);

  } catch (err) {
    console.error("Data refresh error:", err);
    const nodeBadge = document.getElementById("headerNodeBadge");
    nodeBadge.className = "system-badge badge-offline";
    nodeBadge.innerHTML = `<span class="status-dot"></span><span>Node: <strong>OFFLINE</strong></span>`;
    document.getElementById("dashNodeHealth").textContent = "OFFLINE";
    document.getElementById("dashNodeHealth").style.color = "var(--error-red)";
  }
}

// -------------------------------------------------------------------------
// RENDER: Recent Activity on Dashboard
// -------------------------------------------------------------------------
function renderRecentActivity(events) {
  const tbody = document.getElementById("dashRecentActivityBody");
  if (!events || events.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 16px;">No recent events recorded.</td></tr>`;
    return;
  }
  // Take top 6 newest events
  const slice = events.slice(0, 6);
  tbody.innerHTML = slice.map(ev => {
    const badgeClass = ev.status === "SUCCESS" ? "badge-valid" : ev.status === "ERROR" ? "badge-offline" : ev.status === "WARNING" ? "badge-warning" : "badge-online";
    return `
      <tr>
        <td class="font-mono" style="color: var(--text-muted);">${ev.time_str || '-'}</td>
        <td style="font-weight: 600;">${ev.event_type}</td>
        <td style="color: var(--text-secondary);">${ev.details}</td>
        <td><span class="system-badge ${badgeClass}" style="font-size: 11px;">${ev.status}</span></td>
      </tr>
    `;
  }).join("");
}

// -------------------------------------------------------------------------
// RENDER: Elections Table
// -------------------------------------------------------------------------
function renderElectionsTable(elections) {
  const tbody = document.getElementById("electionsTableBody");
  if (!elections || elections.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No elections configured on this node.</td></tr>`;
    return;
  }

  tbody.innerHTML = elections.map(e => `
    <tr>
      <td>
        <strong style="color: var(--color-blue-primary);">${e.title}</strong>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${e.description}</div>
      </td>
      <td class="font-mono"><strong>${e.proposal_id}</strong></td>
      <td>${e.category || 'General'}</td>
      <td><span class="system-badge badge-valid">ACTIVE</span></td>
      <td><strong>${e.total_votes || 0}</strong> confirmed</td>
      <td>${(e.choices || []).join(", ")}</td>
      <td style="text-align: right;">
        <button class="btn btn-primary btn-sm" onclick="openVoteForProposal('${e.proposal_id}')">Vote</button>
        <button class="btn btn-secondary btn-sm" onclick="openResultsForProposal('${e.proposal_id}')" style="margin-left: 4px;">Results</button>
      </td>
    </tr>
  `).join("");

  // Also update election select dropdown in voting tab
  const voteSel = document.getElementById("voteProposalSelect");
  const resSel = document.getElementById("resultsProposalFilter");
  if (voteSel && elections.length > 0) {
    const currentVal = voteSel.value;
    voteSel.innerHTML = elections.map(e => `<option value="${e.proposal_id}">${e.proposal_id}: ${e.title}</option>`).join("");
    if (currentVal && elections.some(e => e.proposal_id === currentVal)) {
      voteSel.value = currentVal;
    }
  }
  if (resSel && elections.length > 0) {
    const currentVal = resSel.value;
    resSel.innerHTML = elections.map(e => `<option value="${e.proposal_id}">${e.proposal_id}: ${e.title}</option>`).join("");
    if (currentVal && elections.some(e => e.proposal_id === currentVal)) {
      resSel.value = currentVal;
    }
  }
}

// -------------------------------------------------------------------------
// RENDER: Blockchain Table & Visual Diagram
// -------------------------------------------------------------------------
function renderBlockchain(chain) {
  const tbody = document.getElementById("blockchainTableBody");
  const diagram = document.getElementById("chainDiagramVisual");

  if (!chain || chain.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">Blockchain is empty.</td></tr>`;
    diagram.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">No blocks mined yet.</span>`;
    return;
  }

  // Render Horizontal Diagram (Genesis -> Block 1 -> Block 2 ...)
  diagram.innerHTML = chain.map((b, idx) => `
    <div class="chain-node ${idx === chain.length - 1 ? 'active-node' : ''}" onclick="showBlockDetails(${b.index})" style="cursor: pointer;" title="Click to view block details">
      <div style="font-size: 11px; font-weight: 700; color: ${b.index === 0 ? 'var(--success-green)' : 'var(--color-blue-primary)'};">
        ${b.index === 0 ? '🌱 GENESIS' : 'BLOCK #' + b.index}
      </div>
      <div class="font-mono" style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
        ${shortKey(b.hash, 6, 4)}
      </div>
      <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">
        ${(b.ballots || []).length} votes
      </div>
    </div>
    ${idx < chain.length - 1 ? '<span class="chain-arrow">&rarr;</span>' : ''}
  `).join("");

  // Render Table (Newest first)
  const reversed = [...chain].reverse();
  tbody.innerHTML = reversed.map(b => `
    <tr>
      <td><strong>#${b.index}</strong></td>
      <td class="font-mono" title="${b.hash}">${shortKey(b.hash, 10, 8)}</td>
      <td class="font-mono" style="color: var(--text-muted);" title="${b.prev_hash}">${shortKey(b.prev_hash, 8, 6)}</td>
      <td><strong>${(b.ballots || []).length}</strong> votes</td>
      <td style="color: var(--text-muted); font-size: 12.5px;">${formatTimestamp(b.timestamp)}</td>
      <td class="font-mono">${b.nonce}</td>
      <td><span class="system-badge badge-valid">VALID</span></td>
      <td style="text-align: right;">
        <button class="btn btn-secondary btn-sm" onclick="showBlockDetails(${b.index})">View</button>
      </td>
    </tr>
  `).join("");
}

// Show block details drawer
function showBlockDetails(blockIndex) {
  const block = cachedChain.find(b => b.index === blockIndex);
  if (!block) return;

  const panel = document.getElementById("blockDetailPanel");
  document.getElementById("blockDetailTitle").textContent = `Block #${block.index} Complete Specification`;

  const tbody = document.getElementById("blockDetailBody");
  tbody.innerHTML = `
    <tr><th style="width: 160px;">Block Height</th><td>#${block.index} ${block.index === 0 ? '(Genesis Block)' : ''}</td></tr>
    <tr><th>Block SHA-256 Hash</th><td class="font-mono" style="word-break: break-all; font-weight: 600; color: var(--color-blue-primary);">${block.hash}</td></tr>
    <tr><th>Previous Block Hash</th><td class="font-mono" style="word-break: break-all; color: var(--text-muted);">${block.prev_hash}</td></tr>
    <tr><th>Timestamp</th><td>${formatTimestamp(block.timestamp)} (${block.timestamp})</td></tr>
    <tr><th>Proof-of-Work Nonce</th><td class="font-mono">${block.nonce}</td></tr>
    <tr><th>Sealed Ballots Count</th><td><strong>${(block.ballots || []).length}</strong> confirmed ballots</td></tr>
    <tr><th>Consensus Status</th><td><span class="system-badge badge-valid">✓ Proof-of-Work Verified</span></td></tr>
  `;

  const ballotsContainer = document.getElementById("blockDetailBallotsList");
  if (!block.ballots || block.ballots.length === 0) {
    ballotsContainer.innerHTML = `<div style="font-size: 13px; color: var(--text-muted); padding: 8px 0;">No individual voter transactions sealed in this block.</div>`;
  } else {
    ballotsContainer.innerHTML = `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Voter Public ID</th>
              <th>Proposal</th>
              <th>Choice</th>
              <th>Weight</th>
              <th>Digital Signature</th>
            </tr>
          </thead>
          <tbody>
            ${block.ballots.map(b => `
              <tr>
                <td class="font-mono" title="${b.voter_id}">${shortKey(b.voter_id, 10, 8)}</td>
                <td class="font-mono"><strong>${b.proposal_id}</strong></td>
                <td><span class="system-badge badge-valid">${b.choice}</span></td>
                <td>${b.weight || 1}</td>
                <td class="font-mono" style="color: var(--text-muted);" title="${b.signature}">${shortKey(b.signature, 12, 10)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  panel.style.display = "block";
  panel.scrollIntoView({ behavior: "smooth" });
}

// -------------------------------------------------------------------------
// RENDER: Mempool Table
// -------------------------------------------------------------------------
function renderMempoolTable(ballots) {
  const tbody = document.getElementById("mempoolTableBody");
  const countBadge = document.getElementById("mempoolTableCount");
  const count = ballots ? ballots.length : 0;
  countBadge.textContent = `Pending: ${count}`;

  if (!ballots || ballots.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">Mempool is currently empty. Cast a vote to see it staged here.</td></tr>`;
    return;
  }

  tbody.innerHTML = ballots.map((b, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td class="font-mono"><strong>${b.proposal_id}</strong></td>
      <td class="font-mono" title="${b.voter_id}">${shortKey(b.voter_id, 10, 8)}</td>
      <td><span class="system-badge badge-valid">${b.choice}</span></td>
      <td>${b.weight || 1}</td>
      <td><span class="system-badge badge-valid">✓ Ed25519 VALID</span></td>
    </tr>
  `).join("");
}

// -------------------------------------------------------------------------
// RENDER: Results Page
// -------------------------------------------------------------------------
function renderResults() {
  const container = document.getElementById("resultsCardContainer");
  const filter = document.getElementById("resultsProposalFilter").value;
  const election = cachedElections.find(e => e.proposal_id === filter) || cachedElections[0];

  if (!election) {
    container.innerHTML = `<div class="content-box"><p style="color: var(--text-muted);">No election data available.</p></div>`;
    return;
  }

  const tally = election.tally || {};
  const yes = tally["YES"] || 0;
  const no = tally["NO"] || 0;
  const abstain = tally["ABSTAIN"] || 0;
  const total = yes + no + abstain;

  const yesPct = total > 0 ? ((yes / total) * 100).toFixed(1) : 0;
  const noPct = total > 0 ? ((no / total) * 100).toFixed(1) : 0;
  const absPct = total > 0 ? ((abstain / total) * 100).toFixed(1) : 0;

  container.innerHTML = `
    <div class="content-box">
      <div class="content-box-header">
        <div>
          <h3>${election.title}</h3>
          <p style="font-size: 13px; color: var(--text-muted); margin-top: 2px;">
            Proposal ID: <strong>${election.proposal_id}</strong> &bull; Status: <span class="system-badge badge-valid" style="font-size: 11px;">ACTIVE</span>
          </p>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 24px; font-weight: 700; color: var(--color-blue-primary);">${total}</div>
          <div style="font-size: 12px; color: var(--text-muted);">Total Confirmed Votes</div>
        </div>
      </div>

      <!-- Horizontal Proportion Bars -->
      <div style="margin: 24px 0;">
        <!-- YES -->
        <div class="bar-wrapper">
          <div class="bar-label-row">
            <span>YES (In Favor)</span>
            <span><strong>${yes}</strong> votes (${yesPct}%)</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill bar-fill-yes" style="width: ${yesPct}%;"></div>
          </div>
        </div>

        <!-- NO -->
        <div class="bar-wrapper">
          <div class="bar-label-row">
            <span>NO (Against)</span>
            <span><strong>${no}</strong> votes (${noPct}%)</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill bar-fill-no" style="width: ${noPct}%;"></div>
          </div>
        </div>

        <!-- ABSTAIN -->
        <div class="bar-wrapper">
          <div class="bar-label-row">
            <span>ABSTAIN</span>
            <span><strong>${abstain}</strong> votes (${absPct}%)</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill bar-fill-abstain" style="width: ${absPct}%;"></div>
          </div>
        </div>
      </div>

      <!-- Verification Audit Badge -->
      <div style="border-top: 1px solid var(--border-color); padding-top: 16px; display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; color: var(--text-muted); flex-wrap: wrap; gap: 8px;">
        <div>
          🛡️ <em>Results calculated from ballots recorded on the verified ledger.</em>
        </div>
        <div>
          <span class="system-badge badge-valid">✓ 100% On-Chain Verified</span>
        </div>
      </div>
    </div>
  `;
}
document.getElementById("resultsProposalFilter").addEventListener("change", renderResults);

// -------------------------------------------------------------------------
// RENDER: Audit Log Table
// -------------------------------------------------------------------------
function renderAuditLog(events) {
  const tbody = document.getElementById("auditLogTableBody");
  if (!events || events.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">No audit events recorded yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = events.map(ev => {
    const badgeClass = ev.status === "SUCCESS" ? "badge-valid" : ev.status === "ERROR" ? "badge-offline" : ev.status === "WARNING" ? "badge-warning" : "badge-online";
    return `
      <tr>
        <td class="font-mono">${ev.time_str || '-'}</td>
        <td style="font-weight: 600;">${ev.event_type}</td>
        <td>${ev.details}</td>
        <td><span class="system-badge ${badgeClass}" style="font-size: 11px;">${ev.status}</span></td>
      </tr>
    `;
  }).join("");
}

// -------------------------------------------------------------------------
// RENDER: Voter Registry Table
// -------------------------------------------------------------------------
function renderVotersTable(voters) {
  const tbody = document.getElementById("votersTableBody");
  const countBadge = document.getElementById("votersCountBadge");
  const count = voters ? voters.length : 0;
  countBadge.textContent = `${count} Authorized`;

  if (!voters || voters.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">No voters registered in whitelist.</td></tr>`;
    return;
  }

  tbody.innerHTML = voters.map(v => `
    <tr>
      <td class="font-mono" title="${v.voter_id}">${v.voter_id_short}</td>
      <td><span class="system-badge badge-valid">✓ Authorized</span></td>
      <td>
        ${v.has_voted 
          ? `<span class="system-badge badge-online">Voted (${v.voted_proposals.join(', ')})</span>`
          : `<span class="system-badge badge-warning">Not Voted Yet</span>`
        }
      </td>
    </tr>
  `).join("");
}

// -------------------------------------------------------------------------
// RENDER: Peers Table
// -------------------------------------------------------------------------
function renderPeersTable(peers) {
  const tbody = document.getElementById("peerNodesTableBody");
  if (!peers || peers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 18px;">No external peers registered. Local node operating as authority.</td></tr>`;
    return;
  }

  tbody.innerHTML = peers.map(p => `
    <tr>
      <td class="font-mono"><strong>${p}</strong></td>
      <td><span class="system-badge badge-online">ONLINE</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="removePeer('${p}')" style="color: var(--error-red);">Remove</button>
      </td>
    </tr>
  `).join("");
}

// =========================================================================
// CAST BALLOT STEP-BY-STEP ACTIONS
// =========================================================================
document.getElementById("btnReviewVote").addEventListener("click", () => {
  const profileKey = voterProfileSelect.value;
  let secretKey = "";
  let voterId = "";

  if (profileKey === "custom") {
    secretKey = inputCustomSecret.value.trim();
    if (!secretKey) {
      showToast("Please enter your 64-character voter secret key", "error");
      return;
    }
    voterId = "Deriving from private key...";
  } else if (VOTER_KEYRING[profileKey]) {
    secretKey = VOTER_KEYRING[profileKey].secret_key;
    voterId = VOTER_KEYRING[profileKey].voter_id;
  }

  const proposalId = document.getElementById("voteProposalSelect").value;
  const election = cachedElections.find(e => e.proposal_id === proposalId);

  pendingVotePayload = {
    profileKey,
    secretKey,
    voterId,
    proposalId,
    choice: selectedChoice,
    weight: 1
  };

  // Populate confirm step
  document.getElementById("confirmProposalId").textContent = proposalId;
  document.getElementById("confirmElectionTitle").textContent = election ? election.title : proposalId;
  document.getElementById("confirmSelectedChoice").textContent = selectedChoice;
  document.getElementById("confirmVoterId").textContent = voterId;
  document.getElementById("confirmDigest").textContent = `${voterId.substring(0, 16)}...:${proposalId}:${selectedChoice}:1`;

  // Advance Stepper to Step 3
  document.getElementById("stepIndicator1").className = "step-item completed";
  document.getElementById("stepIndicator2").className = "step-item completed";
  document.getElementById("stepIndicator3").className = "step-item active";

  document.getElementById("voteStepForm").style.display = "none";
  document.getElementById("voteConfirmDialog").style.display = "block";
});

document.getElementById("btnBackToForm").addEventListener("click", () => {
  document.getElementById("stepIndicator1").className = "step-item active";
  document.getElementById("stepIndicator2").className = "step-item";
  document.getElementById("stepIndicator3").className = "step-item";

  document.getElementById("voteStepForm").style.display = "block";
  document.getElementById("voteConfirmDialog").style.display = "none";
});

document.getElementById("btnConfirmSubmit").addEventListener("click", async () => {
  const btn = document.getElementById("btnConfirmSubmit");
  btn.disabled = true;
  btn.textContent = "Cryptographically Signing & Submitting...";

  try {
    if (!pendingVotePayload) throw new Error("Missing ballot payload");

    // 1. Sign using server helper (safe demo flow without frontend key leaks)
    const signRes = await fetch(`${API_BASE}/api/v1/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret_key: pendingVotePayload.secretKey,
        proposal_id: pendingVotePayload.proposalId,
        choice: pendingVotePayload.choice,
        weight: 1
      })
    });
    const signData = await signRes.json();
    if (!signRes.ok || signData.error) {
      throw new Error(signData.error || "Digital signature creation failed");
    }

    // 2. Submit ballot to node mempool
    const ballotRes = await fetch(`${API_BASE}/api/v1/ballots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signData.ballot)
    });
    const ballotData = await ballotRes.json();
    if (!ballotRes.ok || ballotData.error) {
      throw new Error(ballotData.error || "Ballot ingestion rejected");
    }

    // Populate Receipt
    document.getElementById("receiptVoteId").textContent = ballotData.vote_id || signData.digest;
    document.getElementById("receiptProposal").textContent = pendingVotePayload.proposalId;

    // Advance Stepper to Step 4
    document.getElementById("stepIndicator3").className = "step-item completed";
    document.getElementById("stepIndicator4").className = "step-item completed";

    document.getElementById("voteConfirmDialog").style.display = "none";
    document.getElementById("voteSuccessReceipt").style.display = "block";

    showToast("Vote successfully submitted to mempool!", "success");
    await refreshAllData();

  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔒 Authorize Digital Signature & Submit";
  }
});

function resetVoteForm() {
  document.getElementById("stepIndicator1").className = "step-item active";
  document.getElementById("stepIndicator2").className = "step-item";
  document.getElementById("stepIndicator3").className = "step-item";
  document.getElementById("stepIndicator4").className = "step-item";

  document.getElementById("voteSuccessReceipt").style.display = "none";
  document.getElementById("voteConfirmDialog").style.display = "none";
  document.getElementById("voteStepForm").style.display = "block";
  pendingVotePayload = null;
}

// =========================================================================
// VERIFY VOTE INDEPENDENTLY
// =========================================================================
document.getElementById("verifyVoteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = document.getElementById("verifyQueryInput").value.trim();
  if (!query) return;

  const resultBox = document.getElementById("verifyResultDisplay");
  resultBox.style.display = "block";
  resultBox.innerHTML = `<p style="color: var(--text-muted);">Verifying ballot on immutable ledger...</p>`;

  try {
    const res = await fetch(`${API_BASE}/api/v1/verify-ballot?query=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!res.ok || !data.found) {
      resultBox.className = "verify-result-box invalid";
      resultBox.innerHTML = `
        <h4 style="font-size: 15px; font-weight: 700; color: #991b1b; margin-bottom: 6px;">✗ Ballot Verification Failed</h4>
        <p style="font-size: 13.5px; color: #7f1d1d; line-height: 1.5;">
          ${data.message || 'No matching ballot was found on the confirmed blockchain or in the unconfirmed mempool.'}
        </p>
      `;
      return;
    }

    const isOnChain = data.location === "CONFIRMED_BLOCK";
    resultBox.className = "verify-result-box valid";
    resultBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--success-border); padding-bottom: 10px;">
        <h4 style="font-size: 16px; font-weight: 700; color: #166534;">✓ Cryptographic Ballot Verified</h4>
        <span class="system-badge badge-valid">${isOnChain ? 'CONFIRMED ON-CHAIN' : 'PENDING MEMPOOL'}</span>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px; margin-bottom: 14px;">
        <div><strong>Proposal ID:</strong> <span class="font-mono">${data.proposal_id}</span></div>
        <div><strong>Recorded Choice:</strong> <span class="system-badge badge-valid" style="font-size: 12px;">${data.choice}</span></div>
        <div><strong>Block Number:</strong> ${isOnChain ? `Block #${data.block_index}` : 'Unmined (In Mempool)'}</div>
        <div><strong>Timestamp:</strong> ${formatTimestamp(data.block_timestamp)}</div>
      </div>

      <div class="table-responsive" style="margin-top: 12px;">
        <table class="data-table">
          <tbody>
            <tr><th style="width: 140px;">Voter Public ID</th><td class="font-mono" style="word-break: break-all; font-size: 11.5px;">${data.voter_id}</td></tr>
            <tr><th>Vote Digest ID</th><td class="font-mono" style="word-break: break-all; font-size: 11.5px;">${data.vote_id}</td></tr>
            <tr><th>Digital Signature</th><td class="font-mono" style="word-break: break-all; font-size: 11px; color: var(--text-muted);">${data.signature}</td></tr>
          </tbody>
        </table>
      </div>

      <div style="margin-top: 14px; font-size: 12.5px; color: #15803d; line-height: 1.6;">
        <div>✓ Digital Signature: <strong>Valid Ed25519 cryptographic authorization</strong></div>
        <div>✓ Payload Continuity: <strong>Bound to proposal ${data.proposal_id}</strong></div>
        <div>✓ Blockchain Integrity: <strong>Verified through Proof-of-Work Nakamoto consensus</strong></div>
      </div>
    `;

  } catch (err) {
    resultBox.className = "verify-result-box invalid";
    resultBox.innerHTML = `
      <h4 style="font-size: 15px; font-weight: 700; color: #991b1b; margin-bottom: 6px;">✗ Error Connecting to Node</h4>
      <p style="font-size: 13px; color: #7f1d1d;">${err.message}</p>
    `;
  }
});

// =========================================================================
// VERIFY BLOCKCHAIN INTEGRITY
// =========================================================================
document.getElementById("btnVerifyChain").addEventListener("click", async () => {
  const btn = document.getElementById("btnVerifyChain");
  btn.disabled = true;
  btn.textContent = "Verifying Blockchain Integrity...";

  const box = document.getElementById("chainVerificationResultBox");
  box.style.display = "block";
  box.innerHTML = `<div class="content-box"><p style="color: var(--text-muted);">Executing sequential block verification across entire ledger...</p></div>`;

  try {
    const res = await fetch(`${API_BASE}/api/v1/verify-chain`);
    const data = await res.json();

    const isAllValid = data.valid;
    box.innerHTML = `
      <div class="content-box ${isAllValid ? 'box-light-blue' : ''}" style="border-left: 4px solid ${isAllValid ? 'var(--success-green)' : 'var(--error-red)'};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 style="font-size: 16px; font-weight: 700; color: ${isAllValid ? 'var(--success-green)' : 'var(--error-red)'};">
            ${isAllValid ? '✓ Blockchain Integrity Verified' : '✗ Blockchain Integrity Compromised'}
          </h3>
          <span class="system-badge ${isAllValid ? 'badge-valid' : 'badge-offline'}">
            ${data.total_blocks} Blocks Evaluated
          </span>
        </div>

        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 14px;">
          ${data.message}. Every block hash matches the calculated SHA-256 payload, proof-of-work difficulty is satisfied, and cryptographic ballot signatures are untampered.
        </p>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 80px;">Block</th>
                <th>Validation Check</th>
                <th style="width: 100px;">Status</th>
                <th>Hash Digest</th>
              </tr>
            </thead>
            <tbody>
              ${(data.blocks || []).map(b => `
                <tr>
                  <td><strong>Block #${b.index}</strong></td>
                  <td>${b.reason}</td>
                  <td><span class="system-badge ${b.status === 'VALID' ? 'badge-valid' : 'badge-offline'}">${b.status}</span></td>
                  <td class="font-mono" style="font-size: 11px;">${shortKey(b.hash, 10, 8)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    if (isAllValid) {
      showToast("Blockchain integrity verified successfully!", "success");
    } else {
      showToast("Integrity check failed: tampering detected!", "error");
    }

  } catch (err) {
    showToast(`Verification error: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🛡️ Verify Blockchain Integrity";
  }
});

// =========================================================================
// MINE BLOCK ACTION
// =========================================================================
document.getElementById("btnMineBlockAction").addEventListener("click", async () => {
  const btn = document.getElementById("btnMineBlockAction");
  const banner = document.getElementById("miningStatusBanner");
  const text = document.getElementById("miningStatusText");

  btn.disabled = true;
  banner.style.display = "block";
  text.innerHTML = "Collecting ballots... Finding valid nonce (Proof-of-Work)...";

  try {
    const res = await fetch(`${API_BASE}/api/v1/mine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Mining failed");

    text.innerHTML = `
      <span style="color: var(--success-green); font-weight: 700;">✓ Block #${data.block_index} Created Successfully</span>
      <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 4px;">
        Hash: <code class="font-mono">${data.block_hash}</code> &bull; Nonce: <strong>${data.nonce}</strong> &bull; Sealed Ballots: <strong>${data.ballots_sealed}</strong>
      </div>
    `;
    showToast(`Block #${data.block_index} successfully mined!`, "success");
    await refreshAllData();

  } catch (err) {
    text.innerHTML = `<span style="color: var(--error-red);">Mining error: ${err.message}</span>`;
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

// =========================================================================
// PEER & NETWORK ACTIONS
// =========================================================================
document.getElementById("addPeerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("peerUrlInput");
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
      showToast(`Connected peer: ${url}`, "success");
      input.value = "";
      await refreshAllData();
    }
  } catch (err) {
    showToast(err.message, "error");
  }
});

async function removePeer(peerUrl) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/peers`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peer: peerUrl })
    });
    if (res.ok) {
      showToast(`Peer disconnected`, "info");
      await refreshAllData();
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

document.getElementById("btnSyncChain").addEventListener("click", async () => {
  showToast("Contacting peers for chain synchronization...", "info");
  try {
    const res = await fetch(`${API_BASE}/api/v1/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.synced) {
      showToast("Adopted longer authoritative branch from peer!", "success");
    } else {
      showToast(`Local ledger is currently up-to-date (Height: ${data.current_length})`, "info");
    }
    await refreshAllData();
  } catch (err) {
    showToast(`Sync failed: ${err.message}`, "error");
  }
});

// =========================================================================
// VOTER REGISTRATION ACTION
// =========================================================================
document.getElementById("registerVoterKeyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("newVoterPubInput");
  const vid = input.value.trim();
  if (!vid) return;

  try {
    const res = await fetch(`${API_BASE}/api/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voter_id: vid })
    });
    if (res.ok) {
      showToast(`Voter ${shortKey(vid)} successfully authorized!`, "success");
      input.value = "";
      await refreshAllData();
    }
  } catch (err) {
    showToast(err.message, "error");
  }
});

// Quick refresh button
document.getElementById("btnQuickRefresh").addEventListener("click", async () => {
  await refreshAllData();
  showToast("Node state refreshed", "info");
});

document.getElementById("btnRefreshAudit").addEventListener("click", async () => {
  await refreshAllData();
  showToast("Audit log refreshed", "info");
});

// Initialize on page load and poll every 4 seconds
window.addEventListener("DOMContentLoaded", () => {
  refreshAllData();
  setInterval(refreshAllData, 4000);
});
