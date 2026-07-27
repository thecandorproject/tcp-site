// Page-level config only — everything else on this page comes from the
// Hedera mirror node at request time. Updated to "mainnet" + the mainnet
// topic ID at cutover.
// topicId must stay in this repo's tracked source — it's the only place
// this system stays discoverable if it's ever challenged, since it isn't
// documented anywhere else on the site.
const CONFIG = {
  network: "testnet",
  topicId: "0.0.9763239",
};

const MIRROR_BASE =
  CONFIG.network === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

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

function changelogUrl(entry) {
  return `/changelog#${entry.document}-${entry.version}`;
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

// The real publish date for the current version: its historical/nominal
// date if it was backfilled (backfill's anchor date is just "when the
// backfill script ran," not a real publish date), otherwise the anchor
// date itself, which for anything anchored through the normal watcher flow
// *is* the real publish date.
function publishDate(entry, metadata) {
  const historical = metadata.versions[`${entry.document}-${entry.version}`]?.historicalDate;
  return historical ? formatDate(new Date(historical)) : formatConsensusTimestamp(entry.consensusTimestamp);
}

// Keeps only the most recent entry per document — this page shows current
// versions only; full version history (with hashes and integrity proof)
// lives on /changelog.
function latestByDocument(rawMessages) {
  const latest = {};

  for (const raw of rawMessages) {
    const payload = JSON.parse(base64ToUtf8(raw.message));
    const entry = { ...payload, consensusTimestamp: raw.consensus_timestamp };
    const current = latest[payload.document];
    if (!current || entry.consensusTimestamp.localeCompare(current.consensusTimestamp) > 0) {
      latest[payload.document] = entry;
    }
  }

  return latest;
}

function renderDocumentCard(documentName, entry, metadata) {
  const card = document.createElement("div");
  card.className = "verify-doc-card";

  const docMeta = metadata.documents[documentName];

  if (!entry) {
    card.innerHTML = `
      <div class="verify-doc-header">
        <span class="verify-doc-title">${docMeta.label}</span>
      </div>
      <p class="doc-desc">${docMeta.description}</p>
      <p class="verify-doc-unanchored">Not yet available.</p>
    `;
    return card;
  }

  card.innerHTML = `
    <div class="verify-doc-header">
      <span class="verify-doc-title">${docMeta.label}</span>
      <span class="verify-doc-version">Version ${entry.version}</span>
    </div>
    <p class="doc-desc">${docMeta.description}</p>
    <div class="verify-row">
      <span class="verify-row-label">Published ${publishDate(entry, metadata)}</span>
    </div>
    <div class="verify-links">
      <a href="${entry.source_url}" target="_blank" rel="noopener">View PDF</a>
      <a href="${changelogUrl(entry)}">View in changelog</a>
    </div>
  `;
  return card;
}

async function main() {
  const statusEl = document.getElementById("documents-status");
  const listEl = document.getElementById("documents-list");

  try {
    const [metadata, rawMessages] = await Promise.all([
      fetch("/document-metadata.json").then((res) => res.json()),
      fetchAllMessages(CONFIG.topicId),
    ]);
    const latest = latestByDocument(rawMessages);

    statusEl.remove();
    for (const documentName of metadata.documentOrder) {
      listEl.appendChild(renderDocumentCard(documentName, latest[documentName], metadata));
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Could not load the current versions right now. Try refreshing in a moment.";
  }
}

main();
