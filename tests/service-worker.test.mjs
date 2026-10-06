import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function worker(fetchResponse) {
  const listeners = {};
  const stored = new Map();
  const context = vm.createContext({
    self: { location: { origin: 'https://example.test' }, addEventListener: (name, handler) => { listeners[name] = handler; }, skipWaiting() {}, clients: { claim() {} } },
    caches: {
      open: async () => ({ put: async (key, response) => { stored.set(key.url || key, response); } }),
      match: async key => stored.get(key.url || key),
    },
    fetch: fetchResponse,
    URL,
  });
  vm.runInContext(source, context);
  return { listeners, stored };
}

function fetchScript(worker) {
  const request = { method: 'GET', url: 'https://example.test/ghazali-modern-web/legacy.js', mode: 'no-cors', destination: 'script' };
  let response;
  worker.listeners.fetch({ request, respondWith: promise => { response = promise; } });
  return response;
}

test('online app replaces a cached old script with the latest one', async () => {
  const app = worker(async () => new Response('latest'));
  app.stored.set('https://example.test/ghazali-modern-web/legacy.js', new Response('old'));

  const result = await fetchScript(app);
  assert.equal(await result.text(), 'latest');
  assert.equal(await app.stored.get('https://example.test/ghazali-modern-web/legacy.js').text(), 'latest');
});

test('offline app still serves its cached script', async () => {
  const app = worker(async () => { throw new Error('offline'); });
  app.stored.set('https://example.test/ghazali-modern-web/legacy.js', new Response('cached'));

  const result = await fetchScript(app);
  assert.equal(await result.text(), 'cached');
});
