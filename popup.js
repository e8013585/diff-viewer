/**
 * popup.js
 *
 * Main orchestrator for the Diff Viewer popup.
 * Handles UI state, event wiring, keyboard shortcuts,
 * and coordinates between diffEngine, renderer, and utils.
 *
 * Uses chrome.storage.session to persist text across popup
 * reopens within the same browser session. Data is automatically
 * cleared when the browser is closed.
 */

'use strict';

// ─── App State ──────────────────────────────────────────────────────────────
const AppState = {
  currentMode: 'side-by-side', // 'side-by-side' | 'inline'
  wordDiff: false,
  lastResult: null,
  isComparing: false,
  scrollSyncCleanup: null,
};

// ─── Storage Keys ───────────────────────────────────────────────────────────
const STORAGE_KEY_LEFT  = 'dv_text_left';
const STORAGE_KEY_RIGHT = 'dv_text_right';

// ─── DOM References ──────────────────────────────────────────────────────────
const DOM = {};

/**
 * Initialize all DOM references after the document is ready.
 */
function initDOM() {
  DOM.body             = document.body;

  // Inputs
  DOM.textOriginal     = document.getElementById('textOriginal');
  DOM.textModified     = document.getElementById('textModified');

  // Buttons
  DOM.btnCompare       = document.getElementById('btnCompare');
  DOM.btnClear         = document.getElementById('btnClear');
  DOM.btnReset         = document.getElementById('btnReset');
  DOM.btnCopyLeft      = document.getElementById('btnCopyLeft');
  DOM.btnCopyRight     = document.getElementById('btnCopyRight');
  DOM.btnSwap          = document.getElementById('btnSwap');
  DOM.btnFormatJSON    = document.getElementById('btnFormatJSON');
  DOM.btnSideBySide    = document.getElementById('btnSideBySide');
  DOM.btnInline        = document.getElementById('btnInline');
  DOM.wordDiffToggle   = document.getElementById('wordDiffToggle');

  // Status
  DOM.statusBar        = document.getElementById('statusBar');

  // Results
  DOM.resultsSection   = document.getElementById('resultsSection');
  DOM.emptyState       = document.getElementById('emptyState');
  DOM.loadingState     = document.getElementById('loadingState');
  DOM.identicalState   = document.getElementById('identicalState');
  DOM.statsBar         = document.getElementById('statsBar');
  DOM.diffOutput       = document.getElementById('diffOutput');
  DOM.diffScrollContainer = document.getElementById('diffScrollContainer');
  DOM.diffTable        = document.getElementById('diffTable');
  DOM.diffColgroup     = document.getElementById('diffColgroup');
  DOM.diffTbody        = document.getElementById('diffTbody');

  // Stat counters
  DOM.statsEls = {
    added:     document.getElementById('statAdded'),
    removed:   document.getElementById('statRemoved'),
    changed:   document.getElementById('statChanged'),
    unchanged: document.getElementById('statUnchanged'),
  };

  // Panels
  DOM.panelLeft        = document.querySelector('.input-panel--left');
  DOM.panelRight       = document.querySelector('.input-panel--right');
  DOM.panelResizer     = document.querySelector('.panel-resizer');
  DOM.inputPanels      = document.querySelector('.input-panels');
}

// ─── UI State Management ─────────────────────────────────────────────────────

const UIState = {
  EMPTY:     'empty',
  LOADING:   'loading',
  IDENTICAL: 'identical',
  DIFF:      'diff',
};

/**
 * Transition the results section to a given UI state.
 * @param {string} state - one of UIState constants
 */
function setUIState(state) {
  DOM.emptyState.hidden     = true;
  DOM.loadingState.hidden   = true;
  DOM.identicalState.hidden = true;
  DOM.statsBar.hidden       = true;
  DOM.diffOutput.hidden     = true;

  switch (state) {
    case UIState.EMPTY:
      DOM.emptyState.hidden = false;
      break;
    case UIState.LOADING:
      DOM.loadingState.hidden = false;
      break;
    case UIState.IDENTICAL:
      DOM.identicalState.hidden = false;
      break;
    case UIState.DIFF:
      DOM.statsBar.hidden   = false;
      DOM.diffOutput.hidden = false;
      break;
  }
}

// ─── Column Setup ────────────────────────────────────────────────────────────

/**
 * Configure table column widths based on view mode.
 * Side-by-side: gutter | content | gutter | content
 *   Content columns use calc(50% - 44px) so total = 100%.
 * Inline:       gutter | marker | content
 */
function setupTableColumns(mode) {
  DOM.diffColgroup.textContent = '';

  if (mode === 'side-by-side') {
    const defs = [
      { width: '44px' },              // left line num
      { width: 'calc(50% - 44px)' },  // left content
      { width: '44px' },              // right line num
      { width: 'calc(50% - 44px)' },  // right content
    ];
    for (const def of defs) {
      const col = document.createElement('col');
      col.style.width = def.width;
      DOM.diffColgroup.appendChild(col);
    }
  } else {
    const defs = [
      { width: '44px' },
      { width: '20px' },
      { width: 'auto' },
    ];
    for (const def of defs) {
      const col = document.createElement('col');
      col.style.width = def.width;
      DOM.diffColgroup.appendChild(col);
    }
  }
}

// ─── Compare Logic ───────────────────────────────────────────────────────────

/**
 * Main comparison handler.
 * Validates input, runs diff, renders results.
 */
async function runComparison() {
  if (AppState.isComparing) return;

  const original = DOM.textOriginal.value;
  const modified = DOM.textModified.value;

  if (!original.trim() && !modified.trim()) {
    Utils.setStatus(DOM.statusBar, I18n.t('errorBothEmpty'), 'warning');
    return;
  }

  if (!original.trim() || !modified.trim()) {
    Utils.setStatus(DOM.statusBar, I18n.t('errorOneEmpty'), 'warning');
    return;
  }

  const isLarge = Utils.isLargeInput(original) || Utils.isLargeInput(modified);

  AppState.isComparing = true;
  setUIState(UIState.LOADING);

  // Defer so loading state renders
  await new Promise(resolve => setTimeout(resolve, isLarge ? 50 : 0));

  try {
    if (isLarge) {
      Utils.setStatus(DOM.statusBar, I18n.t('errorLargeInput'), 'warning', 4000);
    }

    if (DiffEngine.areIdentical(original, modified)) {
      AppState.lastResult = null;
      setUIState(UIState.IDENTICAL);
      AppState.isComparing = false;
      return;
    }

    const result = DiffEngine.diff(original, modified, {
      wordDiff: AppState.wordDiff
    });

    AppState.lastResult = result;

    setupTableColumns(AppState.currentMode);
    Renderer.render(DOM.diffTbody, result.ops, AppState.currentMode);
    Renderer.renderStats(DOM.statsEls, result.stats);
    setUIState(UIState.DIFF);
    setupScrollSync();

  } catch (err) {
    console.error('[DiffViewer] Comparison error:', err);
    Utils.setStatus(DOM.statusBar, 'Error: ' + err.message, 'error');
    setUIState(UIState.EMPTY);
  } finally {
    AppState.isComparing = false;
  }
}

// ─── Scroll Sync ─────────────────────────────────────────────────────────────

/**
 * Table-based layout shares a single scroll container,
 * so both sides scroll together naturally. No additional sync needed.
 */
function setupScrollSync() {
  if (AppState.scrollSyncCleanup) {
    AppState.scrollSyncCleanup();
    AppState.scrollSyncCleanup = null;
  }
}

// ─── View Mode Switching ─────────────────────────────────────────────────────

/**
 * Switch between side-by-side and inline diff view modes.
 * @param {'side-by-side'|'inline'} mode
 */
function switchViewMode(mode) {
  if (AppState.currentMode === mode) return;
  AppState.currentMode = mode;

  DOM.btnSideBySide.classList.toggle('toggle-btn--active', mode === 'side-by-side');
  DOM.btnInline.classList.toggle('toggle-btn--active', mode === 'inline');

  if (AppState.lastResult) {
    setupTableColumns(mode);
    Renderer.render(DOM.diffTbody, AppState.lastResult.ops, mode);
  }
}

// ─── Word Diff Toggle ────────────────────────────────────────────────────────

function handleWordDiffToggle() {
  AppState.wordDiff = DOM.wordDiffToggle.checked;
  if (AppState.lastResult) {
    runComparison();
  }
}

// ─── Clear ───────────────────────────────────────────────────────────────────

/**
 * Clear current inputs and result view, but keep saved storage intact
 * so text reappears next time the popup opens.
 */
function clearAll() {
  DOM.textOriginal.value = '';
  DOM.textModified.value = '';
  AppState.lastResult = null;
  setUIState(UIState.EMPTY);
  DOM.textOriginal.focus();
  Utils.setStatus(DOM.statusBar, I18n.t('cleared'), 'info', 1500);
  updateLineCounts();
  // Also clear saved session so clear truly clears
  saveToSessionStorage('', '');
}

// ─── Reset ───────────────────────────────────────────────────────────────────

/**
 * Reset: clear inputs, clear saved storage, reset view.
 * Next time the popup opens, the panels will be empty.
 */
async function resetAll() {
  DOM.textOriginal.value = '';
  DOM.textModified.value = '';
  AppState.lastResult = null;
  setUIState(UIState.EMPTY);
  DOM.textOriginal.focus();
  updateLineCounts();

  try {
    await chrome.storage.session.remove([STORAGE_KEY_LEFT, STORAGE_KEY_RIGHT]);
    Utils.setStatus(DOM.statusBar, I18n.t('resetDone') || 'Reset complete', 'info', 1500);
  } catch {
    Utils.setStatus(DOM.statusBar, I18n.t('resetDone') || 'Reset complete', 'info', 1500);
  }
}

// ─── Swap ────────────────────────────────────────────────────────────────────

function swapContent() {
  const tmp = DOM.textOriginal.value;
  DOM.textOriginal.value = DOM.textModified.value;
  DOM.textModified.value = tmp;
  Utils.setStatus(DOM.statusBar, I18n.t('swapped'), 'info', 1500);
  updateLineCounts();
  if (AppState.lastResult) {
    runComparison();
  }
}

// ─── Copy ────────────────────────────────────────────────────────────────────

/**
 * Copy text from a textarea to clipboard.
 * @param {'left'|'right'} side
 * @param {HTMLElement} btn
 */
async function copyPanel(side, btn) {
  const text = side === 'left'
    ? DOM.textOriginal.value
    : DOM.textModified.value;

  if (!text) {
    Utils.showButtonFeedback(btn, I18n.t('copyFailed') || 'Empty', 1200);
    return;
  }

  const success = await Utils.copyToClipboard(text);
  Utils.showButtonFeedback(
    btn,
    success ? I18n.t('copied') : I18n.t('copyFailed'),
    1500
  );
}

// ─── Format JSON ─────────────────────────────────────────────────────────────

function formatJSON() {
  const leftVal  = DOM.textOriginal.value;
  const rightVal = DOM.textModified.value;

  if (!leftVal.trim() && !rightVal.trim()) {
    Utils.setStatus(DOM.statusBar, I18n.t('errorBothEmpty') || 'Both panels are empty', 'warning');
    return;
  }

  let anySuccess = false;
  let anyError = false;

  if (leftVal.trim()) {
    const leftResult = Utils.formatJSON(leftVal);
    if (leftResult.success) {
      DOM.textOriginal.value = leftResult.result;
      anySuccess = true;
    } else {
      anyError = true;
    }
  }

  if (rightVal.trim()) {
    const rightResult = Utils.formatJSON(rightVal);
    if (rightResult.success) {
      DOM.textModified.value = rightResult.result;
      anySuccess = true;
    } else {
      anyError = true;
    }
  }

  if (anyError) {
    Utils.setStatus(DOM.statusBar, I18n.t('formatJSONError') || 'Invalid JSON in one or both panels', 'error');
  } else if (anySuccess) {
    Utils.setStatus(DOM.statusBar, '✓ JSON formatted', 'success');
    updateLineCounts();
  }
}

// ─── Line Count Display ──────────────────────────────────────────────────────

const updateLineCounts = Utils.debounce(() => {
  const leftCount  = Utils.countLines(DOM.textOriginal.value);
  const rightCount = Utils.countLines(DOM.textModified.value);

  const leftEl  = document.getElementById('lineCountLeft');
  const rightEl = document.getElementById('lineCountRight');

  if (leftEl)  leftEl.textContent  = leftCount  ? leftCount + ' lines'  : '';
  if (rightEl) rightEl.textContent = rightCount ? rightCount + ' lines' : '';
}, 200);

// ─── Session Storage (chrome.storage.session) ────────────────────────────────

/**
 * Save both panel texts to chrome.storage.session.
 * Debounced internally by the callers.
 * @param {string} left
 * @param {string} right
 */
async function saveToSessionStorage(left, right) {
  try {
    await chrome.storage.session.set({
      [STORAGE_KEY_LEFT]: left,
      [STORAGE_KEY_RIGHT]: right
    });
  } catch { /* storage unavailable */ }
}

/**
 * Restore panel texts from chrome.storage.session.
 * @returns {Promise<{left: string, right: string}>}
 */
async function restoreFromSessionStorage() {
  try {
    const result = await chrome.storage.session.get([STORAGE_KEY_LEFT, STORAGE_KEY_RIGHT]);
    return {
      left:  result[STORAGE_KEY_LEFT]  || '',
      right: result[STORAGE_KEY_RIGHT] || ''
    };
  } catch {
    return { left: '', right: '' };
  }
}

/**
 * Set up auto-save on input changes.
 */
function initSessionPersistence() {
  const saveLeft = Utils.debounce(() => {
    saveToSessionStorage(DOM.textOriginal.value, DOM.textModified.value);
  }, 500);

  const saveRight = Utils.debounce(() => {
    saveToSessionStorage(DOM.textOriginal.value, DOM.textModified.value);
  }, 500);

  DOM.textOriginal.addEventListener('input', saveLeft);
  DOM.textModified.addEventListener('input', saveRight);
}

// ─── Panel Resizer ───────────────────────────────────────────────────────────

function initPanelResizer() {
  const resizer = DOM.panelResizer;
  const panelLeft = DOM.panelLeft;
  const panelRight = DOM.panelRight;
  const container = DOM.inputPanels;

  let isResizing = false;
  let startX = 0;
  let startLeftWidth = 0;

  function onMouseDown(e) {
    isResizing = true;
    startX = e.clientX;
    startLeftWidth = panelLeft.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isResizing) return;
    const containerWidth = container.getBoundingClientRect().width;
    const resizerWidth = resizer.getBoundingClientRect().width;
    const available = containerWidth - resizerWidth;
    const dx = e.clientX - startX;
    const newLeftWidth = startLeftWidth + dx;
    const leftPct  = Math.max(20, Math.min(80, (newLeftWidth / available) * 100));
    const rightPct = 100 - leftPct;
    panelLeft.style.flex  = '0 0 ' + leftPct + '%';
    panelRight.style.flex = '0 0 ' + rightPct + '%';
  }

  function onMouseUp() {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  resizer.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  resizer.addEventListener('dblclick', () => {
    panelLeft.style.flex  = '1 1 0';
    panelRight.style.flex = '1 1 0';
  });

  resizer.addEventListener('keydown', (e) => {
    const STEP = 5;
    const containerWidth = container.getBoundingClientRect().width;
    const currentLeftPct = (panelLeft.getBoundingClientRect().width / containerWidth) * 100;

    if (e.key === 'ArrowLeft') {
      const newPct = Math.max(20, currentLeftPct - STEP);
      panelLeft.style.flex  = '0 0 ' + newPct + '%';
      panelRight.style.flex = '0 0 ' + (100 - newPct) + '%';
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      const newPct = Math.min(80, currentLeftPct + STEP);
      panelLeft.style.flex  = '0 0 ' + newPct + '%';
      panelRight.style.flex = '0 0 ' + (100 - newPct) + '%';
      e.preventDefault();
    } else if (e.key === 'Home' || e.key === 'End') {
      panelLeft.style.flex  = '1 1 0';
      panelRight.style.flex = '1 1 0';
      e.preventDefault();
    }
  });
}

// ─── Keyboard Shortcuts ──────────────────────────────────────────────────────

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;

    if (isCtrlOrCmd && e.key === 'Enter') {
      e.preventDefault();
      runComparison();
      return;
    }

    if (e.key === 'Escape' && document.activeElement !== DOM.textOriginal
        && document.activeElement !== DOM.textModified) {
      e.preventDefault();
      clearAll();
      return;
    }

    if (e.key === 'Tab' && (
      document.activeElement === DOM.textOriginal ||
      document.activeElement === DOM.textModified
    )) {
      e.preventDefault();
      const ta = document.activeElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + '\t' + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + 1;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

// ─── RTL Support ─────────────────────────────────────────────────────────────

function applyRTL() {
  if (I18n.isRTL()) {
    document.documentElement.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('lang', I18n.getLocale());
  } else {
    document.documentElement.setAttribute('dir', 'ltr');
    document.documentElement.setAttribute('lang', I18n.getLocale());
  }
}

// ─── Event Wiring ────────────────────────────────────────────────────────────

function initEventListeners() {
  DOM.btnCompare.addEventListener('click', runComparison);
  DOM.btnClear.addEventListener('click', clearAll);
  DOM.btnReset.addEventListener('click', resetAll);
  DOM.btnSwap.addEventListener('click', swapContent);
  DOM.btnFormatJSON.addEventListener('click', formatJSON);

  DOM.btnCopyLeft.addEventListener('click', () => copyPanel('left', DOM.btnCopyLeft));
  DOM.btnCopyRight.addEventListener('click', () => copyPanel('right', DOM.btnCopyRight));

  DOM.btnSideBySide.addEventListener('click', () => switchViewMode('side-by-side'));
  DOM.btnInline.addEventListener('click', () => switchViewMode('inline'));

  DOM.wordDiffToggle.addEventListener('change', handleWordDiffToggle);

  DOM.textOriginal.addEventListener('input', updateLineCounts);
  DOM.textModified.addEventListener('input', updateLineCounts);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

/**
 * Application entry point.
 * Restores saved text from chrome.storage.session, then initializes UI.
 */
async function init() {
  // 1. Initialize DOM references
  initDOM();

  // 2. Apply i18n translations to the DOM
  I18n.applyToDOM();

  // 3. Apply RTL direction if needed
  applyRTL();

  // 4. Wire up event listeners
  initEventListeners();

  // 5. Keyboard shortcuts
  initKeyboardShortcuts();

  // 6. Panel resizer
  initPanelResizer();

  // 7. Restore saved text from session storage
  const saved = await restoreFromSessionStorage();
  if (saved.left)  DOM.textOriginal.value = saved.left;
  if (saved.right) DOM.textModified.value = saved.right;

  // 8. Set up auto-save for future changes
  initSessionPersistence();

  // 9. Set initial UI state
  setUIState(UIState.EMPTY);

  // 10. Focus left textarea
  DOM.textOriginal.focus();

  // 11. Update line counts if content was restored
  updateLineCounts();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}