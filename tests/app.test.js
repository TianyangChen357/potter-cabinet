import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollectionStore } from '../server/store.js';
import { createApp } from '../server/app.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const item = id => ({ id, acquisitionDate: '2026-09-18', price: 20, currency: 'USD', purchasePlace: 'Test auction', condition: 'Good', notes: 'Test only', photos: [] });
const jsonHeaders = { 'Content-Type': 'application/json', 'X-Potter-Request': '1' };

test('collection survives restart; photos and duplicate pieces round-trip through backup', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'potter-test-'));
  let store = await new CollectionStore(directory, ['peter', 'jemima']).init();
  let server = createApp(store).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const closeServer = () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  t.after(async () => { await closeServer(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.deepEqual((await (await fetch(base + '/api/state')).json()).figures, {});
  const payload = { owned: true, items: [item('piece-one'), item('piece-two')], expectedUpdatedAt: null };
  assert.equal((await fetch(base + '/api/figures/peter', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 403);
  let response = await fetch(base + '/api/figures/peter', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(payload) });
  assert.equal(response.status, 200); let saved = await response.json();
  assert.equal(saved.items.length, 2);
  assert.equal((await fetch(base + '/api/figures/peter', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(payload) })).status, 409);
  const form = new FormData(); form.append('photo', new Blob([png], { type: 'image/png' }), 'bottom-mark.png');
  response = await fetch(base + '/api/figures/peter/items/piece-one/photos', { method: 'POST', headers: { 'X-Potter-Request': '1' }, body: form });
  assert.equal(response.status, 201); saved = await response.json();
  const photo = saved.items[0].photos[0];
  assert.deepEqual(Buffer.from(await (await fetch(base + '/uploads/' + photo.filename)).arrayBuffer()), png);
  const fake = new FormData(); fake.append('photo', new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }), 'fake.png');
  assert.equal((await fetch(base + '/api/figures/peter/items/piece-one/photos', { method: 'POST', headers: { 'X-Potter-Request': '1' }, body: fake })).status, 400);
  const backup = await (await fetch(base + '/api/backup')).json();
  assert.equal(Object.keys(backup.photos).length, 1);
  assert.deepEqual(Buffer.from(backup.photos[photo.filename], 'base64'), png);
  await closeServer(); await store.close();
  store = await new CollectionStore(directory, ['peter', 'jemima']).init();
  assert.equal(store.getFigure('peter').owned, true); assert.equal(store.getFigure('peter').items[0].photos.length, 1);
  const restoredDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'potter-restore-'));
  const restored = await new CollectionStore(restoredDirectory, ['peter', 'jemima']).init();
  try {
    await restored.saveFigure('jemima', { owned: true, items: [item('keep-me')], expectedUpdatedAt: null });
    await restored.importBackup(backup);
    assert.equal(restored.getFigure('peter').items.length, 2); assert.equal(restored.getFigure('jemima').items[0].id, 'keep-me');
    const newPhoto = restored.getFigure('peter').items[0].photos[0];
    assert.deepEqual(await fs.readFile(path.join(restored.uploadDirectory, newPhoto.filename)), png);
    const before = JSON.stringify(restored.state); const corrupt = structuredClone(backup); corrupt.photos = {};
    await assert.rejects(() => restored.importBackup(corrupt)); assert.equal(JSON.stringify(restored.state), before);
    await assert.rejects(() => new CollectionStore(restoredDirectory, ['peter']).init(), /另一个收藏柜进程/);
  } finally { await restored.close(); await fs.rm(restoredDirectory, { recursive: true, force: true }); }
  server = createApp(store).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  const current = store.getFigure('peter');
  response = await fetch(base + '/api/figures/peter', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ ...current, owned: false, expectedUpdatedAt: current.updatedAt }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).items.length, 2);
  await fs.truncate(path.join(store.uploadDirectory, photo.filename), 80 * 1024 * 1024);
  response = await fetch(base + '/api/backup'); assert.equal(response.status, 413); assert.match((await response.json()).error, /data/);
});

test('catalog contains exactly the approved 103 poses and 100 local reference images', async () => {
  const catalog = JSON.parse(await fs.readFile(new URL('../public/catalog.json', import.meta.url), 'utf8'));
  assert.equal(catalog.figures.length, 103); assert.equal(new Set(catalog.figures.map(f => f.id)).size, 103);
  assert.equal(catalog.figures.filter(f => f.image_file).length, 100);
  for (const figure of catalog.figures.filter(f => f.image_file)) await fs.access(new URL('../public/' + figure.image_file, import.meta.url));
});
