/**
 * utils.js
 * Shared utility functions for the Diff Viewer extension.
 */

'use strict';

const Utils = (() => {

  // ─── String / Text Utilities ─────────────────────────────────────────────

  /**
   * Split text into lines, preserving empty lines.
   * Normalizes CRLF to LF.
   * @param {string} text
   * @returns {string[]}
   */
  function splitLines(text) {
    return text.replace(/\r\n/g, '\n').split('\n');
  }

  /**
   * Escape HTML special characters to prevent XSS.
   * Use when inserting text into innerHTML or attributed HTML strings.
   * Note: The renderer uses textContent (auto-escaped), so this is
   * only needed for string-based HTML construction.
   * @param {string} str
   * @returns {string}
   */
  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Preserve leading whitespace by converting tabs to visible tab spans.
   * IMPORTANT: Input must already be HTML-escaped via escapeHTML().
   * Returns an HTML string — only use with innerHTML on trusted content.
   * @param {string} str - Already HTML-escaped string
   * @returns {string}
   */
  function preserveWhitespace(str) {
    return str.replace(/\t/g, '<span class="tab-char">    </span>');
  }

  /**
   * Format a number with locale-appropriate thousands separators.
   * @param {number} n
   * @returns {string}
   */
  function formatNumber(n) {
    return n.toLocaleString();
  }

  /**
   * Truncate text to a maximum character length with ellipsis.
   * @param {string} text
   * @param {number} maxLength
   * @returns {string}
   */
  function truncate(text, maxLength = 100) {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '…';
  }

  /**
   * Count the number of lines in a text block.
   * Returns 0 for empty/missing input.
   * @param {string} text
   * @returns {number}
   */
  function countLines(text) {
    if (!text) return 0;
    return splitLines(text).length;
  }

  // ─── Debounce / Throttle ─────────────────────────────────────────────────

  /**
   * Debounce a function call.
   * @param {Function} fn
   * @param {number} delay - milliseconds
   * @returns {Function}
   */
  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * Throttle a function call.
   * @param {Function} fn
   * @param {number} limit - milliseconds
   * @returns {Function}
   */
  function throttle(fn, limit) {
    let lastCall = 0;
    return function (...args) {
      const now = Date.now();
      if (now - lastCall >= limit) {
        lastCall = now;
        return fn.apply(this, args);
      }
    };
  }

  // ─── Clipboard ───────────────────────────────────────────────────────────

  /**
   * Copy text to clipboard using the modern Clipboard API,
   * with fallback to execCommand.
   * @param {string} text
   * @returns {Promise<boolean>} success
   */
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const success = document.execCommand('copy');
      document.body.removeChild(ta);
      return success;
    } catch {
      return false;
    }
  }

  // ─── DOM Utilities ───────────────────────────────────────────────────────

  /**
   * Create a DOM element with optional attributes and children.
   * @param {string} tag
   * @param {Object} [attrs]
   * @param {(string|Node)[]} [children]
   * @returns {HTMLElement}
   */
  function createElement(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
      if (key === 'className') {
        el.className = val;
      } else if (key === 'dataset') {
        for (const [dk, dv] of Object.entries(val)) {
          el.dataset[dk] = dv;
        }
      } else if (key.startsWith('aria')) {
        el.setAttribute(key.replace(/([A-Z])/g, '-$1').toLowerCase(), val);
      } else {
        el[key] = val;
      }
    }
    for (const child of children) {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        el.appendChild(child);
      }
    }
    return el;
  }

  /**
   * Show a temporary toast/feedback message on a button.
   * @param {HTMLElement} btn
   * @param {string} message
   * @param {number} [duration=1500]
   */
  function showButtonFeedback(btn, message, duration = 1500) {
    const original = btn.textContent;
    const originalClass = btn.className;
    btn.textContent = message;
    btn.classList.add('btn--feedback');
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.className = originalClass;
      btn.disabled = false;
    }, duration);
  }

  /**
   * Animate a status bar message.
   * @param {HTMLElement} el
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} [type='info']
   * @param {number} [duration=3000]
   */
  function setStatus(el, message, type = 'info', duration = 3000) {
    if (!el) return;
    el.textContent = message;
    el.className = `status-bar status-bar--${type}`;
    el.removeAttribute('hidden');
    if (duration > 0) {
      setTimeout(() => {
        el.textContent = '';
        el.setAttribute('hidden', '');
      }, duration);
    }
  }

  // ─── JSON Utilities ──────────────────────────────────────────────────────

  /**
   * Attempt to parse and pretty-print JSON.
   * @param {string} text
   * @returns {{ success: boolean, result: string, error?: string }}
   */
  function formatJSON(text) {
    if (!text || !text.trim()) {
      return { success: false, result: text };
    }
    try {
      const parsed = JSON.parse(text);
      return { success: true, result: JSON.stringify(parsed, null, 2) };
    } catch (e) {
      return { success: false, result: text, error: e.message };
    }
  }

  // ─── Size Guard ──────────────────────────────────────────────────────────

  /**
   * Estimate if input is "large" and may be slow to process.
   * @param {string} text
   * @param {number} [lineThreshold=5000]
   * @returns {boolean}
   */
  function isLargeInput(text, lineThreshold = 5000) {
    let count = 0;
    for (const ch of text) {
      if (ch === '\n') count++;
      if (count >= lineThreshold) return true;
    }
    return false;
  }

  // ─── Scroll Sync ─────────────────────────────────────────────────────────

  /**
   * Synchronize scroll positions between two scrollable elements.
   * Returns a cleanup function to remove the listeners.
   * @param {HTMLElement} elA
   * @param {HTMLElement} elB
   * @returns {Function} cleanup
   */
  function syncScroll(elA, elB) {
    let syncing = false;

    const onScrollA = throttle(() => {
      if (syncing) return;
      syncing = true;
      const ratio = elA.scrollTop / Math.max(1, elA.scrollHeight - elA.clientHeight);
      elB.scrollTop = ratio * (elB.scrollHeight - elB.clientHeight);
      const ratioH = elA.scrollLeft / Math.max(1, elA.scrollWidth - elA.clientWidth);
      elB.scrollLeft = ratioH * (elB.scrollWidth - elB.clientWidth);
      requestAnimationFrame(() => { syncing = false; });
    }, 16);

    const onScrollB = throttle(() => {
      if (syncing) return;
      syncing = true;
      const ratio = elB.scrollTop / Math.max(1, elB.scrollHeight - elB.clientHeight);
      elA.scrollTop = ratio * (elA.scrollHeight - elA.clientHeight);
      const ratioH = elB.scrollLeft / Math.max(1, elB.scrollWidth - elB.clientWidth);
      elA.scrollLeft = ratioH * (elA.scrollWidth - elA.clientWidth);
      requestAnimationFrame(() => { syncing = false; });
    }, 16);

    elA.addEventListener('scroll', onScrollA, { passive: true });
    elB.addEventListener('scroll', onScrollB, { passive: true });

    return function cleanup() {
      elA.removeEventListener('scroll', onScrollA);
      elB.removeEventListener('scroll', onScrollB);
    };
  }

  return {
    splitLines,
    escapeHTML,
    preserveWhitespace,
    formatNumber,
    truncate,
    countLines,
    debounce,
    throttle,
    copyToClipboard,
    createElement,
    showButtonFeedback,
    setStatus,
    formatJSON,
    isLargeInput,
    syncScroll
  };
})();