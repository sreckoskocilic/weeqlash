#!/usr/bin/env node
/**
 * Check for unused CSS selectors in HTML files.
 * Compares selectors defined in <style> blocks against actual usage in HTML and JS.
 *
 * Supports:
 * - Static HTML class/id attributes
 * - Dynamic classList.add/remove/toggle
 * - className assignments
 * - querySelector/querySelectorAll
 * - getElementById
 * - Custom $() shorthand
 * - Ternary expressions for class names
 *
 * Known limitations (excluded from false positives):
 * - Template literal class construction (e.g., `cat-${category}`)
 * - CSS classes used only in external stylesheets
 */

import { readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root is 2 directories up from scripts/
const projectRoot = resolve(__dirname, '..');

/**
 * Extract selectors from CSS text
 */
function extractSelectors(cssText) {
  const selectors = [];
  // Match CSS rules: selector { ... }
  const ruleRegex = /([^{]+)\{[^}]*}/g;
  let match;
  while ((match = ruleRegex.exec(cssText)) !== null) {
    const selector = match[1].trim();
    // Skip keyframes, media queries, and special selectors
    if (selector.startsWith('@') || selector.includes('@media') || selector.includes('@keyframes')) {
      continue;
    }
    selectors.push(selector);
  }
  return selectors;
}

/**
 * Extract class and ID selectors from CSS
 * Returns { classes: Set, ids: Set }
 */
function parseCssSelectors(cssText) {
  const classes = new Set();
  const ids = new Set();

  const selectors = extractSelectors(cssText);
  for (const selector of selectors) {
    // ID selectors: #foo
    const idMatches = selector.matchAll(/#([a-zA-Z_-][a-zA-Z0-9_-]*)/g);
    for (const m of idMatches) {
      ids.add(m[1]);
    }

    // Class selectors: .foo (but skip pseudo-classes like .foo:hover)
    const classMatches = selector.matchAll(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)(?![a-zA-Z0-9_-])/g);
    for (const m of classMatches) {
      classes.add(m[1]);
    }
  }

  return { classes, ids };
}

/**
 * Extract classes and IDs used in HTML (static)
 * Returns { classes: Set, ids: Set }
 */
function parseHtmlUsage(htmlText) {
  const classes = new Set();
  const ids = new Set();

  // Match class attributes: class="foo bar baz"
  const classRegex = /class=["']([^"']+)["']/g;
  let match;
  while ((match = classRegex.exec(htmlText)) !== null) {
    const classList = match[1].split(/\s+/).filter(Boolean);
    for (const cls of classList) {
      // Skip dynamically generated class names
      if (!cls.includes('${') && !cls.includes('{{')) {
        classes.add(cls);
      }
    }
  }

  // Match id attributes: id="foo"
  const idRegex = /id=["']([^"']+)["']/g;
  while ((match = idRegex.exec(htmlText)) !== null) {
    ids.add(match[1]);
  }

  return { classes, ids };
}

/**
 * Extract classes and IDs used in JavaScript (dynamic)
 * Returns { classes: Set, ids: Set }
 */
function parseJsUsage(htmlText) {
  const classes = new Set();
  const ids = new Set();

  // Extract script blocks
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(htmlText)) !== null) {
    const jsCode = match[1];

    // classList.add('foo'), classList.remove('foo'), classList.toggle('foo')
    const classListRegex = /\.classList\.(add|remove|toggle|contains)\(?['"]([^'"]+)['"]\)?/g;
    let classMatch;
    while ((classMatch = classListRegex.exec(jsCode)) !== null) {
      const classStr = classMatch[2];
      // Handle multiple classes: add('foo', 'bar')
      const classParts = classStr.split(/[\s,]+/).filter(Boolean);
      for (const cls of classParts) {
        if (!cls.includes('${') && !cls.includes('{{')) {
          classes.add(cls);
        }
      }
    }

    // classList.add/remove with ternary: add(condition ? 'foo' : 'bar')
    const ternaryClassRegex = /\.classList\.(add|remove|toggle)\s*\(\s*[^?]*\?\s*['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
    let ternaryMatch;
    while ((ternaryMatch = ternaryClassRegex.exec(jsCode)) !== null) {
      classes.add(ternaryMatch[2]); // truthy branch
      classes.add(ternaryMatch[3]); // falsy branch
    }

    // className = 'foo', className += ' foo'
    const classNameRegex = /\.className\s*=\s*['"]([^'"]*)['"]|className\s*\+=\s*['"]([^'"]*)['"]/g;
    let classNameMatch;
    while ((classNameMatch = classNameRegex.exec(jsCode)) !== null) {
      const classStr = classNameMatch[1] || classNameMatch[2] || '';
      const classParts = classStr.split(/\s+/).filter(Boolean);
      for (const cls of classParts) {
        if (!cls.startsWith('${') && !cls.startsWith('{{') && cls !== '') {
          classes.add(cls);
        }
      }
    }

    // className = condition ? 'foo' : 'bar'
    const classNameTernaryRegex = /\.className\s*=\s*[^?]+\?\s*['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
    let classNameTernaryMatch;
    while ((classNameTernaryMatch = classNameTernaryRegex.exec(jsCode)) !== null) {
      const parts = classNameTernaryMatch[1].split(/\s+/).filter(Boolean);
      for (const cls of parts) {
        classes.add(cls);
      }
      const parts2 = classNameTernaryMatch[2].split(/\s+/).filter(Boolean);
      for (const cls of parts2) {
        classes.add(cls);
      }
    }

    // querySelector('.foo'), querySelectorAll('.foo'), getElementsByClassName('foo')
    const selectorRegex = /\.(?:querySelector|querySelectorAll|getElementsByClassName)\(?['"]([^'"]+)['"]\)?/g;
    let selectorMatch;
    while ((selectorMatch = selectorRegex.exec(jsCode)) !== null) {
      const selector = selectorMatch[1];
      // Extract class from selector like '.foo' or '#foo.bar'
      const classInSelector = selector.match(/^\.([a-zA-Z_-][a-zA-Z0-9_-]*)/);
      if (classInSelector) {
        classes.add(classInSelector[1]);
      }
      const idInSelector = selector.match(/^#([a-zA-Z_-][a-zA-Z0-9_-]*)/);
      if (idInSelector) {
        ids.add(idInSelector[1]);
      }
    }

    // getElementById('foo')
    const idRegex = /getElementById\(['"]([^'"]+)['"]\)/g;
    let idMatch;
    while ((idMatch = idRegex.exec(jsCode)) !== null) {
      ids.add(idMatch[1]);
    }

    // $('foo') - custom shorthand for getElementById
    const $FuncRegex = /\$_?\(['"]([^'"]+)['"]\)/g;
    let $Match;
    while (($Match = $FuncRegex.exec(jsCode)) !== null) {
      ids.add($Match[1]);
    }
  }

  return { classes, ids };
}

/**
 * Extract style blocks from HTML
 */
function extractStyleBlocks(htmlText) {
  const blocks = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRegex.exec(htmlText)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/**
 * Main check function
 */
function checkUnusedSelectors(htmlPath) {
  const htmlText = readFileSync(htmlPath, 'utf-8');
  const styleBlocks = extractStyleBlocks(htmlText);

  if (styleBlocks.length === 0) {
    console.log('No CSS style blocks found in', htmlPath);
    return { unusedClasses: [], unusedIds: [] };
  }

  // Combine all CSS from style blocks
  const combinedCss = styleBlocks.join('\n');

  // Parse CSS selectors
  const { classes: cssClasses, ids: cssIds } = parseCssSelectors(combinedCss);

  // Parse HTML usage (static)
  const { classes: htmlClasses, ids: htmlIds } = parseHtmlUsage(htmlText);

  // Parse JS usage (dynamic)
  const { classes: jsClasses, ids: jsIds } = parseJsUsage(htmlText);

  // Combine all usage
  const allUsedClasses = new Set([...htmlClasses, ...jsClasses]);
  const allUsedIds = new Set([...htmlIds, ...jsIds]);

  // Find unused selectors
  const unusedClasses = [...cssClasses].filter(c => !allUsedClasses.has(c) && !isKnownDynamicPattern(c));
  const unusedIds = [...cssIds].filter(id => !allUsedIds.has(id));

  return { unusedClasses, unusedIds };
}

/**
 * Check if a class name is a known dynamic pattern
 * (constructed via template literal concatenation)
 */
function isKnownDynamicPattern(cls) {
  // Categories like cat-art, cat-science (dynamic via cat-${category})
  // Base tile and flag-tile (dynamic via className assignment)
  return cls.startsWith('cat-') || cls === 'tile' || cls === 'flag-tile';
}

/**
 * Main entry point
 */
function main() {
  const args = process.argv.slice(2);
  const htmlFiles = args.length > 0 ? args : ['client/index.html'];

  let totalUnused = 0;

  for (const htmlFile of htmlFiles) {
    const filePath = args.length > 0
      ? resolve(process.cwd(), htmlFile)
      : join(projectRoot, htmlFile);
    const { unusedClasses, unusedIds } = checkUnusedSelectors(filePath);

    const fileTotal = unusedClasses.length + unusedIds.length;
    totalUnused += fileTotal;

    if (fileTotal > 0) {
      console.log(`\n${htmlFile}:`);

      if (unusedIds.length > 0) {
        console.log('  Unused IDs:');
        for (const id of unusedIds) {
          console.log(`    #${id}`);
        }
      }

      if (unusedClasses.length > 0) {
        console.log('  Unused classes:');
        for (const cls of unusedClasses) {
          console.log(`    .${cls}`);
        }
      }
    } else {
      console.log(`${htmlFile}: No unused selectors found`);
    }
  }

  if (totalUnused > 0) {
    console.log(`\n${totalUnused} unused selector(s) found.`);
    process.exit(1);
  } else {
    console.log('\nAll selectors are in use.');
    process.exit(0);
  }
}

main();
