import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');

const CORE = readFileSync(join(ROOT, 'src/content/core.js'), 'utf8');
const ADAPTERS = readFileSync(join(ROOT, 'src/content/adapters.js'), 'utf8');

/**
 * jsdom penceresi kurar ve core.js + adapters.js dosyalarını
 * o pencerenin içinde çalıştırır. Dönen nesne: { dom, window, document, CS, AD }
 */
export function setup(html, opts = {}) {
  const dom = new JSDOM(html || '<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: opts.url || 'https://ornek.com/sayfa'
  });
  const { window } = dom;
  window.eval(CORE);
  window.eval(ADAPTERS);
  return {
    dom,
    window,
    document: window.document,
    CS: window.CookieShield,
    AD: window.CookieShieldAdapters
  };
}
