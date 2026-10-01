#!/usr/bin/env node
/**
 * build-program-pdf.js — build the USRSE'26 printed program from repo data.
 *
 * Reads the committed schedule and the other repo sources, never the sheet:
 *
 *   _data/program.json            schedule (written by build-program.js)
 *   _config.yml                   title, theme, dates, location, Wi-Fi, url
 *   _print/welcome.md             General Chairs' welcome letter (optional)
 *   pages/about/organization.md   organizing committee
 *   index.html                    sponsor tiers and logos
 *   _data/org-members.yml         organizational founding members (optional)
 *
 * and writes two artifacts:
 *
 *   _print/program.html           self-contained print HTML (US Letter)
 *   pages/program/program.pdf     the same, printed by headless Chrome
 *
 * Run by hand before sending the program to the printer; it is not part of
 * the daily sheet workflow. Requires Node 18+; zero dependencies.
 *
 *   node scripts/build-program-pdf.js               # HTML + PDF
 *   node scripts/build-program-pdf.js --html-only   # HTML only, no Chrome
 *   node scripts/build-program-pdf.js --force       # re-render the PDF
 *   CHROME_PATH=/path/to/chrome node scripts/build-program-pdf.js
 *
 * assets/img/program-qr.svg is committed, not generated here. It was made
 * once with:
 *
 *   npx --yes qrcode -t svg -o assets/img/program-qr.svg \
 *     https://us-rse.org/usrse26/program/
 *
 * The PDF is re-rendered only when it is older than the print HTML. Changing
 * a logo or image file leaves the HTML identical, so pass --force then.
 *
 * build-program.js still hard-codes its own conference location rather than
 * reading conf_location; switching it changes llms.txt, so it is tracked
 * separately (issue #69).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(__dirname, '..');

/**
 * Top-level scalars from _config.yml — copied from build-program.js, which
 * cannot be required (it runs main() on load). Deliberately not a YAML parse:
 * "key: value" lines at column 0 only, quoted values kept verbatim, unquoted
 * ones lose a trailing " # comment". Commented-out keys never match.
 */
function readJekyllConfig() {
  let text;
  try {
    text = fs.readFileSync(path.join(REPO_ROOT, '_config.yml'), 'utf8');
  } catch (err) {
    configFail(`cannot read _config.yml: ${err.message}`);
  }
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]+(\S.*)$/.exec(line);
    if (!m) continue;
    const quoted = /^(["'])([\s\S]*)\1[ \t]*(?:#.*)?$/.exec(m[2]);
    values.set(m[1], quoted ? quoted[2] : m[2].replace(/[ \t]+#.*$/, '').trim());
  }
  return values;
}

/** Copied from build-program.js: config errors surface while constants are
 * initialized, before main().catch exists, so they report and exit here. */
function configFail(message) {
  console.error(`build-program-pdf: ${message}`);
  process.exit(1);
}

const JEKYLL = readJekyllConfig();

/** Copied from build-program.js: a _config.yml value that must be present. */
function configValue(key) {
  const v = JEKYLL.get(key);
  if (v === undefined || v === '') {
    configFail(`_config.yml has no "${key}" — cannot build the program.`);
  }
  return v;
}

// Copied from build-program.js: absolute site root, url + baseurl.
const SITE_BASE = (() => {
  const origin = configValue('url').replace(/\/+$/, '');
  const base = (JEKYLL.get('baseurl') || '').replace(/^\/+|\/+$/g, '');
  return base ? `${origin}/${base}/` : `${origin}/`;
})();

const CONF = {
  title: configValue('title'),
  theme: configValue('conf_theme_short'),
  location: configValue('conf_location'),
  start: configValue('conf_start_date'),
  end: configValue('conf_end_date'),
  wifiSsid: JEKYLL.get('conf_wifi_ssid') || '',
  wifiPassword: JEKYLL.get('conf_wifi_password') || '',
};

const PROGRAM_JSON = path.join(REPO_ROOT, '_data', 'program.json');
const WELCOME_MD = path.join(REPO_ROOT, '_print', 'welcome.md');
const ORG_MD = path.join(REPO_ROOT, 'pages', 'about', 'organization.md');
const INDEX_HTML = path.join(REPO_ROOT, 'index.html');
const ORG_MEMBERS_YML = path.join(REPO_ROOT, '_data', 'org-members.yml');
const QR_SVG = path.join(REPO_ROOT, 'assets', 'img', 'program-qr.svg');
const LOGO_SVG = path.join(REPO_ROOT, 'assets', 'img', 'usrse26-long-logo.svg');
const OUT_HTML = path.join(REPO_ROOT, '_print', 'program.html');
const OUT_PDF = path.join(REPO_ROOT, 'pages', 'program', 'program.pdf');

const rel = (file) => path.relative(REPO_ROOT, file);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/**
 * "October 19–21, 2026" from two _config.yml stamps. The YYYY-MM-DD prefix
 * is read as a substring, never through a Date, for the reason TZ_OFFSET
 * gives in build-program.js: a Date would shift the day to the runner's zone.
 */
function dateRange(start, end) {
  const parse = (s, key) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) throw new Error(`_config.yml ${key} is not YYYY-MM-DD: "${s}"`);
    return { y: m[1], month: MONTHS[Number(m[2]) - 1], d: Number(m[3]) };
  };
  const a = parse(start, 'conf_start_date');
  const b = parse(end, 'conf_end_date');
  if (a.y !== b.y) return `${a.month} ${a.d}, ${a.y}–${b.month} ${b.d}, ${b.y}`;
  if (a.month !== b.month) return `${a.month} ${a.d}–${b.month} ${b.d}, ${b.y}`;
  if (a.d === b.d) return `${a.month} ${a.d}, ${a.y}`;
  return `${a.month} ${a.d}–${b.d}, ${b.y}`;
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** The committed schedule; same failure wording as build-program.js --from-json. */
function readProgram() {
  if (!fs.existsSync(PROGRAM_JSON)) {
    throw new Error(`${rel(PROGRAM_JSON)} does not exist.`);
  }
  const program = JSON.parse(fs.readFileSync(PROGRAM_JSON, 'utf8'));
  if (!Array.isArray(program.days) || !program.days.length) {
    throw new Error('program.json has no days — refusing to write empty files.');
  }
  return program;
}

/**
 * The General Chairs' letter: { placeholder, bodyMd }, or null when the file
 * is absent (the page is then omitted). Front matter is a leading ---/---
 * block; only "placeholder: true" is read from it.
 */
function readWelcome() {
  if (!fs.existsSync(WELCOME_MD)) {
    console.warn(`warning: ${rel(WELCOME_MD)} not found — omitting the welcome page`);
    return null;
  }
  const text = fs.readFileSync(WELCOME_MD, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const placeholder = !!fm && /^placeholder:[ \t]*true[ \t]*$/m.test(fm[1]);
  if (placeholder) {
    console.warn(`warning: welcome letter is still the placeholder (${rel(WELCOME_MD)})`);
  }
  return { placeholder, bodyMd: fm ? text.slice(fm[0].length) : text };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Collapse whitespace so a value can occupy a single line (build-program.js). */
function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * The inline Markdown subset the printed program needs. Links keep only
 * their text: paper has nothing to click. `code` loses its backticks.
 * `wrap(tag, text)` decides the output: HTML tags, or bare text.
 */
function mdApply(s, wrap) {
  return s
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .replace(/`([^`]+)`/g, (_, t) => wrap('code', t))
    .replace(/\*\*(.+?)\*\*/g, (_, t) => wrap('strong', t))
    .replace(/\*(.+?)\*/g, (_, t) => wrap('em', t))
    .replace(/(^|[^\w])_(.+?)_(?!\w)/g, (_, pre, t) => pre + wrap('em', t));
}

/** Trusted inline Markdown -> HTML; everything is escaped first. */
function mdInline(md) {
  return mdApply(esc(md), (tag, t) => `<${tag}>${t}</${tag}>`);
}

/** Inline Markdown -> one line of plain text (still unescaped). */
function mdToText(md) {
  return oneLine(mdApply(String(md == null ? '' : md), (_, t) => t));
}

/** Blank-line-separated paragraphs -> <p> lines. */
function mdParagraphs(md) {
  return String(md).trim().split(/\r?\n[ \t]*\r?\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${mdInline(oneLine(p))}</p>`);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Copied from build-program.js. */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Repo file -> src relative to _print/program.html. */
function src(file) {
  return esc(path.relative(path.dirname(OUT_HTML), file).split(path.sep).join('/'));
}

function renderCover() {
  const lines = [
    '<section class="page cover">',
    `  <img class="cover__logo" src="${src(LOGO_SVG)}" alt="${esc(CONF.title)}">`,
    `  <h1 class="cover__theme">${esc(CONF.theme)}</h1>`,
    `  <p class="cover__where">${esc(CONF.location)} · ${esc(dateRange(CONF.start, CONF.end))}</p>`,
    '  <div class="cover__band">',
    '    <div class="cover__cell cover__qr">',
    `      <img src="${src(QR_SVG)}" alt="QR code for the online program">`,
    '      <div>',
    '        <p class="cover__label">Full program details and abstracts</p>',
    `        <p class="cover__url">${esc(SITE_BASE + 'program/')}</p>`,
    '      </div>',
    '    </div>',
  ];
  if (CONF.wifiSsid) {
    lines.push(
      '    <div class="cover__cell cover__wifi">',
      '      <p class="cover__label">Wi-Fi</p>',
      `      <p>Network: <b>${esc(CONF.wifiSsid)}</b></p>`,
    );
    if (CONF.wifiPassword) lines.push(`      <p>Password: <b>${esc(CONF.wifiPassword)}</b></p>`);
    lines.push('    </div>');
  }
  lines.push('  </div>', '</section>');
  return lines.join('\n');
}

// The Code of Conduct report address, as published in
// pages/about/code-of-conduct.md:14.
const COC_EMAIL = 'coc@us-rse.org';

function renderWelcome(welcome) {
  return [
    '<section class="page welcome">',
    '  <h1>Welcome!</h1>',
    ...mdParagraphs(welcome.bodyMd).map((p) => `  ${p}`),
    '  <hr>',
    '  <div class="welcome__notice">',
    '    <p>All conference participants are expected to abide by the Code of'
      + ' Conduct. Please report problems or concerns to'
      + ` <b>${esc(COC_EMAIL)}</b>.</p>`,
    `    <p>${esc(SITE_BASE + 'about/code-of-conduct/')}</p>`,
    `    <p>Full program details and conference policies: ${esc(SITE_BASE)}</p>`,
    '  </div>',
    '</section>',
  ].join('\n');
}

// Single-event formats the overview names before the talk title. A copy of
// FORMATS[*].pageTitle in build-program.js, keyed the same way.
const FORMAT_LABELS = {
  'keynote': 'Keynote',
  'workshop': 'Workshop',
  'bird of a feather': 'Birds of a Feather',
  'student': 'Student & Early Career',
};

/** Same key normalization as build-program.js normalizeFormat (trim + lowercase). */
function normalizeFormat(raw) {
  return String(raw || '').trim().toLowerCase();
}

/** "10:30–11:30am" — fmtRange's rule, as plain text: drop a shared meridiem. */
function textRange(slot) {
  const start = slot.start.slice(-2) === slot.end.slice(-2) ? slot.start.slice(0, -2) : slot.start;
  return `${start}–${slot.end}`;
}

/** Session chairs, abstracts and speakers of talk sessions stay online only. */
function renderOverviewSession(session) {
  const head = `<p class="s__head"><b>${esc(session.title)}</b>`
    + (session.room ? `, <i>${esc(session.room)}</i>` : '') + '</p>';
  if (session.muted) return [head];
  const lines = [head];
  const talks = session.talks || [];
  const info = mdToText(session.info);
  if (info) lines.push(`<p class="info">${esc(info)}</p>`);
  const label = talks.length === 1 ? FORMAT_LABELS[normalizeFormat(talks[0].format)] : undefined;
  if (label) {
    lines.push(`<p class="s__single"><b>${esc(label)}:</b> ${esc(mdToText(talks[0].title))}</p>`);
    const speakers = mdToText(talks[0].speakers);
    if (speakers) lines.push(`<p class="s__speakers">${esc(speakers)}</p>`);
  } else if (talks.length) {
    lines.push('<ul>', ...talks.map((t) => `  <li>${esc(mdToText(t.title))}</li>`), '</ul>');
  }
  return lines;
}

/** One flat list of rows for the paginator to place one at a time. */
function renderSchedule(days) {
  const lines = [
    '<div class="flow" data-flow="schedule">',
    '  <div class="row row--intro">',
    '    <h1>Schedule Overview</h1>',
    '    <p class="note">Full abstracts and presenter names are in the online program:'
      + ` <b>${esc(SITE_BASE + 'program/')}</b></p>`,
    '  </div>',
  ];
  days.forEach((day, d) => {
    const heading = `${day.weekday}, ${day.label}`;
    lines.push(`  <div class="row row--day" data-day="${esc(heading)}"><h2 class="day">${esc(heading)}</h2></div>`);
    day.slots.forEach((slot, i) => {
      const time = textRange(slot);
      slot.sessions.forEach((session, k) => {
        const cls = ['row', 'row--session'];
        if (session.muted) cls.push('row--muted');
        if (k === 0) cls.push('row--first');
        lines.push(
          `  <div class="${cls.join(' ')}" data-day="${esc(heading)}" data-slot="s-${d}-${i}"`
            + ` data-time="${esc(time)}"${k === 0 ? ' data-first="1"' : ''}>`,
          `    <div class="time">${k === 0 ? esc(time) : ''}</div>`,
          '    <div class="body">',
          ...renderOverviewSession(session).map((l) => `      ${l}`),
          '    </div>',
          '  </div>',
        );
      });
    });
  });
  lines.push('</div>');
  return lines.join('\n');
}

const BANNER = '<!-- Generated by scripts/build-program-pdf.js — do not edit -->';

const CSS = `
@page { size: letter; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: #fff; color: #1a1a1a; font: 9.5pt/1.35 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 8.5in; height: 11in; padding: 0.6in 0.65in; overflow: hidden; break-after: page; position: relative; }
.cover { display: flex; flex-direction: column; justify-content: center; text-align: center; }
.cover__logo { width: 100%; height: auto; margin-bottom: 0.6in; }
.cover__theme { font-size: 28pt; line-height: 1.15; margin: 0 0 0.25in; color: #C16531; }
.cover__where { font-size: 16pt; margin: 0 0 0.8in; }
.cover__band { display: flex; justify-content: center; gap: 0.5in; background: #C16531; color: #fff; padding: 0.3in; border-radius: 6px; text-align: left; }
.cover__cell p { margin: 0 0 4pt; font-size: 12pt; }
.cover__qr { display: flex; align-items: center; gap: 0.2in; }
.cover__qr img { width: 1.3in; height: 1.3in; background: #fff; padding: 4px; }
.cover__label { font-weight: 700; font-size: 13pt !important; }
.cover__url { font-size: 11pt !important; word-break: break-all; }
.welcome h1 { font-size: 26pt; color: #C16531; margin: 0 0 0.25in; }
.welcome p { font-size: 11pt; line-height: 1.5; margin: 0 0 9pt; }
.welcome hr { border: 0; border-top: 1px solid #C16531; margin: 0.3in 0 0.2in; }
.welcome__notice p { font-size: 9pt; line-height: 1.4; margin: 0 0 5pt; }
.page h1 { font-size: 20pt; color: #C16531; margin: 0 0 6pt; }
.row--intro .note { margin: 0 0 8pt; color: #444; }
.day { font-size: 13pt; margin: 0; padding: 10pt 0 3pt; border-bottom: 1.5px solid #C16531; color: #C16531; }
.row--session { display: grid; grid-template-columns: 1.05in 1fr; column-gap: 0.15in; padding: 4pt 0; }
.row--session.row--first { border-top: 0.5px solid #ccc; }
.row--day + .row--session.row--first, .day-continued + .row--session.row--first { border-top: 0; }
.row--session .time { font-weight: 700; white-space: nowrap; }
.row--session p { margin: 0; }
.row--session .info, .row--session .s__speakers { color: #444; font-size: 8.5pt; }
.row--session ul { margin: 1pt 0 0; padding-left: 12pt; }
.row--session li { margin: 0; }
.row--muted { color: #555; padding: 2pt 0; }
@media screen { body { background: #888; } .page { background: #fff; margin: 0.25in auto; box-shadow: 0 1px 6px rgba(0,0,0,.3); } }
`;

function renderDocument({ program, welcome }) {
  return [
    BANNER,
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${esc(CONF.title)} Program</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    renderCover(),
    ...(welcome ? [renderWelcome(welcome)] : []),
    renderSchedule(program.days),
    '</body>',
    '</html>',
  ].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Copied from build-program.js; returns true when it wrote. */
function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    console.log(`  unchanged  ${rel(file)}`);
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`  wrote      ${rel(file)}`);
  return true;
}

async function main() {
  const program = readProgram();
  for (const file of [QR_SVG, LOGO_SVG]) {
    if (!fs.existsSync(file)) {
      throw new Error(`${file === QR_SVG ? 'QR code' : 'logo'} not found: ${rel(file)}`);
    }
  }
  const welcome = readWelcome();
  writeIfChanged(OUT_HTML, renderDocument({ program, welcome }));
  if (process.argv.includes('--html-only')) return;
}

main().catch((err) => {
  console.error(`build-program-pdf: ${err.message}`);
  process.exit(1);
});
