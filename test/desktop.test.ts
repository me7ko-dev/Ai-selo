// Windows версията: заявките към локалния Ollama и към Genesis минават през вътрешния сървър (/__ollama, /__genesis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeUrl } from '../src/sim/brain/OllamaBrain';

test('в .exe заявките към Ollama минават през /__ollama, а към Genesis — през /__genesis', () => {
  const g = globalThis as { location?: unknown };
  const old = g.location;
  g.location = { search: '?app=desktop', origin: 'http://127.0.0.1:47871', protocol: 'http:' };
  try {
    assert.equal(routeUrl('http://127.0.0.1:11434/api/chat'), 'http://127.0.0.1:47871/__ollama/api/chat');
    assert.equal(routeUrl('http://localhost:11434/api/tags'), 'http://127.0.0.1:47871/__ollama/api/tags');
    assert.equal(routeUrl('http://192.168.1.5:11434/api/tags'), 'http://192.168.1.5:11434/api/tags');
    assert.equal(routeUrl('http://127.0.0.1:8770/v1/health'), 'http://127.0.0.1:47871/__genesis/v1/health');
    assert.equal(routeUrl('http://localhost:8770/v1/chat/completions'), 'http://127.0.0.1:47871/__genesis/v1/chat/completions');
    assert.equal(routeUrl('http://127.0.0.1:9999/v1/health'), 'http://127.0.0.1:9999/v1/health');
    assert.equal(routeUrl('http://192.168.1.5:8770/v1/health'), 'http://192.168.1.5:8770/v1/health');
    g.location = { search: '', origin: 'http://localhost:5199', protocol: 'http:' };
    assert.equal(routeUrl('http://127.0.0.1:11434/api/chat'), 'http://127.0.0.1:11434/api/chat');
    assert.equal(routeUrl('http://127.0.0.1:8770/v1/health'), 'http://127.0.0.1:8770/v1/health');
  } finally { g.location = old; }
});

test('вътрешният сървър на .exe препраща /__ollama → 11434 и /__genesis → 8770 (само Content-Type, без Origin)', () => {
  const src = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(src, /'\/__ollama\/'\)\) return proxyLocal\(req, res, 11434,/);
  assert.match(src, /'\/__genesis\/'\)\) return proxyLocal\(req, res, 8770,/);
  assert.match(src, /host: '127\.0\.0\.1', port,/);
  assert.doesNotMatch(src, /headers: \{[^}]*origin/i);
});
