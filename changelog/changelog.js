// Page-level config only — everything else on this page comes from the
// Hedera mirror node at request time. Updated to "mainnet" + the mainnet
// topic ID at cutover. Keep in sync with tcp-site/verify/verify.js — same
// topic, same network.
const CONFIG = {
  network: "testnet",
  topicId: "0.0.9763239",
};

const MIRROR_BASE =
  CONFIG.network === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

const DOCUMENT_LABELS = {
  "white-paper": "White Paper",
  methodology: "Methodology and Evidentiary Standards",
  explainer: "Public Explainer",
  "one-pager": "One-Pager",
};

// Human-written rationale for each document-version, kept off-chain and out
// of the HCS schema on purpose. Entries anchored before their comment is
// written fall back to a placeholder.
const COMMENT_MAP = {
  // "white-paper-1.1": "Why this change was made.",
};
const PLACEHOLDER_COMMENT = "Summary coming soon.";

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

// Flattens raw mirror node messages into one timeline, newest anchor first,
// with each entry's change type (Addition/Revision) inferred by comparing
// it to the prior version of the same document — not stored on-chain.
function buildTimeline(rawMessages) {
  const entries = rawMessages.map((raw) => {
    const payload = JSON.parse(base64ToUtf8(raw.message));
    return {
      ...payload,
      consensusTimestamp: raw.consensus_timestamp,
      hashScanUrl: hashScanTxUrl(raw.chunk_info),
    };
  });

  const byDocument = {};
  for (const entry of entries) {
    (byDocument[entry.document] ??= []).push(entry);
  }

  for (const document in byDocument) {
    const group = byDocument[document];
    group.sort((a, b) => a.consensusTimestamp.localeCompare(b.consensusTimestamp));
    group.forEach((entry, i) => {
      entry.changeType = i === 0 ? "Addition" : "Revision";
    });
  }

  entries.sort((a, b) => b.consensusTimestamp.localeCompare(a.consensusTimestamp));
  return entries;
}

function renderEntry(entry) {
  const row = document.createElement("div");
  row.className = "changelog-row";

  const comment = COMMENT_MAP[`${entry.document}-${entry.version}`] ?? PLACEHOLDER_COMMENT;
  const changeTypeClass = entry.changeType === "Addition" ? "addition" : "revision";

  row.innerHTML = `
    <div class="changelog-row-header">
      <span class="change-type ${changeTypeClass}">${entry.changeType}</span>
      <span class="changelog-row-title">${DOCUMENT_LABELS[entry.document]} — Version ${entry.version}</span>
      <span class="changelog-row-date">${formatConsensusTimestamp(entry.consensusTimestamp)}</span>
    </div>
    <p class="change-desc">${comment}</p>
    <div class="verify-links">
      <a href="https://ipfs.io/ipfs/${entry.ipfs_cid}" target="_blank" rel="noopener">View on IPFS</a>
      <a href="${entry.hashScanUrl}" target="_blank" rel="noopener">View on Hedera</a>
      <a href="${entry.source_url}" target="_blank" rel="noopener">Download PDF</a>
    </div>
  `;
  return row;
}

async function main() {
  const statusEl = document.getElementById("changelog-status");
  const listEl = document.getElementById("changelog-list");
  const bannerEl = document.getElementById("changelog-banner");

  if (CONFIG.network !== "mainnet") {
    bannerEl.hidden = false;
  }

  try {
    const rawMessages = await fetchAllMessages(CONFIG.topicId);
    const timeline = buildTimeline(rawMessages);

    statusEl.remove();
    for (const entry of timeline) {
      listEl.appendChild(renderEntry(entry));
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Could not reach the Hedera mirror node right now. Try refreshing in a moment.";
  }
}

main();
