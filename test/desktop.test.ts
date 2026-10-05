// Windows версията: заявките към локалния Ollama минават през вътрешния сървър (/__ollama).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeUrl } from '../src/sim/brain/OllamaBrain';

test('в .exe заявките към Ollama минават през /__ollama', () => {
  const g = globalThis as { location?: unknown };
  const old = g.location;
  g.location = { search: '?app=desktop', origin: 'http://127.0.0.1:47871', protocol: 'http:' };
  try {
    assert.equal(routeUrl('http://127.0.0.1:11434/api/chat'), 'http://127.0.0.1:47871/__ollama/api/chat');
    assert.equal(routeUrl('http://localhost:11434/api/tags'), 'http://127.0.0.1:47871/__ollama/api/tags');
    assert.equal(routeUrl('http://192.168.1.5:11434/api/tags'), 'http://192.168.1.5:11434/api/tags');
    g.location = { search: '', origin: 'http://localhost:5199', protocol: 'http:' };
    assert.equal(routeUrl('http://127.0.0.1:11434/api/chat'), 'http://127.0.0.1:11434/api/chat');
  } finally { g.location = old; }
});
