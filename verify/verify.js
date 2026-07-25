// Page-level config only — everything else on this page comes from the
// Hedera mirror node at request time. Updated to "mainnet" + the mainnet
// topic ID at cutover.
const CONFIG = {
  network: "testnet",
  topicId: "0.0.9695525",
};

const MIRROR_BASE =
  CONFIG.network === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

const ICON_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

const DOCUMENT_ORDER = ["white-paper", "methodology", "explainer", "one-pager"];
const DOCUMENT_LABELS = {
  "white-paper": "White Paper",
  methodology: "Methodology and Evidentiary Standards",
  explainer: "Public Explainer",
  "one-pager": "One-Pager",
};

async function fetchAllMessages(topicId) {
  const messages = [];
  let url = `${MIRROR_BASE}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Mirror node returned ${res.status} for ${url}`);
    }
    const data = await res.json();
    messages.push(...data.messages);
    url = data.links && data.links.next ? `${MIRROR_BASE}${data.links.next}` : null;
  }

  return messages;
}

function base64ToUtf8(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function hashScanTxUrl(chunkInfo) {
  const { account_id, transaction_valid_start } = chunkInfo.initial_transaction_id;
  const [seconds, nanos] = transaction_valid_start.split(".");
  return `https://hashscan.io/${CONFIG.network}/transaction/${account_id}-${seconds}-${nanos}`;
}

function formatConsensusTimestamp(consensusTimestamp) {
  const seconds = Number.parseFloat(consensusTimestamp);
  return new Date(seconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Groups raw mirror node messages by document, newest first per document.
function groupByDocument(rawMessages) {
  const groups = {};

  for (const raw of rawMessages) {
    const payload = JSON.parse(base64ToUtf8(raw.message));
    const entry = {
      ...payload,
      consensusTimestamp: raw.consensus_timestamp,
      hashScanUrl: hashScanTxUrl(raw.chunk_info),
    };
    (groups[payload.document] ??= []).push(entry);
  }

  for (const document in groups) {
    groups[document].sort((a, b) => b.consensusTimestamp.localeCompare(a.consensusTimestamp));
  }

  return groups;
}

function copyToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    button.innerHTML = ICON_CHECK;
    button.setAttribute("aria-label", "Copied");
    setTimeout(() => {
      button.innerHTML = ICON_COPY;
      button.setAttribute("aria-label", "Copy hash");
    }, 1500);
  });
}

function renderHistoryItem(entry) {
  const item = document.createElement("div");
  item.className = "verify-history-item";
  item.innerHTML = `
    <div class="verify-row">
      <span class="verify-row-label">Version ${entry.version}</span>
      <span class="verify-row-label">·</span>
      <span class="verify-row-label">${formatConsensusTimestamp(entry.consensusTimestamp)}</span>
    </div>
    <div class="verify-row">
      <span class="verify-hash">${entry.sha256}</span>
    </div>
    <div class="verify-links">
      <a href="https://ipfs.io/ipfs/${entry.ipfs_cid}" target="_blank" rel="noopener">View on IPFS</a>
      <a href="${entry.hashScanUrl}" target="_blank" rel="noopener">View on Hedera</a>
    </div>
  `;
  return item;
}

function renderDocumentCard(documentName, entries) {
  const card = document.createElement("div");
  card.className = "verify-doc-card";

  if (!entries || entries.length === 0) {
    card.innerHTML = `
      <div class="verify-doc-header">
        <span class="verify-doc-title">${DOCUMENT_LABELS[documentName]}</span>
      </div>
      <p class="verify-doc-unanchored">Not yet anchored.</p>
    `;
    return card;
  }

  const [current, ...history] = entries;

  const header = document.createElement("div");
  header.className = "verify-doc-header";
  header.innerHTML = `
    <span class="verify-doc-title">${DOCUMENT_LABELS[documentName]}</span>
    <span class="verify-doc-version">Version ${current.version}</span>
  `;
  card.appendChild(header);

  const hashRow = document.createElement("div");
  hashRow.className = "verify-row";
  hashRow.innerHTML = `<span class="verify-hash">${current.sha256}</span>`;
  const copyBtn = document.createElement("button");
  copyBtn.className = "verify-copy-btn";
  copyBtn.innerHTML = ICON_COPY;
  copyBtn.setAttribute("aria-label", "Copy hash");
  copyBtn.title = "Copy hash";
  copyBtn.addEventListener("click", () => copyToClipboard(current.sha256, copyBtn));
  hashRow.appendChild(copyBtn);
  card.appendChild(hashRow);

  const links = document.createElement("div");
  links.className = "verify-links";
  links.innerHTML = `
    <a href="https://ipfs.io/ipfs/${current.ipfs_cid}" target="_blank" rel="noopener">View on IPFS</a>
    <a href="${current.hashScanUrl}" target="_blank" rel="noopener">View on Hedera</a>
    <a href="${current.source_url}" target="_blank" rel="noopener">Download PDF</a>
  `;
  card.appendChild(links);

  const instructions = document.createElement("p");
  instructions.className = "verify-instructions";
  instructions.innerHTML = `Download the PDF, run <code>shasum -a 256 filename.pdf</code>, and compare the result to the hash above. If they match, this is exactly what was anchored on ${formatConsensusTimestamp(current.consensusTimestamp)}.`;
  card.appendChild(instructions);

  if (history.length > 0) {
    const details = document.createElement("details");
    details.className = "verify-history";
    const summary = document.createElement("summary");
    summary.textContent = `Version history (${history.length} earlier ${history.length === 1 ? "entry" : "entries"})`;
    details.appendChild(summary);
    for (const entry of history) {
      details.appendChild(renderHistoryItem(entry));
    }
    card.appendChild(details);
  }

  return card;
}

async function main() {
  const statusEl = document.getElementById("verify-status");
  const listEl = document.getElementById("verify-doc-list");
  const bannerEl = document.getElementById("verify-banner");

  if (CONFIG.network !== "mainnet") {
    bannerEl.hidden = false;
  }

  try {
    const rawMessages = await fetchAllMessages(CONFIG.topicId);
    const groups = groupByDocument(rawMessages);

    statusEl.remove();
    for (const documentName of DOCUMENT_ORDER) {
      listEl.appendChild(renderDocumentCard(documentName, groups[documentName]));
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Could not reach the Hedera mirror node right now. Try refreshing in a moment.";
  }
}

main();
