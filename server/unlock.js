import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const lock = path.join(directory, '.writer-lock');
const recovery = path.join(directory, '.unlock-in-progress');
await fs.mkdir(directory, { recursive: true });
try { await fs.mkdir(recovery); } catch { throw new Error('另一个恢复操作正在进行，请稍后重试。'); }
try {
  let owner;
  try { owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') {
      const exists = await fs.stat(lock).catch(() => null);
      if (exists) throw new Error('锁文件不完整。请确认收藏柜已关闭，然后手动移除 data/.writer-lock 文件夹。');
      console.log('没有需要清理的旧锁。');
      process.exitCode = 0;
    } else throw error;
  }
  if (owner) {
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('锁文件内容无效，请先手动检查。');
    let alive = true;
    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    if (alive) throw new Error('原收藏柜进程仍在运行，不能清理它的锁。请先正常关闭。');
    const retired = path.join(directory, '.retired-lock-' + randomUUID());
    await fs.rename(lock, retired);
    await fs.rm(retired, { recursive: true, force: true });
    console.log('旧锁已清理。现在可以运行 npm start。');
  }
} finally { await fs.rm(recovery, { recursive: true, force: true }); }
