import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const validId = value => typeof value === 'string' && /^[a-z0-9-]{1,100}$/i.test(value);
const text = (value, max = 1000) => typeof value === 'string' ? value.slice(0, max) : '';
export function imageType(buffer) {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ext: 'png', mime: 'image/png' };
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

export class CollectionStore {
  constructor(directory, figureIds) {
    this.directory = directory;
    this.uploadDirectory = path.join(directory, 'uploads');
    this.file = path.join(directory, 'collection.json');
    this.lockDirectory = path.join(directory, '.writer-lock');
    this.figureIds = new Set(figureIds);
    this.queue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.uploadDirectory, { recursive: true });
    try { await fs.mkdir(this.lockDirectory); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('这个 data 目录已由另一个收藏柜进程使用。请先关闭它；异常退出后运行 npm run unlock 清理旧锁。'); throw error; }
    this.releaseLock = async () => fs.rm(this.lockDirectory, { recursive: true, force: true });
    try {
    await fs.writeFile(path.join(this.lockDirectory, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    try { this.state = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('收藏数据库无法读取。请保留 data 目录并检查备份，不要覆盖原文件。', { cause: error });
      this.state = { schemaVersion: 1, revision: 0, figures: {} };
      await this.persist(this.state);
    }
    if (this.state.schemaVersion !== 1 || !this.state.figures || Array.isArray(this.state.figures)) throw new Error('收藏数据格式不受支持。');
    return this;
    } catch (error) { await this.releaseLock(); throw error; }
  }
  async close() { await this.queue; await this.releaseLock?.(); this.releaseLock = null; }
  async persist(state) {
    const tmp = this.file + '.' + randomUUID() + '.tmp';
    const handle = await fs.open(tmp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(state, null, 2)); await handle.sync(); } finally { await handle.close(); }
    try { await fs.copyFile(this.file, this.file + '.previous'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await fs.rename(tmp, this.file);
  }
  serial(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  assertFigure(id) { if (!this.figureIds.has(id)) throw new AppError('没有找到这个款式。', 404); }
  getFigure(id) { this.assertFigure(id); return this.state.figures[id] || { owned: false, items: [], updatedAt: null }; }
  async commit(id, figure) {
    figure.updatedAt = new Date().toISOString() + ':' + randomUUID().slice(0, 8);
    const next = { ...this.state, revision: this.state.revision + 1, figures: { ...this.state.figures, [id]: figure } };
    await this.persist(next);
    this.state = next;
    return figure;
  }
  normalizeFigure(input, allowedPhotos = new Map()) {
    if (typeof input?.owned !== 'boolean' || !Array.isArray(input.items) || input.items.length > 100) throw new AppError('收藏记录格式不正确。');
    const ids = new Set();
    const items = input.items.map(item => {
      if (!validId(item.id) || ids.has(item.id)) throw new AppError('实物记录编号无效或重复。');
      ids.add(item.id);
      if (!Array.isArray(item.photos) || item.photos.length > 50) throw new AppError('每件实物最多保存50张照片。');
      const photoIds = new Set();
      const photos = item.photos.map(photo => {
        const existing = allowedPhotos.get(photo.id);
        if (!existing || photoIds.has(photo.id)) throw new AppError('照片引用无效或重复。');
        photoIds.add(photo.id); return existing;
      });
      const price = item.price === '' || item.price === null || item.price === undefined ? null : Number(item.price);
      if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1e9)) throw new AppError('请填写有效的购入金额。');
      const acquisitionDate = text(item.acquisitionDate, 10);
      const date = new Date(acquisitionDate);
      if (acquisitionDate && (!/^\d{4}-\d{2}-\d{2}$/.test(acquisitionDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== acquisitionDate)) throw new AppError('入藏日期格式不正确。');
      return { id: item.id, acquisitionDate, price, currency: ['USD', 'CAD', 'GBP', 'CNY', 'EUR'].includes(item.currency) ? item.currency : 'USD', purchasePlace: text(item.purchasePlace, 500), condition: text(item.condition, 200), notes: text(item.notes, 10000), photos };
    });
    return { owned: input.owned, items };
  }
  saveFigure(id, input) {
    return this.serial(async () => {
      const current = this.getFigure(id);
      if (input.expectedUpdatedAt !== current.updatedAt) throw new AppError('这款收藏已在另一页面更新，请重新载入后再保存。', 409);
      const photos = new Map(current.items.flatMap(item => item.photos).map(photo => [photo.id, photo]));
      const next = this.normalizeFigure(input, photos);
      return this.commit(id, next);
    });
  }
  addPhoto(id, itemId, buffer, originalName) {
    return this.serial(async () => {
      const current = structuredClone(this.getFigure(id));
      const item = current.items.find(item => item.id === itemId);
      if (!item) throw new AppError('请先保存实物记录。', 404);
      if (item.photos.length >= 50) throw new AppError('每件实物最多保存50张照片。');
      const type = imageType(buffer);
      if (!type) throw new AppError('请选择 JPEG、PNG 或 WebP 照片。');
      const photoId = randomUUID(); const filename = photoId + '.' + type.ext;
      await fs.writeFile(path.join(this.uploadDirectory, filename), buffer, { flag: 'wx', mode: 0o600 });
      const photo = { id: photoId, filename, mime: type.mime, originalName: text(originalName, 200), addedAt: new Date().toISOString() };
      item.photos.push(photo);
      try { return await this.commit(id, current); }
      catch (error) { await fs.unlink(path.join(this.uploadDirectory, filename)).catch(() => {}); throw error; }
    });
  }
  exportBackup() {
    return this.serial(async () => {
      const collection = structuredClone(this.state);
      let estimatedSize = Buffer.byteLength(JSON.stringify(collection)) + 1000;
      for (const figure of Object.values(collection.figures)) for (const item of figure.items) for (const photo of item.photos) {
        const { size } = await fs.stat(path.join(this.uploadDirectory, photo.filename));
        estimatedSize += 4 * Math.ceil(size / 3) + photo.filename.length + 20;
        if (estimatedSize > 100 * 1024 * 1024) throw new AppError('照片较多，单文件备份预计超过100MB。请关闭收藏柜并复制整个 data 目录，完整保留照片和记录。', 413);
      }
      const photos = {};
      for (const figure of Object.values(collection.figures)) for (const item of figure.items) for (const photo of item.photos) {
        photos[photo.filename] = (await fs.readFile(path.join(this.uploadDirectory, photo.filename))).toString('base64');
      }
      return { app: 'potter-cabinet', formatVersion: 1, exportedAt: new Date().toISOString(), collection, photos };
    });
  }
  importBackup(backup) {
    return this.serial(async () => {
      if (backup?.app !== 'potter-cabinet' || backup.formatVersion !== 1 || backup.collection?.schemaVersion !== 1 || !backup.collection.figures || Array.isArray(backup.collection.figures) || typeof backup.photos !== 'object' || !backup.photos) throw new AppError('这不是有效的收藏柜备份文件。');
      const merged = structuredClone(this.state.figures); const staged = []; const seenItems = new Set();
      for (const [id, raw] of Object.entries(backup.collection.figures)) {
        this.assertFigure(id);
        if (!Array.isArray(raw.items) || raw.items.length > 100) throw new AppError('备份中的实物记录无效。');
        const photoMap = new Map();
        const adjusted = structuredClone(raw);
        for (const item of adjusted.items) {
          if (!Array.isArray(item.photos) || item.photos.length > 50) throw new AppError('备份中的照片列表无效。');
          if (seenItems.has(item.id)) throw new AppError('备份中有重复的实物编号。');
          seenItems.add(item.id);
          for (const photo of item.photos) {
            if (!validId(photo.id) || typeof photo.filename !== 'string' || !/^[a-z0-9-]+\.(jpg|png|webp)$/i.test(photo.filename)) throw new AppError('备份中的照片名称无效。');
            const encoded = backup.photos[photo.filename];
            if (typeof encoded !== 'string' || encoded.length > 21e6 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new AppError('备份中缺少照片，或照片超过15MB。');
            const bytes = Buffer.from(encoded, 'base64'); const type = imageType(bytes);
            if (!type || bytes.length > 15 * 1024 * 1024) throw new AppError('备份中的照片格式不正确。');
            const photoId = randomUUID(); const filename = photoId + '.' + type.ext;
            const cleanPhoto = { id: photoId, filename, mime: type.mime, originalName: text(photo.originalName, 200), addedAt: text(photo.addedAt, 50) };
            staged.push({ filename, bytes }); photoMap.set(photoId, cleanPhoto); Object.assign(photo, cleanPhoto);
          }
        }
        const incoming = this.normalizeFigure(adjusted, photoMap);
        const existing = merged[id] || { owned: false, items: [] };
        // Restore updates matching item IDs and preserves other local items.
        const incomingIds = new Set(incoming.items.map(item => item.id));
        merged[id] = { owned: existing.owned || incoming.owned, items: [...existing.items.filter(item => !incomingIds.has(item.id)), ...incoming.items], updatedAt: new Date().toISOString() + ':' + randomUUID().slice(0,8) };
        if (merged[id].items.length > 100) throw new AppError('合并后某款实物超过100件，请先整理记录。');
      }
      const written = [];
      try {
        for (const file of staged) { await fs.writeFile(path.join(this.uploadDirectory, file.filename), file.bytes, { flag: 'wx', mode: 0o600 }); written.push(file.filename); }
        const next = { ...this.state, revision: this.state.revision + 1, figures: merged };
        await this.persist(next); this.state = next; return this.state;
      } catch (error) { await Promise.all(written.map(file => fs.unlink(path.join(this.uploadDirectory, file)).catch(() => {}))); throw error; }
    });
  }
}
