/**
 * renderer.js
 *
 * Converts diff operations into DOM elements for display.
 * Supports two rendering modes:
 *   - Side-by-side: two columns, aligned by operation
 *   - Inline: single column with both additions and deletions shown
 *
 * Uses DocumentFragment for batch DOM insertion (performance).
 * Uses textContent exclusively — no innerHTML with user data.
 */

'use strict';

const Renderer = (() => {

  const OP = DiffEngine.OP;

  // ─── Row Builders ────────────────────────────────────────────────────────

  /**
   * Create a line number cell.
   * @param {number|string} num - line number or empty string
   * @param {string} side - 'left' | 'right'
   * @returns {HTMLElement}
   */
  function makeLineNum(num, side) {
    const el = document.createElement('td');
    el.className = `line-num line-num--${side}`;
    el.setAttribute('aria-hidden', 'true');
    if (num !== '') el.textContent = num;
    return el;
  }

  /**
   * Create a line content cell.
   * @param {string} text - raw line text (unescaped)
   * @param {string} type - 'equal' | 'insert' | 'delete' | 'replace-del' | 'replace-ins' | 'empty'
   * @param {Array} [tokens] - optional word-level tokens [{text, type}]
   * @returns {HTMLElement}
   */
  function makeLineCell(text, type, tokens) {
    const td = document.createElement('td');
    td.className = `line-content line-content--${type}`;

    const code = document.createElement('code');

    if (tokens && tokens.length > 0) {
      // Word-level highlighting
      const fragment = document.createDocumentFragment();
      for (const token of tokens) {
        if (token.type === 'equal') {
          fragment.appendChild(document.createTextNode(token.text));
        } else {
          const span = document.createElement('span');
          span.className = `word-diff word-diff--${token.type}`;
          span.textContent = token.text;
          fragment.appendChild(span);
        }
      }
      code.appendChild(fragment);
    } else {
      code.textContent = text;
    }

    td.appendChild(code);
    return td;
  }

  /**
   * Create an empty filler cell (for side-by-side alignment).
   * @returns {HTMLElement}
   */
  function makeEmptyCell() {
    const td = document.createElement('td');
    td.className = 'line-content line-content--empty';
    td.setAttribute('aria-hidden', 'true');
    const code = document.createElement('code');
    td.appendChild(code);
    return td;
  }

  /**
   * Create a full table row for side-by-side view.
   * @param {Object} config
   * @returns {HTMLTableRowElement}
   */
  function makeSideBySideRow({ leftNum, rightNum, leftText, rightText,
                               leftType, rightType, leftTokens, rightTokens,
                               leftEmpty, rightEmpty }) {
    const tr = document.createElement('tr');
    tr.className = `diff-row diff-row--${leftType || rightType}`;

    // Left side
    tr.appendChild(makeLineNum(leftNum !== undefined ? leftNum : '', 'left'));
    if (leftEmpty) {
      tr.appendChild(makeEmptyCell());
    } else {
      tr.appendChild(makeLineCell(leftText, leftType, leftTokens));
    }

    // Right side
    tr.appendChild(makeLineNum(rightNum !== undefined ? rightNum : '', 'right'));
    if (rightEmpty) {
      tr.appendChild(makeEmptyCell());
    } else {
      tr.appendChild(makeLineCell(rightText, rightType, rightTokens));
    }

    return tr;
  }

  /**
   * Create a full table row for inline view.
   * @param {Object} config
   * @returns {HTMLTableRowElement}
   */
  function makeInlineRow({ lineNum, text, type, tokens, side }) {
    const tr = document.createElement('tr');
    tr.className = `diff-row diff-row--${type} diff-row--${side}`;

    const numCell = document.createElement('td');
    numCell.className = 'line-num';
    numCell.setAttribute('aria-hidden', 'true');
    numCell.textContent = lineNum !== undefined ? lineNum : '';
    tr.appendChild(numCell);

    const marker = document.createElement('td');
    marker.className = `line-marker line-marker--${type}`;
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = type === 'insert' ? '+' : type === 'delete' ? '−' : ' ';
    tr.appendChild(marker);

    tr.appendChild(makeLineCell(text, type, tokens));

    return tr;
  }

  // ─── Side-by-Side Renderer ───────────────────────────────────────────────

  /**
   * Render diff operations as side-by-side table rows.
   * @param {Array} ops - diff operations from DiffEngine
   * @returns {DocumentFragment}
   */
  function renderSideBySide(ops) {
    const fragment = document.createDocumentFragment();

    // Line counters (1-based for display)
    let leftLine = 1;
    let rightLine = 1;

    for (const op of ops) {
      let row;

      switch (op.type) {
        case OP.EQUAL:
          row = makeSideBySideRow({
            leftNum: leftLine,
            rightNum: rightLine,
            leftText: op.line,
            rightText: op.line,
            leftType: 'equal',
            rightType: 'equal'
          });
          fragment.appendChild(row);
          leftLine++;
          rightLine++;
          break;

        case OP.DELETE:
          row = makeSideBySideRow({
            leftNum: leftLine,
            rightNum: undefined,
            leftText: op.line,
            rightText: '',
            leftType: 'delete',
            rightType: 'delete',
            rightEmpty: true
          });
          fragment.appendChild(row);
          leftLine++;
          break;

        case OP.INSERT:
          row = makeSideBySideRow({
            leftNum: undefined,
            rightNum: rightLine,
            leftText: '',
            rightText: op.line,
            leftType: 'insert',
            rightType: 'insert',
            leftEmpty: true
          });
          fragment.appendChild(row);
          rightLine++;
          break;

        case OP.REPLACE:
          row = makeSideBySideRow({
            leftNum: leftLine,
            rightNum: rightLine,
            leftText: op.aLine,
            rightText: op.bLine,
            leftType: 'replace-del',
            rightType: 'replace-ins',
            leftTokens: op.aTokens,
            rightTokens: op.bTokens
          });
          fragment.appendChild(row);
          leftLine++;
          rightLine++;
          break;
      }
    }

    return fragment;
  }

  // ─── Inline Renderer ─────────────────────────────────────────────────────

  /**
   * Render diff operations as inline (unified) table rows.
   * @param {Array} ops
   * @returns {DocumentFragment}
   */
  function renderInline(ops) {
    const fragment = document.createDocumentFragment();

    let leftLine = 1;
    let rightLine = 1;

    for (const op of ops) {
      switch (op.type) {
        case OP.EQUAL: {
          const row = makeInlineRow({
            lineNum: leftLine,
            text: op.line,
            type: 'equal',
            side: 'both'
          });
          fragment.appendChild(row);
          leftLine++;
          rightLine++;
          break;
        }

        case OP.DELETE: {
          const row = makeInlineRow({
            lineNum: leftLine,
            text: op.line,
            type: 'delete',
            side: 'left'
          });
          fragment.appendChild(row);
          leftLine++;
          break;
        }

        case OP.INSERT: {
          const row = makeInlineRow({
            lineNum: rightLine,
            text: op.line,
            type: 'insert',
            side: 'right'
          });
          fragment.appendChild(row);
          rightLine++;
          break;
        }

        case OP.REPLACE: {
          const rowDel = makeInlineRow({
            lineNum: leftLine,
            text: op.aLine,
            type: 'delete',
            side: 'left',
            tokens: op.aTokens
          });
          const rowIns = makeInlineRow({
            lineNum: rightLine,
            text: op.bLine,
            type: 'insert',
            side: 'right',
            tokens: op.bTokens
          });
          fragment.appendChild(rowDel);
          fragment.appendChild(rowIns);
          leftLine++;
          rightLine++;
          break;
        }
      }
    }

    return fragment;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Main render function. Clears target table and populates with diff rows.
   * @param {HTMLTableSectionElement} tbody - target <tbody> element
   * @param {Array} ops - diff operations
   * @param {'side-by-side'|'inline'} mode
   */
  function render(tbody, ops, mode = 'side-by-side') {
    // Clear previous content efficiently
    tbody.textContent = '';

    const fragment = mode === 'inline'
      ? renderInline(ops)
      : renderSideBySide(ops);

    tbody.appendChild(fragment);
  }

  /**
   * Render statistics into a stats container.
   * @param {Object} statsEls - { added, removed, changed, unchanged }
   * @param {Object} stats - { added, removed, changed, unchanged }
   */
  function renderStats(statsEls, stats) {
    for (const [key, el] of Object.entries(statsEls)) {
      if (el && stats[key] !== undefined) {
        el.textContent = Utils.formatNumber(stats[key]);
      }
    }
  }

  return {
    render,
    renderStats
  };
})();