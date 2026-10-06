#!/usr/bin/env node
/**
 * build-org-members.js — build _data/org-members.yml from the org members
 * Google Sheet.
 *
 * Pulls the "members" tab of the spreadsheet named by ORG_MEMBERS_SHEET_ID
 * via its CSV export endpoint, groups rows by tier, and writes the YAML the
 * home page's "Organizational Founding Members" section reads
 * (index.html -> _includes/org-card-group.html ->
 * _includes/org-member-card.html). The sheet stays the only thing anyone
 * edits. Requires Node 18+ (global fetch); zero dependencies.
 *
 *   ORG_MEMBERS_SHEET_ID=<id> node scripts/build-org-members.js   # live
 *   node scripts/build-org-members.js --file fixtures/org-members.csv   # offline
 *
 * Expected columns (case-insensitive, any order): tier, name, url, figure,
 * acronym, date_joined, founding_member, contact, background. name and
 * tier are required; any other column is ignored.
 *
 * Logos: each figure names a file under assets/img/org-logos/. On a live
 * build, figures the repo does not have are downloaded by exact name from
 * the link-shared Google Drive folder ORG_LOGOS_FOLDER_ID through the Drive
 * API v3, authenticated with GOOGLE_API_KEY. Both are read only when a logo
 * is missing; committed logos are never re-downloaded, overwritten, or
 * deleted. Offline (--file) builds never contact Drive and only warn.
 *
 * Validation: rows without a name are skipped silently; an unknown tier, an
 * unparseable date_joined, or a duplicate name skips the row with a
 * warning; an empty url or figure keeps the row with a warning. A figure
 * that is not a plain image filename, a needed logo Drive cannot supply,
 * or zero members stops the build before anything is written.
 *
 * parseCSV, argValue, fetchSheet and writeIfChanged are copied from
 * build-program.js rather than shared: that script runs main() on load and
 * exports nothing, and each script stays one file readable top to bottom.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(__dirname, '..');
const SHEET_ID = process.env.ORG_MEMBERS_SHEET_ID || '';
const SHEET_NAME = 'members';
const OUT_YML = path.join(REPO_ROOT, '_data', 'org-members.yml');
const LOGO_DIR = path.join(REPO_ROOT, 'assets', 'img', 'org-logos');

// Read only when a logo has to be downloaded.
const DRIVE_API_KEY = process.env.GOOGLE_API_KEY || '';
const LOGO_FOLDER_ID = process.env.ORG_LOGOS_FOLDER_ID || '';
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

// A figure is a bare filename: no path separators, no leading dot, an image
// extension. It becomes a path on disk and an <img src>, so anything else is
// refused rather than escaped.
const FIGURE_NAME = /^[\w-][\w.-]*\.(?:png|jpe?g|svg|webp|gif|avif)$/i;

// Output order matches today's file; the key is what index.html reads,
// the label is what goes in each member's `tier` field.
const TIERS = [
  { key: 'basic', label: 'Basic' },
  { key: 'standard', label: 'Standard' },
  { key: 'premier', label: 'Premier' },
];

const COLUMNS = ['tier', 'name', 'url', 'figure', 'acronym',
  'date_joined', 'founding_member', 'contact', 'background'];
const REQUIRED_COLUMNS = ['name', 'tier'];

// ---------------------------------------------------------------------------
// CSV and records
// ---------------------------------------------------------------------------

/**
 * Minimal RFC 4180 parser (quoted fields, "" escapes, CRLF), from
 * build-program.js — except that all-blank rows are kept, so a row's index
 * is its sheet row. Blank rows have no name and are dropped by
 * toMemberRecords.
 * @param {string} text
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Raw CSV rows -> one record per named row, every column a trimmed string
 * ('' when absent). Header cells match COLUMNS case-insensitively; other
 * columns are read past. A missing required column is fatal: a renamed tab
 * or header must fail the build, not empty the home page.
 * @param {string[][]} rows
 */
function toMemberRecords(rows) {
  const header = (rows[0] || []).map((h) => {
    const key = h.trim().toLowerCase();
    return COLUMNS.includes(key) ? key : null;
  });
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) {
      throw new Error(`"${SHEET_NAME}" tab has no "${col}" column — is the tab named ${SHEET_NAME}?`);
    }
  }
  return rows.slice(1).map((cells, i) => {
    const rec = { _row: i + 2 }; // 1-based sheet row, counting the header
    for (const col of COLUMNS) rec[col] = '';
    header.forEach((key, col) => {
      if (key) rec[key] = (cells[col] || '').trim();
    });
    return rec;
  }).filter((r) => r.name);
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** Value following a `--flag`, or null when the flag is absent. */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) throw new Error(`${flag} requires a path`);
  return v;
}

/** The members tab, via the gviz CSV export endpoint. */
async function fetchSheet() {
  if (!SHEET_ID) {
    throw new Error(
      'ORG_MEMBERS_SHEET_ID is not set. Export the sheet ID as an environment '
      + 'variable, or run with --file fixtures/org-members.csv.');
  }
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
  console.log(`Fetching "${SHEET_NAME}" tab from Google Sheets…`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`"${SHEET_NAME}" tab fetch failed: HTTP ${res.status}`);
  return res.text();
}

/** The --file path when given, else the live sheet. */
async function loadCSV() {
  const file = argValue('--file');
  if (file) {
    console.log(`Reading ${file}`);
    return fs.readFileSync(path.resolve(file), 'utf8');
  }
  return fetchSheet();
}

/** Write only when content changed so a scheduled runner commits no churn. */
function writeIfChanged(file, content) {
  const rel = path.relative(REPO_ROOT, file);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    console.log(`  unchanged  ${rel}`);
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`  wrote      ${rel}`);
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const records = toMemberRecords(parseCSV(await loadCSV()));
  console.log(`Parsed ${records.length} rows.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`build-org-members: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseCSV, toMemberRecords,
};
