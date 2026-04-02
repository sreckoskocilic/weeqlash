#!/usr/bin/env node
/**
 * Detects unused CSS selectors in HTML files with inline <style> blocks.
 *
 * Checks ID selectors (#foo), class selectors (.foo), and their usage
 * in HTML attributes and JS code (classList, getElementById, querySelector, etc.)
 *
 * Usage: node scripts/unused-css-check.js [file...]
 * Default: checks client/index.html
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const files = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ['client/index.html'];

let totalUnused = 0;

for (const file of files) {
  const fullPath = resolve(file);
  const content = readFileSync(fullPath, 'utf8');

  // Split HTML and JS portions
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  const jsContent = scriptMatch ? scriptMatch[1] : '';

  // Extract CSS from <style> blocks
  const styleMatches = [...content.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  if (styleMatches.length === 0) continue;

  const cssContent = styleMatches.map(m => m[1]).join('\n');

  // Extract selectors from CSS (skip @-rules, keyframes content, comments)
  const selectors = extractSelectors(cssContent);
  if (selectors.length === 0) continue;

  // Remove CSS blocks from content for HTML checking (avoid false matches in CSS itself)
  const htmlOnly = content.replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');

  const unused = [];

  for (const { selector, line } of selectors) {
    if (!isSelectorUsed(selector, htmlOnly, jsContent, cssContent)) {
      unused.push({ selector, line });
    }
  }

  if (unused.length > 0) {
    totalUnused += unused.length;
    console.log(`\n${file}: ${unused.length} unused selector(s):`);
    for (const { selector, line } of unused) {
      console.log(`  line ${line}: ${selector}`);
    }
  }
}

if (totalUnused > 0) {
  console.log(`\nTotal: ${totalUnused} unused CSS selector(s)`);
  process.exit(1);
} else {
  console.log('No unused CSS selectors found.');
  process.exit(0);
}

// --- Helpers ---

function extractSelectors(css) {
  const selectors = [];
  const lines = css.split('\n');

  // Remove comments
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Track line numbers by building a map
  let lineNum = 1;
  const charToLine = [];
  for (let i = 0; i < css.length; i++) {
    charToLine[i] = lineNum;
    if (css[i] === '\n') lineNum++;
  }

  // Find all rule blocks: selector { ... }
  // This is a simplified parser that handles most common cases
  let i = 0;
  while (i < cleaned.length) {
    // Skip @-rule bodies (keyframes, media, etc.)
    if (cleaned[i] === '@') {
      i = skipAtRule(cleaned, i);
      continue;
    }

    // Find the next { that starts a rule block
    const braceIdx = cleaned.indexOf('{', i);
    if (braceIdx === -1) break;

    // Extract the selector text (everything from current position to the {)
    const selectorText = cleaned.substring(i, braceIdx).trim();

    // Find the matching closing brace
    let depth = 1;
    let j = braceIdx + 1;
    while (j < cleaned.length && depth > 0) {
      if (cleaned[j] === '{') depth++;
      if (cleaned[j] === '}') depth--;
      j++;
    }

    if (selectorText && !selectorText.startsWith('@')) {
      // Split comma-separated selectors
      const parts = selectorText.split(',');
      for (const part of parts) {
        const sel = part.trim();
        if (sel) {
          const line = charToLine[i] || 1;
          selectors.push({ selector: sel, line });
        }
      }
    }

    i = j;
  }

  return selectors;
}

function skipAtRule(css, start) {
  // Find the opening brace
  const braceIdx = css.indexOf('{', start);
  if (braceIdx === -1) return css.length;

  // Check if this is a keyframes rule - skip its entire body
  const atRule = css.substring(start, braceIdx).trim();
  if (atRule.startsWith('@keyframes')) {
    let depth = 1;
    let j = braceIdx + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      if (css[j] === '}') depth--;
      j++;
    }
    return j;
  }

  // For other @-rules (media, etc.), process their contents normally
  // by returning past the opening brace
  return braceIdx + 1;
}

function isSelectorUsed(selector, html, js, css) {
  // Extract the "hook" from the selector (the ID or class that can be checked)
  const hooks = extractHooks(selector);

  for (const { type, value } of hooks) {
    if (type === 'id') {
      if (html.includes(`id="${value}"`) || html.includes(`id='${value}'`)) return true;
      if (js.includes(`getElementById('${value}')`) || js.includes(`getElementById("${value}")`)) return true;
      if (js.includes(`$('${value}')`) || js.includes(`$("${value}")`)) return true;
      if (js.includes(`#${value}`)) return true; // querySelector references
    }

    if (type === 'class') {
      // Check HTML class attributes
      const classRegex = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRegex(value)}\\b[^"']*["']`);
      if (classRegex.test(html)) return true;

      // Check JS class manipulation
      if (js.includes(`'${value}'`) || js.includes(`"${value}"`)) {
        // Verify it's used in a class-related context
        const jsClassRegex = new RegExp(`(?:classList|className|class=|addClass|removeClass|toggleClass|querySelector|getElementsByClassName)['"(.*]*[^a-zA-Z0-9_-]${escapeRegex(value)}[^a-zA-Z0-9_-]`);
        if (jsClassRegex.test(js)) return true;
      }

      // Check for class in querySelector/querySelectorAll
      if (js.includes(`.${value}`)) return true;
    }

    if (type === 'element') {
      // Element selectors are too common to flag (div, span, etc.)
      return true;
    }

    if (type === 'attribute') {
      // Check for attribute usage in HTML
      if (html.includes(value)) return true;
    }

    if (type === 'pseudo' || type === 'combinator' || type === 'universal') {
      // Can't reliably check these
      return true;
    }
  }

  // If we couldn't extract any hooks, consider it used (avoid false positives)
  if (hooks.length === 0) return true;

  return false;
}

function extractHooks(selector) {
  const hooks = [];

  // Handle compound selectors like .foo.bar, #id.class, etc.
  // Extract all IDs
  const idMatches = selector.match(/#([a-zA-Z][a-zA-Z0-9_-]*)/g);
  if (idMatches) {
    for (const m of idMatches) {
      hooks.push({ type: 'id', value: m.slice(1) });
    }
  }

  // Extract all classes (but not inside :not(), :is(), etc.)
  // Remove pseudo-class arguments first
  const cleaned = selector.replace(/:(?:not|is|has|where|matches)\([^)]*\)/g, '');
  const classMatches = cleaned.match(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g);
  if (classMatches) {
    for (const m of classMatches) {
      hooks.push({ type: 'class', value: m.slice(1) });
    }
  }

  // If no IDs or classes, check for element selectors
  if (hooks.length === 0) {
    const elementMatch = selector.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
    if (elementMatch) {
      hooks.push({ type: 'element', value: elementMatch[1] });
    }
  }

  // Check for attribute selectors
  const attrMatches = selector.match(/\[([a-zA-Z][a-zA-Z0-9_-]*)/g);
  if (attrMatches) {
    for (const m of attrMatches) {
      hooks.push({ type: 'attribute', value: m.slice(1) });
    }
  }

  // Pseudo-elements and pseudo-classes
  if (selector.includes('::') || selector.includes(':')) {
    hooks.push({ type: 'pseudo', value: '' });
  }

  // Combinators
  if (/[>~+]/.test(selector) || /\s/.test(selector)) {
    hooks.push({ type: 'combinator', value: '' });
  }

  // Universal selector
  if (selector === '*') {
    hooks.push({ type: 'universal', value: '' });
  }

  return hooks;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
