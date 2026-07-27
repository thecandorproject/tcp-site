// Page-level config only — everything else on this page comes from the
// Hedera mirror node at request time. Updated to "mainnet" + the mainnet
// topic ID at cutover. Keep in sync with tcp-site/documents/documents.js —
// same topic, same network.
const CONFIG = {
  network: "testnet",
  topicId: "0.0.9763239",
};

const MIRROR_BASE =
  CONFIG.network === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

const ICON_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

const PLACEHOLDER_COMMENT = "Summary coming soon.";

function entryKey(document, version) {
  return `${document}-${version}`;
}

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

// UTC explicitly — these timestamps are deliberately UTC (matching Hedera's
// own consensus timestamps), so formatting in the viewer's local timezone
// could shift an early-UTC-morning date back a calendar day.
function formatDate(date) {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatConsensusTimestamp(consensusTimestamp) {
  const seconds = Number.parseFloat(consensusTimestamp);
  return formatDate(new Date(seconds * 1000));
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

function renderEntry(entry, metadata) {
  const row = document.createElement("div");
  row.className = "changelog-row";

  const key = entryKey(entry.document, entry.version);
  row.id = key;

  const versionMeta = metadata.versions[key];
  const comment = versionMeta?.comment ?? PLACEHOLDER_COMMENT;
  const changeTypeClass = entry.changeType === "Addition" ? "addition" : "revision";

  const historicalDate = versionMeta?.historicalDate;
  const dateLabel = historicalDate
    ? `Published ${formatDate(new Date(historicalDate))} · anchored ${formatConsensusTimestamp(entry.consensusTimestamp)}`
    : formatConsensusTimestamp(entry.consensusTimestamp);

  row.innerHTML = `
    <div class="changelog-row-header">
      <span class="change-type ${changeTypeClass}">${entry.changeType}</span>
      <span class="changelog-row-title">${metadata.documents[entry.document].label} — Version ${entry.version}</span>
      <span class="changelog-row-date">${dateLabel}</span>
    </div>
    <p class="change-desc">${comment}</p>
    <div class="verify-row">
      <span class="verify-hash">${entry.sha256}</span>
    </div>
    <div class="verify-links">
      <a href="https://ipfs.io/ipfs/${entry.ipfs_cid}" target="_blank" rel="noopener">View on IPFS</a>
      <a href="${entry.hashScanUrl}" target="_blank" rel="noopener">View on Hedera</a>
    </div>
  `;

  const copyBtn = document.createElement("button");
  copyBtn.className = "verify-copy-btn";
  copyBtn.innerHTML = ICON_COPY;
  copyBtn.setAttribute("aria-label", "Copy hash");
  copyBtn.title = "Copy hash";
  copyBtn.addEventListener("click", () => copyToClipboard(entry.sha256, copyBtn));
  row.querySelector(".verify-row").appendChild(copyBtn);

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
    const [metadata, rawMessages] = await Promise.all([
      fetch("/document-metadata.json").then((res) => res.json()),
      fetchAllMessages(CONFIG.topicId),
    ]);
    const timeline = buildTimeline(rawMessages);

    statusEl.remove();
    for (const entry of timeline) {
      listEl.appendChild(renderEntry(entry, metadata));
    }

    // Rows are inserted after this async fetch resolves, so the browser's
    // native scroll-to-#hash (which only fires once, on initial navigation)
    // misses them — the target doesn't exist yet at that point. Do it
    // ourselves once the real content is in the DOM.
    if (location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Could not reach the Hedera mirror node right now. Try refreshing in a moment.";
  }
}

main();
