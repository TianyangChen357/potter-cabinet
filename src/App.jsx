import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, ChevronDown, Download, Image as ImageIcon, Leaf, Plus, Search, Sparkles, Upload, X, ExternalLink, Trash2, Camera, RotateCcw, LoaderCircle } from 'lucide-react';

const emptyEntry = () => ({ owned: false, items: [], updatedAt: null });
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
}
const blankItem = () => ({ id: newId(), acquisitionDate: '', price: '', currency: 'USD', purchasePlace: '', condition: '', notes: '', photos: [] });
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-Potter-Request': '1', ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '连接失败，请确认收藏柜仍在运行。');
  return result;
}
function Picture({ figure, owned = true, ownPhoto = '', className = '' }) {
  const [failed, setFailed] = useState(false);
  const src = ownPhoto || (figure.image_file ? '/' + figure.image_file : '');
  return <div className={`picture ${owned ? 'lit' : 'unlit'} ${className}`}>
    {src && !failed ? <img src={src} alt={figure.name} loading="lazy" onError={() => setFailed(true)} /> : <div className="no-picture"><ImageIcon size={30} strokeWidth={1.2} /><span>{owned && !figure.image_file ? '添加你的实物照片' : '参考图待补'}</span></div>}
  </div>;
}

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [collection, setCollection] = useState({ figures: {} });
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [pending, setPending] = useState(new Set());
  const [restoring, setRestoring] = useState(false);
  const [menu, setMenu] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const importInput = useRef();
  const currentCollection = useRef(collection);
  function replaceCollection(next) { currentCollection.current = next; setCollection(next); }
  async function load() {
    setLoadError('');
    try { const [data, state] = await Promise.all([api('/catalog.json'), api('/api/state')]); setCatalog(data); replaceCollection(state); }
    catch (error) { setLoadError(error.message); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer); }, [notice]);
  function acceptFigure(id, entry) {
    const next = { ...currentCollection.current, figures: { ...currentCollection.current.figures, [id]: entry } };
    replaceCollection(next);
  }
  async function updateFigure(id, next) {
    const previous = currentCollection.current.figures[id] || emptyEntry();
    const saved = await api('/api/figures/' + id, { method: 'PUT', body: JSON.stringify({ ...next, expectedUpdatedAt: previous.updatedAt }) });
    acceptFigure(id, saved); return saved;
  }
  async function toggle(id) {
    if (pending.has(id)) return;
    setPending(prev => new Set(prev).add(id));
    try {
      const current = currentCollection.current.figures[id] || emptyEntry();
      await updateFigure(id, { ...current, owned: !current.owned });
      setNotice(current.owned ? '已取消点亮，实物档案仍然保留。' : '又点亮了一种收藏。');
    } catch (error) { setNotice(error.message); }
    finally { setPending(prev => { const next = new Set(prev); next.delete(id); return next; }); }
  }
  const figures = catalog?.figures || [];
  const ownedCount = figures.filter(figure => collection.figures[figure.id]?.owned).length;
  const visible = useMemo(() => figures.filter(figure => {
    const owned = !!collection.figures[figure.id]?.owned;
    const matches = [figure.name, figure.pose_label_zh, ...(figure.characters || [])].join(' ').toLowerCase().includes(query.trim().toLowerCase());
    return matches && (filter === 'all' || (filter === 'owned' ? owned : !owned));
  }), [catalog, collection, query, filter]);
  const selected = figures.find(figure => figure.id === selectedId);
  async function exportBackup() {
    setMenu(false);
    try {
      const response = await fetch('/api/backup');
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || '备份导出失败，请重试。'); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `potter-cabinet-backup-${new Date().toISOString().slice(0,10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('已导出收藏记录和全部实物照片。');
    } catch (error) { setNotice(error.message); }
  }
  async function restore() {
    setRestoring(true);
    try {
      if (restoreFile.size > 300 * 1024 * 1024) throw new Error('备份超过300MB，请使用 data 目录完整备份。');
      const body = await restoreFile.text(); JSON.parse(body);
      const next = await api('/api/restore', { method: 'POST', body });
      replaceCollection(next); setRestoreFile(null); setNotice('备份已合并，其他本地实物记录已保留。');
    } catch (error) { setNotice(error instanceof SyntaxError ? '这个文件不是有效的 JSON 备份。' : error.message); }
    finally { setRestoring(false); }
  }
  return <>
    <header className="masthead"><a className="brand" href="/" aria-label="Potter Cabinet 首页"><span className="brand-mark"><Leaf size={23} strokeWidth={1.5} /></span><span>The Potter Cabinet<small>A PERSONAL COLLECTION</small></span></a>
      <div className="backup-control"><button className="quiet-button" onClick={() => setMenu(!menu)} aria-expanded={menu}><Download size={16} /><span>收藏备份</span><ChevronDown size={14} /></button>
        {menu && <div className="backup-menu"><button onClick={exportBackup}><Download size={16} />导出记录与照片</button><button onClick={() => { setMenu(false); importInput.current.click(); }}><Upload size={16} />从备份恢复</button></div>}
        <input ref={importInput} type="file" accept=".json,application/json" hidden aria-label="选择收藏备份" onChange={event => { setRestoreFile(event.target.files[0] || null); event.target.value = ''; }} />
      </div>
    </header>
    <main className="main-shell">
      <section className="collection-heading"><div><div className="eyebrow"><span /> BESWICK · BEATRIX POTTER</div><h1>我的比得兔收藏柜<span className="title-period">.</span></h1><p>从一只喜欢的瓷偶，慢慢收藏整个故事。</p></div>
        <div className="progress-block"><div className="progress-caption"><span>已点亮</span><span className="count"><strong>{ownedCount}</strong><span> / {figures.length || 103}</span></span></div><div className="progress-track" role="progressbar" aria-label="收藏完成进度" aria-valuemin="0" aria-valuemax={figures.length || 103} aria-valuenow={ownedCount}><div style={{ width: `${ownedCount / (figures.length || 103) * 100}%` }} /></div><div className="progress-bottom"><span>一种造型，一格收藏</span><span>{Math.round(ownedCount / (figures.length || 103) * 100)}%</span></div></div>
      </section>
      <section className="catalog-toolbar" aria-label="图鉴筛选"><div className="view-tabs">{[['all', '全部图鉴', figures.length || 103], ['owned', '已收藏', ownedCount], ['missing', '待收集', (figures.length || 103) - ownedCount]].map(([id, label, count]) => <button key={id} className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span>{count}</span></button>)}</div><label className="search"><Search size={17} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="查找角色或动作…" aria-label="查找角色或动作" /></label></section>
      {loadError ? <div className="empty-state" role="alert"><BookOpen size={35} /><h2>暂时没有打开收藏柜</h2><p>{loadError}</p><button className="primary-button" onClick={load}>重新载入</button></div> : !catalog ? <div className="empty-state"><LoaderCircle className="spin" /><p>正在打开图鉴…</p></div> : <>
        <div className="shelf-caption"><span>{query ? `找到 ${visible.length} 款` : filter === 'all' ? 'THE COMPLETE CABINET' : filter === 'owned' ? 'MY COLLECTION' : 'STILL TO DISCOVER'}</span><span>点击瓷偶，打开收藏档案</span></div>
        <div className="figure-grid">{visible.map(figure => {
          const entry = collection.figures[figure.id] || emptyEntry();
          const ownPhoto = !figure.image_file && entry.items.flatMap(item => item.photos)[0];
          return <article className={`figure-card ${entry.owned ? 'owned' : ''}`} key={figure.id}>
            <button className="figure-open" onClick={() => setSelectedId(figure.id)} aria-label={`打开 ${figure.name} 收藏档案`}><div className="image-space"><span className="figure-number">{String(figure.catalog_index).padStart(3, '0')}</span><Picture figure={figure} owned={entry.owned} ownPhoto={ownPhoto ? '/uploads/' + ownPhoto.filename : ''} />{entry.owned && <span className="owned-seal"><Check size={12} /> 已收藏</span>}</div><div className="figure-caption"><h2>{figure.name}</h2><p>{figure.pose_label_zh}</p></div></button>
            <button className={`collect-button ${entry.owned ? 'is-collected' : ''}`} aria-pressed={entry.owned} disabled={pending.has(figure.id)} onClick={() => toggle(figure.id)} aria-label={`${entry.owned ? '取消点亮' : '点亮收藏'} ${figure.name}`}>{pending.has(figure.id) ? <LoaderCircle size={15} className="spin" /> : entry.owned ? <Check size={15} /> : <Plus size={15} />}{entry.owned ? '已点亮' : '点亮收藏'}</button>
          </article>;
        })}</div>
        {!visible.length && <div className="empty-state"><Search size={30} /><h2>{query ? '没有找到这个款式' : filter === 'owned' ? '第一格，留给你最喜欢的那一只' : '图鉴里的每一种都已点亮'}</h2><p>{query ? '试试英文角色名，或者清除搜索。' : '回到图鉴，点击「点亮收藏」记录已拥有的瓷偶。'}</p><button className="quiet-button" onClick={() => { setFilter('all'); setQuery(''); }}>查看全部图鉴</button></div>}
      </>}
      <footer className="footer"><span><Leaf size={15} /> The Potter Cabinet</span><p>103 款动作与场景 · Beswick 收藏清单 v1</p><a href="https://beatrix-potter-figurines.co.uk/beswick-beatrix-potter-figurines/" target="_blank" rel="noreferrer">图鉴资料来源 <ExternalLink size={12} /></a></footer>
    </main>
    {selected && <FigureDetail key={selected.id} figure={selected} entry={collection.figures[selected.id] || emptyEntry()} onClose={() => setSelectedId(null)} onSave={next => updateFigure(selected.id, next)} onPhoto={saved => acceptFigure(selected.id, saved)} onToggle={() => toggle(selected.id)} togglePending={pending.has(selected.id)} announce={setNotice} />}
    {restoreFile && <ConfirmDialog title="从备份恢复收藏" onClose={() => !restoring && setRestoreFile(null)}><p>将合并 <strong>{restoreFile.name}</strong> 中的收藏和照片。同一实物编号的资料会更新，其他本地记录会保留。</p><div className="dialog-actions"><button className="quiet-button" disabled={restoring} onClick={() => setRestoreFile(null)}>取消</button><button className="primary-button" disabled={restoring} onClick={restore}>{restoring ? '正在恢复…' : '合并备份'}</button></div></ConfirmDialog>}
    {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={16} /></button></div>}
  </>;
}

function ConfirmDialog({ title, children, onClose }) {
  const ref = useRef();
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className="confirm-dialog" onCancel={event => { event.preventDefault(); onClose(); }}><h2>{title}</h2>{children}</dialog>;
}

function FigureDetail({ figure, entry, onClose, onSave, onPhoto, onToggle, togglePending, announce }) {
  const dialog = useRef();
  const [draft, setDraft] = useState(() => structuredClone(entry.items[0] || blankItem()));
  const [files, setFiles] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [previews, setPreviews] = useState([]);
  const isNew = !entry.items.some(item => item.id === draft.id);
  useEffect(() => { dialog.current.showModal(); const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = old; }; }, []);
  useEffect(() => { const urls = files.map(file => URL.createObjectURL(file)); setPreviews(urls); return () => urls.forEach(url => URL.revokeObjectURL(url)); }, [files]);
  useEffect(() => { const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  function canLeave() { return !dirty || window.confirm('还有未保存的照片或资料，放弃这些修改吗？'); }
  function close() { if (!busy && canLeave()) onClose(); }
  function selectItem(item) { if (busy || !canLeave()) return; setDraft(structuredClone(item)); setFiles([]); setDirty(false); setError(''); setRemoving(false); }
  function change(key, value) { setDraft(prev => ({ ...prev, [key]: value })); setDirty(true); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    let saved; let uploaded = 0;
    try {
      const items = isNew ? [...entry.items, draft] : entry.items.map(item => item.id === draft.id ? draft : item);
      saved = await onSave({ ...entry, owned: true, items });
      for (const file of files) {
        const body = new FormData(); body.append('photo', file);
        saved = await api(`/api/figures/${figure.id}/items/${draft.id}/photos`, { method: 'POST', body });
        uploaded++; onPhoto(saved);
      }
      setDraft(structuredClone(saved.items.find(item => item.id === draft.id))); setFiles([]); setDirty(false); announce('实物档案已保存。');
    } catch (e) {
      if (saved) { setDraft(structuredClone(saved.items.find(item => item.id === draft.id))); setFiles(current => current.slice(uploaded)); setDirty(files.length > uploaded); }
      setError((saved ? '资料已保存，剩余照片未上传：' : '') + e.message);
    } finally { setBusy(false); }
  }
  async function removeItem() {
    setBusy(true); setError('');
    try { const saved = await onSave({ ...entry, items: entry.items.filter(item => item.id !== draft.id) }); setDraft(structuredClone(saved.items[0] || blankItem())); setFiles([]); setDirty(false); setRemoving(false); announce('已移除这件实物记录。'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function choosePhotos(event) {
    const chosen = [...event.target.files]; event.target.value = '';
    if (chosen.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setError('请选择 JPG、PNG 或 WebP 照片。'); return; }
    if (chosen.some(file => file.size > 15 * 1024 * 1024)) { setError('每张照片最大15MB。'); return; }
    if (draft.photos.length + files.length + chosen.length > 50) { setError('每件实物最多50张照片。'); return; }
    setFiles(current => [...current, ...chosen]); setDirty(true); setError('');
  }
  return <dialog ref={dialog} className="detail-dialog" onCancel={event => { event.preventDefault(); if (zoom) setZoom(null); else close(); }}>
    <header className="detail-header"><span className="eyebrow">COLLECTION NO. {String(figure.catalog_index).padStart(3, '0')}</span><button className="icon-button" aria-label="关闭收藏档案" onClick={close} disabled={busy}><X size={23} /></button></header>
    <div className="detail-content"><aside className="reference-panel"><Picture figure={figure} className="detail-picture" /><span className="reference-label">{figure.image_file ? '图鉴参考图' : '原站缺图 · 可添加自己的实物照片'}</span><div className="reference-description"><h1>{figure.name}</h1><p className="pose">{figure.pose_label_zh}</p><p className="manufacturer">Beswick · Beatrix Potter</p></div><button className={`primary-button detail-collect ${entry.owned ? 'collected' : ''}`} onClick={onToggle} disabled={togglePending || busy} aria-pressed={entry.owned}>{entry.owned ? <Check size={18} /> : <Sparkles size={18} />}{entry.owned ? '已收藏 · 点击取消点亮' : '点亮这个款式'}</button><details className="source-details"><summary>款式资料与来源</summary><p>{figure.image_note_zh}</p>{figure.review_note_zh && <p>{figure.review_note_zh}</p>}<p>同一动作的上色、年份、底款和尺寸差异，合并为一个收藏条目。</p><a href={figure.source_page} target="_blank" rel="noreferrer">查看原始资料 <ExternalLink size={13} /></a></details></aside>
      <section className="item-section"><div className="section-heading"><div className="eyebrow">MY OWN PIECES</div><h2>我的实物档案</h2><p>把照片和这件收藏的故事，留在一起。</p></div>
        <div className="item-tabs">{entry.items.map((item, index) => <button key={item.id} className={draft.id === item.id ? 'active' : ''} disabled={busy} onClick={() => selectItem(item)}>实物 {index + 1}{item.photos.length > 0 && <Camera size={13} />}</button>)}<button className={isNew ? 'active' : ''} disabled={busy || entry.items.length >= 100} onClick={() => selectItem(blankItem())}><Plus size={14} />{entry.items.length ? '再添一件' : '第一件收藏'}</button></div>
        <form onSubmit={save}><fieldset disabled={busy}><div className="photo-grid">{draft.photos.map((photo, index) => <div className="photo-tile" key={photo.id}><button type="button" className="photo-view" onClick={() => setZoom('/uploads/' + photo.filename)} aria-label={`放大实物照片 ${index + 1}`}><img src={'/uploads/' + photo.filename} alt={`实物照片 ${index + 1}`} /></button><button type="button" className="photo-remove" aria-label={`移除照片 ${index + 1}`} onClick={() => change('photos', draft.photos.filter(p => p.id !== photo.id))}><X size={13} /></button></div>)}{previews.map((url, index) => <div className="photo-tile pending-photo" key={url}><img src={url} alt={`待保存照片 ${index + 1}`} /><span>待保存</span><button type="button" className="photo-remove" aria-label={`移除待保存照片 ${index + 1}`} onClick={() => { setFiles(current => current.filter((_, i) => i !== index)); setDirty(true); }}><X size={13} /></button></div>)}<label className="photo-upload"><Camera size={24} strokeWidth={1.3} /><span>添加实物照片</span><small>正面、背面、底款</small><input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={choosePhotos} aria-label="添加实物照片" /></label></div><div className="upload-hint">JPG / PNG / WebP · 每张不超过 15 MB</div>
          <div className="form-grid"><label>入藏日期<input type="date" value={draft.acquisitionDate} onChange={event => change('acquisitionDate', event.target.value)} /></label><label>购入价格<div className="price-input"><select aria-label="币种" value={draft.currency} onChange={event => change('currency', event.target.value)}>{['USD', 'CAD', 'GBP', 'CNY', 'EUR'].map(c => <option key={c}>{c}</option>)}</select><input type="number" min="0" max="1000000000" step="0.01" value={draft.price ?? ''} placeholder="0.00" onChange={event => change('price', event.target.value)} aria-label="购入价格" /></div></label><label className="span-two">购入地点 / 来源<input maxLength={500} value={draft.purchasePlace} onChange={event => change('purchasePlace', event.target.value)} placeholder="拍卖行、古董店，或朋友赠送" /></label><label className="span-two">品相<input maxLength={200} value={draft.condition} onChange={event => change('condition', event.target.value)} placeholder="例如：无磕碰、无修复，底部有轻微使用痕迹" /></label><label className="span-two">收藏笔记<textarea rows={4} maxLength={10000} value={draft.notes} onChange={event => change('notes', event.target.value)} placeholder="底款、发现它的经过，或任何想记住的细节…" /></label></div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-footer"><span>{dirty ? '有尚未保存的修改' : isNew ? '保存档案时会同时点亮这一款' : '这件实物的资料已保存'}</span><button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{busy ? '正在保存…' : '保存实物档案'}</button></div>
        </fieldset></form>
        {!isNew && <div className="remove-item">{removing ? <><span>移除这件实物的记录和照片引用？其他实物会保留。</span><button className="danger-button" disabled={busy} onClick={removeItem}>确认移除</button><button className="quiet-button" disabled={busy} onClick={() => setRemoving(false)}>取消</button></> : <button className="text-button" onClick={() => setRemoving(true)} disabled={busy}><Trash2 size={13} />移除这件实物记录</button>}</div>}
      </section>
    </div>
    {zoom && <div className="photo-lightbox"><button className="icon-button" aria-label="关闭大图" onClick={() => setZoom(null)}><X size={25} /></button><img src={zoom} alt="实物照片大图" /></div>}
  </dialog>;
}
