// Page-level config only — everything else on this page comes from the
// Hedera mirror node at request time. Updated to "mainnet" + the mainnet
// topic ID at cutover. Keep in sync with tcp-site/documents/documents.js —
// same topic, same network.
// topicId must stay in this repo's tracked source — it's the only place
// this system stays discoverable if it's ever challenged, since it isn't
// documented anywhere else on the site.
const CONFIG = {
  network: "mainnet",
  topicId: "0.0.10788409",
};

const MIRROR_BASE =
  CONFIG.network === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

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

// The real publish date for a version: its historical/nominal date if it
// was backfilled (backfill's anchor date is just "when the backfill script
// ran," not a real publish date), otherwise the anchor date itself, which
// for anything anchored through the normal watcher flow *is* the real
// publish date. Anchor dates themselves are never shown — see documents.js
// for the same logic.
function publishDate(entry, metadata) {
  const key = entryKey(entry.document, entry.version);
  const historical = metadata.versions[key]?.historicalDate;
  return historical ? formatDate(new Date(historical)) : formatConsensusTimestamp(entry.consensusTimestamp);
}

// Flattens raw mirror node messages into one timeline, newest anchor first,
// with each entry's change type (Addition/Revision) inferred by comparing
// it to the prior version of the same document — not stored on-chain.
// isLatest marks the current version of its document, so rendering can
// offer a direct download there and an archived-copy link everywhere else.
function buildTimeline(rawMessages) {
  const entries = rawMessages.map((raw) => {
    const payload = JSON.parse(base64ToUtf8(raw.message));
    return {
      ...payload,
      consensusTimestamp: raw.consensus_timestamp,
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
      entry.isLatest = i === group.length - 1;
    });
  }

  entries.sort((a, b) => b.consensusTimestamp.localeCompare(a.consensusTimestamp));
  return entries;
}

function copyChecksum(hash, button) {
  navigator.clipboard.writeText(hash).then(() => {
    button.textContent = hash;
    button.classList.add("revealed");

    let badge = button.nextElementSibling;
    if (!badge?.classList.contains("copied-badge")) {
      badge = document.createElement("span");
      badge.className = "copied-badge";
      badge.textContent = "Copied";
      button.insertAdjacentElement("afterend", badge);
    }

    clearTimeout(badge._hideTimeout);
    badge.classList.remove("visible");
    void badge.offsetWidth; // restart the fade-in transition on repeat clicks
    badge.classList.add("visible");
    badge._hideTimeout = setTimeout(() => badge.classList.remove("visible"), 1500);
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

  const versionLink = entry.isLatest
    ? `<a href="${entry.source_url}" target="_blank" rel="noopener">Download</a>`
    : `<a href="https://ipfs.io/ipfs/${entry.ipfs_cid}" target="_blank" rel="noopener">View archived copy</a>`;

  row.innerHTML = `
    <div class="changelog-row-header">
      <span class="change-type ${changeTypeClass}">${entry.changeType}</span>
      <span class="changelog-row-title">${metadata.documents[entry.document].label} — Version ${entry.version}</span>
      <span class="changelog-row-date">Published ${publishDate(entry, metadata)}</span>
    </div>
    <p class="change-desc">${comment}</p>
    <div class="verify-row">
      ${versionLink}
      <span class="checksum-wrap">
        <button class="checksum-link" type="button">Checksum</button>
      </span>
    </div>
  `;

  row.querySelector(".checksum-link").addEventListener("click", (e) => copyChecksum(entry.sha256, e.target));

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
      "Could not load the changelog right now. Try refreshing in a moment.";
  }
}

main();
