/**
 * diffEngine.js
 *
 * Implements a line-based diff algorithm using an optimized
 * Longest Common Subsequence (LCS) approach.
 *
 * Algorithm:
 *   1. Hash each line for O(1) equality comparison
 *   2. For normal inputs: build full LCS table, backtrack for edit operations
 *   3. For large inputs: use patience diff (anchor-based decomposition)
 *   4. For very large inputs: use fast prefix/suffix matching
 *   5. Post-process to merge adjacent removed/added pairs into replaces
 *   6. Optionally compute word-level diff for replaced lines
 *
 * Complexity:
 *   Normal:   O(N*M) time and space
 *   Patience: O(N*M) worst case, but typically much smaller sub-problems
 *   Fast:     O(N+M) time
 */

'use strict';

const DiffEngine = (() => {

  // ─── Constants ───────────────────────────────────────────────────────────

  const OP = Object.freeze({
    EQUAL:   'equal',
    INSERT:  'insert',
    DELETE:  'delete',
    REPLACE: 'replace'
  });

  // Threshold above which patience diff is used instead of full LCS
  const LARGE_INPUT_THRESHOLD = 2000;

  // Hard limit above which fast diff is always used
  const HARD_LIMIT = 5000;

  // ─── Hashing ─────────────────────────────────────────────────────────────

  /**
   * Build a map of line content → integer index for fast comparison.
   * This reduces string equality O(L) to integer equality O(1).
   * @param {string[]} lines
   * @param {Map<string, number>} lineMap - shared map to mutate
   * @returns {number[]} integer-encoded lines
   */
  function encodeLines(lines, lineMap) {
    const encoded = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!lineMap.has(line)) {
        lineMap.set(line, lineMap.size);
      }
      encoded[i] = lineMap.get(line);
    }
    return encoded;
  }

  // ─── LCS Core ────────────────────────────────────────────────────────────

  /**
   * Compute LCS length table using integer-encoded lines.
   * Stores the full (n+1)×(m+1) table as a flat Int32Array.
   * @param {number[]} a - encoded original lines
   * @param {number[]} b - encoded modified lines
   * @returns {Int32Array} LCS table
   */
  function computeLCS(a, b) {
    const n = a.length;
    const m = b.length;

    const table = new Int32Array((n + 1) * (m + 1));

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (a[i - 1] === b[j - 1]) {
          table[i * (m + 1) + j] = table[(i - 1) * (m + 1) + (j - 1)] + 1;
        } else {
          const top  = table[(i - 1) * (m + 1) + j];
          const left = table[i * (m + 1) + (j - 1)];
          table[i * (m + 1) + j] = top > left ? top : left;
        }
      }
    }

    return table;
  }

  /**
   * Backtrack LCS table to produce edit operations.
   * @param {Int32Array} table
   * @param {number[]} a
   * @param {number[]} b
   * @param {string[]} aLines - original string lines
   * @param {string[]} bLines - modified string lines
   * @returns {Array<{type: string, aIndex?: number, bIndex?: number, aLine?: string, bLine?: string, line?: string}>}
   */
  function backtrack(table, a, b, aLines, bLines) {
    const ops = [];
    let i = a.length;
    let j = b.length;
    const m = b.length;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        ops.push({ type: OP.EQUAL, aIndex: i - 1, bIndex: j - 1, line: aLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || table[i * (m + 1) + (j - 1)] >= table[(i - 1) * (m + 1) + j])) {
        ops.push({ type: OP.INSERT, bIndex: j - 1, line: bLines[j - 1] });
        j--;
      } else {
        ops.push({ type: OP.DELETE, aIndex: i - 1, line: aLines[i - 1] });
        i--;
      }
    }

    return ops.reverse();
  }

  // ─── Replace Detection ───────────────────────────────────────────────────

  /**
   * Post-process operations to merge adjacent DELETE+INSERT or INSERT+DELETE
   * pairs into REPLACE operations.
   * Handles both orderings because LCS tie-breaking can produce either.
   * @param {Array} ops
   * @returns {Array}
   */
  function mergeReplaces(ops) {
    const merged = [];
    let i = 0;

    while (i < ops.length) {
      const op = ops[i];

      if (op.type === OP.DELETE || op.type === OP.INSERT) {
        const firstType = op.type;
        const secondType = firstType === OP.DELETE ? OP.INSERT : OP.DELETE;

        // Collect consecutive ops of the first type
        const first = [];
        while (i < ops.length && ops[i].type === firstType) {
          first.push(ops[i]);
          i++;
        }
        // Collect consecutive ops of the opposite type immediately after
        const second = [];
        while (i < ops.length && ops[i].type === secondType) {
          second.push(ops[i]);
          i++;
        }

        const deletes = firstType === OP.DELETE ? first : second;
        const inserts = firstType === OP.INSERT ? first : second;

        if (inserts.length === 0) {
          // Pure deletions or pure insertions
          merged.push(...deletes);
        } else if (deletes.length === 0) {
          merged.push(...inserts);
        } else {
          // Pair up deletes and inserts as REPLACE operations
          const maxPairs = Math.min(deletes.length, inserts.length);
          for (let k = 0; k < maxPairs; k++) {
            merged.push({
              type: OP.REPLACE,
              aIndex: deletes[k].aIndex,
              bIndex: inserts[k].bIndex,
              aLine: deletes[k].line,
              bLine: inserts[k].line
            });
          }
          // Remaining unmatched deletes
          for (let k = maxPairs; k < deletes.length; k++) {
            merged.push(deletes[k]);
          }
          // Remaining unmatched inserts
          for (let k = maxPairs; k < inserts.length; k++) {
            merged.push(inserts[k]);
          }
        }
      } else {
        merged.push(op);
        i++;
      }
    }

    return merged;
  }

  // ─── Word-Level Diff ─────────────────────────────────────────────────────

  /**
   * Tokenize a string into words and punctuation for word-level diff.
   * Preserves whitespace as tokens.
   * @param {string} str
   * @returns {string[]}
   */
  function tokenizeWords(str) {
    return str.split(/(\s+|[^\w\s]+)/u).filter(t => t.length > 0);
  }

  /**
   * Compute a simple word-level diff between two strings.
   * Returns arrays of {text, type} objects for rendering.
   * @param {string} aLine
   * @param {string} bLine
   * @returns {{ aTokens: Array, bTokens: Array }}
   */
  function computeWordDiff(aLine, bLine) {
    const aWords = tokenizeWords(aLine);
    const bWords = tokenizeWords(bLine);

    if (aWords.length === 0 && bWords.length === 0) {
      return { aTokens: [], bTokens: [] };
    }

    // Build LCS for word tokens
    const wordMap = new Map();
    const a = encodeLines(aWords, wordMap);
    const b = encodeLines(bWords, wordMap);

    const table = computeLCS(a, b);
    const m = b.length;

    const aTokens = [];
    const bTokens = [];

    let i = a.length;
    let j = b.length;

    const wordOps = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        wordOps.push({ type: OP.EQUAL, aWord: aWords[i - 1], bWord: bWords[j - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || table[i * (m + 1) + (j - 1)] >= table[(i - 1) * (m + 1) + j])) {
        wordOps.push({ type: OP.INSERT, bWord: bWords[j - 1] });
        j--;
      } else {
        wordOps.push({ type: OP.DELETE, aWord: aWords[i - 1] });
        i--;
      }
    }

    wordOps.reverse().forEach(op => {
      if (op.type === OP.EQUAL) {
        aTokens.push({ text: op.aWord, type: 'equal' });
        bTokens.push({ text: op.bWord, type: 'equal' });
      } else if (op.type === OP.DELETE) {
        aTokens.push({ text: op.aWord, type: 'delete' });
      } else if (op.type === OP.INSERT) {
        bTokens.push({ text: op.bWord, type: 'insert' });
      }
    });

    return { aTokens, bTokens };
  }

  // ─── Patience Diff Optimization ──────────────────────────────────────────

  /**
   * Identify unique common lines between a and b (patience diff optimization).
   * Returns line codes that appear exactly once in both arrays.
   * @param {number[]} a
   * @param {number[]} b
   * @returns {Set<number>}
   */
  function findUniqueCommonLines(a, b) {
    const countA = new Map();
    const countB = new Map();
    for (const code of a) countA.set(code, (countA.get(code) || 0) + 1);
    for (const code of b) countB.set(code, (countB.get(code) || 0) + 1);
    const unique = new Set();
    for (const [code, cnt] of countA) {
      if (cnt === 1 && countB.get(code) === 1) unique.add(code);
    }
    return unique;
  }

  /**
   * Find the longest increasing subsequence and return the indices.
   * Uses patience sorting — O(N log N).
   * @param {number[]} arr
   * @returns {number[]} indices into arr that form the LIS
   */
  function longestIncreasingSubsequence(arr) {
    if (arr.length === 0) return [];

    const tails = [];
    const tailIdx = [];
    const prev = new Array(arr.length).fill(-1);

    for (let i = 0; i < arr.length; i++) {
      let lo = 0, hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tails[mid] < arr[i]) lo = mid + 1;
        else hi = mid;
      }

      if (lo > 0) prev[i] = tailIdx[lo - 1];
      if (lo === tails.length) {
        tails.push(arr[i]);
        tailIdx.push(i);
      } else {
        tails[lo] = arr[i];
        tailIdx[lo] = i;
      }
    }

    const result = [];
    let idx = tailIdx[tailIdx.length - 1];
    while (idx >= 0) {
      result.unshift(idx);
      idx = prev[idx];
    }
    return result;
  }

  // ─── Fast Diff (for very large inputs) ───────────────────────────────────

  /**
   * Fast O(N+M) diff using common prefix/suffix matching.
   * Less precise but guaranteed fast for any input size.
   * @param {string[]} aLines
   * @param {string[]} bLines
   * @returns {Array}
   */
  function fastDiff(aLines, bLines) {
    const ops = [];
    const n = aLines.length;
    const m = bLines.length;

    // Common prefix
    let prefix = 0;
    const minLen = Math.min(n, m);
    while (prefix < minLen && aLines[prefix] === bLines[prefix]) {
      ops.push({ type: OP.EQUAL, aIndex: prefix, bIndex: prefix, line: aLines[prefix] });
      prefix++;
    }

    // Common suffix (don't overlap with prefix)
    let suffix = 0;
    while (suffix < (minLen - prefix) &&
           aLines[n - 1 - suffix] === bLines[m - 1 - suffix]) {
      suffix++;
    }

    // Changed middle: pair up as replaces, remainder as deletes/inserts
    const midA = aLines.slice(prefix, n - suffix);
    const midB = bLines.slice(prefix, m - suffix);
    const pairs = Math.min(midA.length, midB.length);

    for (let i = 0; i < pairs; i++) {
      ops.push({
        type: OP.REPLACE,
        aIndex: prefix + i,
        bIndex: prefix + i,
        aLine: midA[i],
        bLine: midB[i]
      });
    }
    for (let i = pairs; i < midA.length; i++) {
      ops.push({ type: OP.DELETE, aIndex: prefix + i, line: midA[i] });
    }
    for (let i = pairs; i < midB.length; i++) {
      ops.push({ type: OP.INSERT, bIndex: prefix + i, line: midB[i] });
    }

    // Common suffix
    for (let i = 0; i < suffix; i++) {
      ops.push({
        type: OP.EQUAL,
        aIndex: n - suffix + i,
        bIndex: m - suffix + i,
        line: aLines[n - suffix + i]
      });
    }

    return ops;
  }

  // ─── Patience Diff ───────────────────────────────────────────────────────

  /**
   * Patience diff: use unique common lines as anchors to decompose
   * the problem into smaller sub-problems, then run LCS on each.
   * @param {string[]} aLines
   * @param {string[]} bLines
   * @param {number[]} a - encoded lines
   * @param {number[]} b - encoded lines
   * @returns {Array}
   */
  function patienceDiff(aLines, bLines, a, b) {
    const uniqueCommon = findUniqueCommonLines(a, b);

    // Build anchor pairs: (indexInA, indexInB) for unique common lines
    const posA = new Map();
    for (let i = 0; i < a.length; i++) {
      if (uniqueCommon.has(a[i]) && !posA.has(a[i])) {
        posA.set(a[i], i);
      }
    }

    const pairs = [];
    for (let i = 0; i < b.length; i++) {
      if (uniqueCommon.has(b[i]) && posA.has(b[i])) {
        pairs.push({ aIdx: posA.get(b[i]), bIdx: i });
      }
    }

    // Sort by position in A, find LIS by position in B for best anchor chain
    pairs.sort((x, y) => x.aIdx - y.aIdx);
    const lisIndices = longestIncreasingSubsequence(pairs.map(p => p.bIdx));
    const anchors = lisIndices.map(i => pairs[i]);

    // If no useful anchors found, fall back to fast diff
    if (anchors.length === 0) {
      return fastDiff(aLines, bLines);
    }

    // Add sentinel anchors at boundaries
    anchors.unshift({ aIdx: -1, bIdx: -1 });
    anchors.push({ aIdx: a.length, bIdx: b.length });

    const ops = [];

    for (let k = 0; k < anchors.length - 1; k++) {
      // Emit the anchor line itself (skip sentinels)
      if (k > 0) {
        ops.push({
          type: OP.EQUAL,
          aIndex: anchors[k].aIdx,
          bIndex: anchors[k].bIdx,
          line: aLines[anchors[k].aIdx]
        });
      }

      const startA = anchors[k].aIdx + 1;
      const endA = anchors[k + 1].aIdx;
      const startB = anchors[k].bIdx + 1;
      const endB = anchors[k + 1].bIdx;

      if (startA >= endA && startB >= endB) continue;

      if (startA >= endA) {
        // Only insertions
        for (let i = startB; i < endB; i++) {
          ops.push({ type: OP.INSERT, bIndex: i, line: bLines[i] });
        }
      } else if (startB >= endB) {
        // Only deletions
        for (let i = startA; i < endA; i++) {
          ops.push({ type: OP.DELETE, aIndex: i, line: aLines[i] });
        }
      } else {
        // Sub-problem: diff the region between anchors
        const subA = a.slice(startA, endA);
        const subB = b.slice(startB, endB);
        const subALines = aLines.slice(startA, endA);
        const subBLines = bLines.slice(startB, endB);

        if (subA.length < LARGE_INPUT_THRESHOLD && subB.length < LARGE_INPUT_THRESHOLD) {
          // Small enough for full LCS
          const subTable = computeLCS(subA, subB);
          const subOps = backtrack(subTable, subA, subB, subALines, subBLines);
          const mergedSubOps = mergeReplaces(subOps);

          for (const op of mergedSubOps) {
            if (op.aIndex !== undefined) op.aIndex += startA;
            if (op.bIndex !== undefined) op.bIndex += startB;
            ops.push(op);
          }
        } else {
          // Still too large — recurse with patience diff
          const subOps = patienceDiff(subALines, subBLines, subA, subB);
          for (const op of subOps) {
            if (op.aIndex !== undefined) op.aIndex += startA;
            if (op.bIndex !== undefined) op.bIndex += startB;
            ops.push(op);
          }
        }
      }
    }

    return ops;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Compute the diff between two text strings.
   * @param {string} originalText
   * @param {string} modifiedText
   * @param {Object} [options]
   * @param {boolean} [options.wordDiff=false] - Enable word-level diff for REPLACE ops
   * @returns {DiffResult}
   */
  function diff(originalText, modifiedText, options = {}) {
    const { wordDiff = false } = options;

    const aLines = Utils.splitLines(originalText);
    const bLines = Utils.splitLines(modifiedText);

    const lineMap = new Map();
    const a = encodeLines(aLines, lineMap);
    const b = encodeLines(bLines, lineMap);

    let ops;

    if (a.length === 0 && b.length === 0) {
      ops = [];
    } else if (a.length === 0) {
      ops = bLines.map((line, i) => ({ type: OP.INSERT, bIndex: i, line }));
    } else if (b.length === 0) {
      ops = aLines.map((line, i) => ({ type: OP.DELETE, aIndex: i, line }));
    } else if (a.length >= HARD_LIMIT || b.length >= HARD_LIMIT) {
      // Very large: use fast diff to avoid freezing
      ops = fastDiff(aLines, bLines);
    } else if (a.length >= LARGE_INPUT_THRESHOLD || b.length >= LARGE_INPUT_THRESHOLD) {
      // Large: use patience diff to reduce sub-problem sizes
      ops = patienceDiff(aLines, bLines, a, b);
    } else {
      // Normal: full LCS
      const table = computeLCS(a, b);
      const rawOps = backtrack(table, a, b, aLines, bLines);
      ops = mergeReplaces(rawOps);
    }

    // Optionally enrich REPLACE ops with word-level diff
    if (wordDiff) {
      ops = ops.map(op => {
        if (op.type === OP.REPLACE) {
          const { aTokens, bTokens } = computeWordDiff(op.aLine, op.bLine);
          return { ...op, aTokens, bTokens };
        }
        return op;
      });
    }

    // Compute statistics
    const stats = computeStats(ops);

    return { ops, stats, aLines, bLines };
  }

  /**
   * @typedef {Object} DiffStats
   * @property {number} added
   * @property {number} removed
   * @property {number} changed
   * @property {number} unchanged
   * @property {number} total
   */

  /**
   * Compute summary statistics from diff operations.
   * @param {Array} ops
   * @returns {DiffStats}
   */
  function computeStats(ops) {
    const stats = { added: 0, removed: 0, changed: 0, unchanged: 0, total: 0 };
    for (const op of ops) {
      switch (op.type) {
        case OP.EQUAL:   stats.unchanged++; break;
        case OP.INSERT:  stats.added++;     break;
        case OP.DELETE:  stats.removed++;   break;
        case OP.REPLACE: stats.changed++;   break;
      }
    }
    stats.total = stats.added + stats.removed + stats.changed + stats.unchanged;
    return stats;
  }

  /**
   * Check if two texts are identical.
   * @param {string} a
   * @param {string} b
   * @returns {boolean}
   */
  function areIdentical(a, b) {
    return a === b;
  }

  return {
    diff,
    areIdentical,
    OP
  };
})();