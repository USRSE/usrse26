/* ==========================================================================
   USRSE'26 program page — List / Grid view switch
   Drives the toolbar hand-authored in pages/program/program.md over the two
   generated includes (_includes/program-schedule.html, the list, and
   _includes/program-grid.html, the room grid).

   Both views ship in the DOM; the grid and the toolbar carry `hidden`, so
   with JavaScript off the page is the list alone and nothing here is
   missed. This file adds the three things that need a script:

     1. the view switch itself, remembered in localStorage,
     2. the "Talk details" switch that hides the talk lists on grid cards,
     3. card clicks, which switch to the list and jump to the entry.

   Dependency-free on purpose: the site's jQuery/Bootstrap bundle loads
   after this script and has nothing to offer it.
   ========================================================================== */

(function () {
  'use strict';

  var toolbar = document.querySelector('.program-toolbar');
  var list = document.querySelector('.program');
  var grid = document.querySelector('.program-grid');
  if (!toolbar || !list || !grid) return;

  var viewButtons = toolbar.querySelectorAll('.program-toolbar__view');
  var detailsButton = toolbar.querySelector('.program-toolbar__details');

  var KEY_VIEW = 'usrse26:program-view';
  var KEY_DETAILS = 'usrse26:program-details';

  // localStorage throws in some private modes and when site data is
  // blocked; the switches still work, the choice just lasts the page view.
  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* no-op */ }
  }
  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  // ------------------------------------------------------------------
  // 1. List / Grid
  // ------------------------------------------------------------------

  // Two `hidden` swaps plus button state — no classes on the views, so
  // print and the no-JS page fall out of the same attribute. Exactly one
  // view is visible at a time.
  function setView(view) {
    var showGrid = view === 'grid';
    list.hidden = showGrid;
    grid.hidden = !showGrid;
    Array.prototype.forEach.call(viewButtons, function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === view));
    });
    // The details switch only means something while the grid is showing.
    if (detailsButton) detailsButton.hidden = !showGrid;
    store(KEY_VIEW, view);
  }

  Array.prototype.forEach.call(viewButtons, function (b) {
    b.addEventListener('click', function () {
      setView(b.getAttribute('data-view'));
    });
  });

  // ------------------------------------------------------------------
  // 2. Talk details
  // ------------------------------------------------------------------

  // One class on the grid root; the stylesheet hides the talk lists under
  // it. The label stays fixed and aria-pressed carries the state — a
  // swapping label plus aria-pressed would announce the state twice.
  function setDetails(shown) {
    grid.classList.toggle('program-grid--no-details', !shown);
    if (detailsButton) detailsButton.setAttribute('aria-pressed', String(shown));
    store(KEY_DETAILS, shown ? 'shown' : 'hidden');
  }

  if (detailsButton) {
    detailsButton.addEventListener('click', function () {
      setDetails(detailsButton.getAttribute('aria-pressed') !== 'true');
    });
  }

  // ------------------------------------------------------------------
  // 3. Card clicks — switch to the list, then jump to the entry
  // ------------------------------------------------------------------

  // A card's href is the id of its <article> in the list, which is hidden
  // while the grid shows, so the list must come back before the browser
  // scrolls. Setting location.hash after that makes the scroll native, and
  // .session's scroll-margin-top clears the fixed navbar. The same-hash
  // branch covers clicking one card twice — a hash that does not change
  // does not scroll. stopPropagation keeps app.js's SmoothScroll (one
  // delegated listener on document, bubble phase) from seeing the click
  // and animating toward a target that was hidden when it measured it.
  // Day-pill clicks are deliberately left alone: their targets are visible
  // whenever the pills are, so SmoothScroll gives them the same animated,
  // navbar-offset scroll the list's pills get.
  grid.addEventListener('click', function (e) {
    var card = e.target.closest('a.grid__card');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    setView('list');
    var id = card.getAttribute('href').slice(1);
    if ('#' + id === location.hash) {
      var el = document.getElementById(id);
      if (el) el.scrollIntoView();
    } else {
      location.hash = id;
    }
  });

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------

  // The toolbar is rendered hidden, so it never appears on a page where
  // this script didn't run. Default view is the list, so first paint
  // never flashes; details default to shown.
  toolbar.hidden = false;
  setView(read(KEY_VIEW) === 'grid' ? 'grid' : 'list');
  setDetails(read(KEY_DETAILS) !== 'hidden');
})();
