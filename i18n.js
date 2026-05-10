/**
 * i18n.js
 * Lightweight internationalization wrapper around chrome.i18n API.
 * Falls back gracefully when messages are missing.
 */

'use strict';

const I18n = (() => {
  /**
   * Retrieve a localized message by key.
   * @param {string} key - The message key from messages.json
   * @param {string|string[]} [substitutions] - Optional substitutions
   * @returns {string} Localized string or key as fallback
   */
  function getMessage(key, substitutions) {
    try {
      const msg = chrome.i18n.getMessage(key, substitutions);
      return msg || key;
    } catch {
      return key;
    }
  }

  /**
   * Apply i18n to all elements with data-i18n attribute.
   * Supports:
   *   data-i18n="key"              → sets textContent
   *   data-i18n-placeholder="key"  → sets placeholder attribute
   *   data-i18n-title="key"        → sets title attribute
   *   data-i18n-aria="key"         → sets aria-label attribute
   */
  function applyToDOM() {
    // Text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const msg = getMessage(key);
      if (msg && msg !== key) el.textContent = msg;
    });

    // Placeholder attributes
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const msg = getMessage(key);
      if (msg && msg !== key) el.placeholder = msg;
    });

    // Title attributes (tooltips)
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      const msg = getMessage(key);
      if (msg && msg !== key) el.title = msg;
    });

    // ARIA labels
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      const msg = getMessage(key);
      if (msg && msg !== key) el.setAttribute('aria-label', msg);
    });
  }

  /**
   * Get the current UI locale.
   * @returns {string} BCP 47 language tag
   */
  function getLocale() {
    try {
      return chrome.i18n.getUILanguage() || 'en';
    } catch {
      return 'en';
    }
  }

  /**
   * Check if the current locale is RTL.
   * @returns {boolean}
   */
  function isRTL() {
    const rtlLocales = [
      'ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'ku', 'ckb', 'dv'
    ];
    const lang = getLocale().split('-')[0].toLowerCase();
    return rtlLocales.includes(lang);
  }

  return {
    getMessage,
    applyToDOM,
    getLocale,
    isRTL,
    // Shorthand alias
    t: getMessage
  };
})();