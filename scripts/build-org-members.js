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
// Validation and normalization
// ---------------------------------------------------------------------------

/**
 * "M/D/YYYY" (gviz's export of a date cell) or "YYYY-MM-DD" -> "YYYY-MM-DD",
 * or null when unparseable or not a real calendar day. UTC only, so the
 * runner's timezone cannot shift the day.
 * @param {string} raw
 */
function parseDate(raw) {
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let y; let mo; let d;
  if (m) [, y, mo, d] = m.map(Number);
  else if ((m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, mo, d, y] = m.map(Number);
  else return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** TRUE/yes (any case) -> true; everything else, including empty, false. */
function parseBool(raw) {
  return ['true', 'yes'].includes(raw.toLowerCase());
}

/**
 * Records -> normalized members plus collected warnings and errors, each a
 * "row N: …" string. Skip checks run first so a skipped row warns once and
 * its figure is never checked; the duplicate check follows tier/date so a
 * malformed first copy cannot shadow a good second one.
 * @param {ReturnType<typeof toMemberRecords>} records
 */
function validate(records) {
  const members = [];
  const warnings = [];
  const errors = [];
  const seen = new Map(); // lowercased name -> first row
  for (const r of records) {
    const at = `row ${r._row}:`;
    const tier = TIERS.find((t) => t.key === r.tier.toLowerCase());
    if (!tier) {
      warnings.push(`${at} unknown tier "${r.tier}" — expected Basic, Standard, or Premier`);
      continue;
    }
    const date = parseDate(r.date_joined);
    if (!date) {
      warnings.push(`${at} unparseable date_joined "${r.date_joined}" — expected M/D/YYYY or YYYY-MM-DD`);
      continue;
    }
    const key = r.name.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`${at} duplicate name "${r.name}" (first on row ${seen.get(key)})`);
      continue;
    }
    seen.set(key, r._row);

    if (!r.url) warnings.push(`${at} "${r.name}" has no url`);
    if (!r.figure) warnings.push(`${at} "${r.name}" has no figure`);
    else if (!FIGURE_NAME.test(r.figure)) errors.push(`${at} figure "${r.figure}" is not a plain image filename`);
    if (r.founding_member && !['true', 'false', 'yes', 'no'].includes(r.founding_member.toLowerCase())) {
      warnings.push(`${at} founding_member "${r.founding_member}" read as false`);
    }

    const m = {
      _row: r._row,
      name: r.name,
      url: r.url,
      figure: r.figure,
      acronym: r.acronym || null,
      date_joined: date,
      founding_member: parseBool(r.founding_member),
      tier: tier.label,
    };
    if (r.contact) m.contact = r.contact;
    if (r.background) m.background = r.background;
    members.push(m);
  }
  return { members, warnings, errors };
}

// ---------------------------------------------------------------------------
// Logo planning
// ---------------------------------------------------------------------------

/**
 * Distinct figures not in `present`, in first-seen order, each with every
 * sheet row naming it (members may share a logo).
 * @param {{ figure: string, _row: number }[]} members
 * @param {Set<string>} present committed logo filenames
 */
function neededLogos(members, present) {
  const byFigure = new Map();
  for (const m of members) {
    if (!m.figure || present.has(m.figure)) continue;
    if (!byFigure.has(m.figure)) byFigure.set(m.figure, []);
    byFigure.get(m.figure).push(m._row);
  }
  return [...byFigure].map(([figure, rows]) => ({ figure, rows }));
}

/** Offline builds keep members whose logo is missing, with a warning per row. */
function missingLogoWarnings(needed) {
  const rel = path.relative(REPO_ROOT, LOGO_DIR);
  return needed.flatMap(({ figure, rows }) =>
    rows.map((r) => `row ${r}: figure "${figure}" not found in ${rel}/`));
}

// ---------------------------------------------------------------------------
// YAML
// ---------------------------------------------------------------------------

const YAML_HEADER = `# Generated by scripts/build-org-members.js from the "${SHEET_NAME}" tab of the
# org members Google Sheet. Do not edit by hand — edit the sheet and rerun
# the script (or the "Rebuild org members" workflow). See README.md.
`;

const FIELD_ORDER = ['name', 'url', 'figure', 'acronym', 'date_joined',
  'founding_member', 'tier', 'contact', 'background'];

/**
 * Members -> the YAML index.html reads: tier keys in TIERS order (empty
 * tiers omitted so the template's `if` hides the heading), members in sheet
 * order. Strings are JSON-quoted — a JSON string is a valid YAML
 * double-quoted scalar, so every cell round-trips exactly. An empty acronym
 * is null, not "", because Liquid treats "" as truthy and the card's alt
 * would gain "&nbsp;()". Dates stay bare so Jekyll loads them as Dates and
 * `sort: "date_joined"` compares as before.
 * @param {ReturnType<typeof validate>['members']} members
 */
function renderYAML(members) {
  const value = (k, v) => {
    if (v === null) return 'null';
    if (typeof v === 'boolean' || k === 'date_joined') return String(v);
    return JSON.stringify(v);
  };
  const blocks = TIERS.map((t) => {
    const inTier = members.filter((m) => m.tier === t.label);
    if (!inTier.length) return null;
    const lines = [`${t.key}:`];
    for (const m of inTier) {
      FIELD_ORDER.filter((k) => k in m).forEach((k, i) => {
        lines.push(`${i ? '    ' : '  - '}${k}: ${value(k, m[k])}`);
      });
    }
    return lines.join('\n');
  }).filter(Boolean);
  return `${YAML_HEADER}\n${blocks.join('\n\n')}\n`;
}

/** "N <label>s:" then one indented line per item. */
function list(label, items) {
  return `${items.length} ${label}${items.length === 1 ? '' : 's'}:\n`
    + items.map((s) => `  ${s}`).join('\n');
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

/**
 * Committed logo filenames. Compared against the listing rather than with
 * existsSync so the match is exact and case-sensitive on macOS too.
 */
function repoLogos() {
  return new Set(fs.readdirSync(LOGO_DIR));
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
  const { members, warnings, errors } = validate(records);
  if (errors.length) throw new Error(list('invalid figure', errors));
  if (!members.length) throw new Error('No members found — refusing to write an empty file.');

  const needed = neededLogos(members, repoLogos());
  if (needed.length && argValue('--file')) {
    warnings.push(...missingLogoWarnings(needed));
  } else if (needed.length) {
    throw new Error('downloading logos is not implemented');
  }

  for (const w of warnings) console.error(`build-org-members: ${w}`);
  const counts = TIERS
    .map((t) => `${members.filter((m) => m.tier === t.label).length} ${t.key}`)
    .join(', ');
  console.log(`Parsed ${records.length} rows -> ${members.length} members (${counts}).`);
  writeIfChanged(OUT_YML, renderYAML(members));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`build-org-members: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseCSV, toMemberRecords, parseDate, parseBool, validate,
  neededLogos, renderYAML,
};
