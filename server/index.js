import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { CollectionStore } from './store.js';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argument = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const port = Number(argument('--port') || process.env.PORT || 3000);
const host = argument('--host') || process.env.HOST || '127.0.0.1';
const catalog = JSON.parse(await fs.readFile(path.join(root, 'public/catalog.json'), 'utf8'));
const directory = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const store = await new CollectionStore(directory, catalog.figures.map(figure => figure.id)).init();
const dev = process.argv.includes('--dev');
const app = createApp(store, { publicDirectory: path.join(root, 'public'), productionDirectory: dev ? undefined : path.join(root, 'dist'), password: process.env.APP_PASSWORD || '' });
let vite;
if (dev) {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true, host, port, strictPort: args.includes('--strictPort'), allowedHosts: ['terminal.local'] }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  await fs.access(path.join(root, 'dist/index.html')).catch(() => { throw new Error('请先运行 npm run build，然后运行 npm start。'); });
}
const server = app.listen(port, host, () => console.log(`Potter Cabinet: http://${host}:${port}\nData: ${directory}`));
async function close() { await vite?.close(); server.close(async () => { await store.close(); process.exit(0); }); }
process.on('SIGINT', close); process.on('SIGTERM', close);
