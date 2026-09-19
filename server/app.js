import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { AppError } from './store.js';

export function createApp(store, { publicDirectory, productionDirectory, password = '' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (password) {
      const supplied = req.headers.authorization?.startsWith('Basic ') ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString('utf8') : '';
      if (supplied.slice(supplied.indexOf(':') + 1) !== password) { res.setHeader('WWW-Authenticate', 'Basic realm="Potter Cabinet", charset="UTF-8"'); return res.status(401).send('请输入收藏柜密码。'); }
    }
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      if (!['GET', 'HEAD'].includes(req.method) && (req.get('X-Potter-Request') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site')) return res.status(403).json({ error: '请从收藏柜页面发起此操作。' });
    }
    next();
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 0 } });
  app.get('/api/state', (req, res) => res.json(store.state));
  app.put('/api/figures/:id', express.json({ limit: '2mb' }), async (req, res) => res.json(await store.saveFigure(req.params.id, req.body)));
  app.post('/api/figures/:id/items/:itemId/photos', upload.single('photo'), async (req, res) => {
    if (!req.file) throw new AppError('请选择照片。');
    res.status(201).json(await store.addPhoto(req.params.id, req.params.itemId, req.file.buffer, req.file.originalname));
  });
  app.get('/api/backup', async (req, res) => {
    res.attachment('potter-cabinet-backup-' + new Date().toISOString().slice(0,10) + '.json');
    res.json(await store.exportBackup());
  });
  app.post('/api/restore', express.json({ limit: '300mb' }), async (req, res) => res.json(await store.importBackup(req.body)));
  app.use('/api', (req, res) => res.status(404).json({ error: '没有找到这个操作。' }));
  app.use('/uploads', express.static(store.uploadDirectory, { dotfiles: 'deny', immutable: true, maxAge: '1y', setHeaders: res => res.setHeader('Content-Security-Policy', "default-src 'none'") }));
  if (publicDirectory) app.use(express.static(publicDirectory));
  if (productionDirectory) {
    app.use(express.static(productionDirectory));
    app.get('/', (req, res) => res.sendFile(path.join(productionDirectory, 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof multer.MulterError ? 400 : (error.status || (error.type === 'entity.too.large' ? 413 : 500));
    const message = error.code === 'LIMIT_FILE_SIZE' ? '每张照片最大15MB。' : status < 500 ? error.message : '保存失败，请重试。原有收藏数据仍然保留。';
    if (status >= 500) console.error(error);
    res.status(status).json({ error: message });
  });
  return app;
}
