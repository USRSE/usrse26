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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Copied from build-program.js. */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BANNER = '<!-- Generated by scripts/build-program-pdf.js — do not edit -->';

const CSS = `
@page { size: letter; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: #fff; color: #1a1a1a; font: 9.5pt/1.35 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 8.5in; height: 11in; padding: 0.6in 0.65in; overflow: hidden; break-after: page; position: relative; }
@media screen { body { background: #888; } .page { background: #fff; margin: 0.25in auto; box-shadow: 0 1px 6px rgba(0,0,0,.3); } }
`;

function renderDocument() {
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
  writeIfChanged(OUT_HTML, renderDocument({ program }));
  if (process.argv.includes('--html-only')) return;
}

main().catch((err) => {
  console.error(`build-program-pdf: ${err.message}`);
  process.exit(1);
});
