import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAudioLibrary, startServer, cleanup } from './helpers.mjs';

let audioDir, server;

test.before(async () => {
  audioDir = makeAudioLibrary(3);
  server = await startServer(audioDir);
});
test.after(() => { server?.close(); cleanup(audioDir); });

test('GET /api/files lists imported tracks with subfolder paths', async () => {
  const r = await fetch(`${server.origin}/api/files`);
  assert.equal(r.status, 200);
  const { files } = await r.json();
  assert.equal(files.length, 3);
  assert.ok(files.every((f) => f.path.startsWith('Test Book/')));
  assert.deepEqual(files.map((f) => f.name).sort(), [
    '01 - Chapter 1.mp3', '02 - Chapter 2.mp3', '03 - Chapter 3.mp3',
  ]);
});

test('GET /audio/<path> streams and honours Range requests', async () => {
  const { files } = await (await fetch(`${server.origin}/api/files`)).json();
  const url = `${server.origin}/audio/` + files[0].path.split('/').map(encodeURIComponent).join('/');

  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('content-type'), 'audio/mpeg');

  const ranged = await fetch(url, { headers: { Range: 'bytes=0-99' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-length'), '100');
  assert.match(ranged.headers.get('content-range'), /^bytes 0-99\/\d+$/);
});

test('app shell is sent no-cache and supports 304 revalidation', async () => {
  const r = await fetch(`${server.origin}/app.js`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  const etag = r.headers.get('etag');
  assert.ok(etag, 'app.js should carry an ETag');

  const revalidated = await fetch(`${server.origin}/app.js`, { headers: { 'If-None-Match': etag } });
  assert.equal(revalidated.status, 304);
});

test('index.html injects a build hash onto shell asset URLs (Cloudflare cache-bust)', async () => {
  const html = await (await fetch(server.origin)).text();
  const m = html.match(/\/app\.js\?v=([a-f0-9]{6,})/);
  assert.ok(m, 'app.js should carry a ?v= hash');
  assert.match(html, /\/styles\.css\?v=[a-f0-9]{6,}/);
  assert.match(html, /window\.__ASSET_V__=/);

  // a ?v= URL is content-addressed -> cache it hard
  const v = await fetch(`${server.origin}/app.js?v=${m[1]}`);
  assert.match(v.headers.get('cache-control'), /immutable/);
});

test('icons are cacheable', async () => {
  const r = await fetch(`${server.origin}/icon-192.png`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /max-age=\d+/);
});

test('manifest + service worker are served correctly', async () => {
  const m = await fetch(`${server.origin}/manifest.webmanifest`);
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await m.json();
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));

  const sw = await fetch(`${server.origin}/sw.js`);
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('service-worker-allowed'), '/');
});

test('path traversal out of the audio dir is refused', async () => {
  const r = await fetch(`${server.origin}/audio/../server.js`);
  assert.equal(r.status, 404);
});

test('unknown API endpoints 404 as JSON', async () => {
  const r = await fetch(`${server.origin}/api/nope`);
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'unknown endpoint' });
});
