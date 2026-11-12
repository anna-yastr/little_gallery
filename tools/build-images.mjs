/* =========================================================
   Конвертер картинок: _originals/  →  assets/ (WebP)
   и автоматическое обновление content/gallery.json.

   Запуск: двойной клик по «обновить-картинки.bat»
   или в терминале: npm run images        (--force — пересобрать всё)
   ========================================================= */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIG = path.join(ROOT, '_originals');
const GALLERY_JSON = path.join(ROOT, 'content', 'gallery.json');

const FULL = 1200;   // длинная сторона картинки в галерее и lightbox
const THUMB = 720;   // ширина превью в сетке галереи и на обложках
const PREVIEW = 1000; // превью игр, ссылок и общие картинки
const QUALITY = 85;  // качество WebP (0–100)

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff']);
const VIDEO_EXT = new Set(['.mp4', '.webm']);
const FORCE = process.argv.includes('--force');

const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const slug = (s) =>
  [...s.toLowerCase()].map((c) => TR[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'img';

const natural = (a, b) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' });
const isCover = (name) => /cover|обложк/i.test(name);

const stat = (p) => fs.stat(p).catch(() => null);

async function listImages(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && IMG_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort(natural);
}

async function listVideos(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort(natural);
}

async function listDirs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(natural);
}

/** Уникальные латинские имена для списка файлов. */
function uniqueNames(files, reserved = []) {
  const used = new Set(reserved);
  return files.map((f) => {
    const base = slug(path.parse(f).name);
    let name = base;
    for (let k = 2; used.has(name); k++) name = `${base}-${k}`;
    used.add(name);
    return name;
  });
}

let converted = 0, skipped = 0, removed = 0;

async function convert(src, dest, resize) {
  const [s, d] = await Promise.all([stat(src), stat(dest)]);
  if (!FORCE && d && s && d.mtimeMs >= s.mtimeMs) { skipped++; return; }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await sharp(src)
    .rotate()
    .resize({ ...resize, withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 5 })
    .toFile(dest);
  converted++;
}

const full = { width: FULL, height: FULL, fit: 'inside' };
const thumb = { width: THUMB };
const preview = { width: PREVIEW, height: PREVIEW, fit: 'inside' };

async function copyIfNewer(src, dest) {
  const [s, d] = await Promise.all([stat(src), stat(dest)]);
  if (!FORCE && d && s && d.mtimeMs >= s.mtimeMs) { skipped++; return; }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  converted++;
}

/**
 * Обложка карточки из папки: картинка (cover/обложка или первая) → cover.webp,
 * а если картинок нет, но есть видео — оно копируется как cover.mp4.
 * Возвращает путь для JSON или null.
 */
async function makeCover(srcDir, outDir, base) {
  const files = await listImages(srcDir);
  if (files.length) {
    const f = files.find(isCover) || files[0];
    await convert(path.join(srcDir, f), path.join(outDir, 'cover.webp'), preview);
    await removeStale(outDir, new Set(['cover.webp']));
    return `${base}/cover.webp`;
  }
  const videos = await listVideos(srcDir);
  if (videos.length) {
    const f = videos.find(isCover) || videos[0];
    await copyIfNewer(path.join(srcDir, f), path.join(outDir, 'cover.mp4'));
    await removeStale(outDir, new Set(['cover.mp4']));
    return `${base}/cover.mp4`;
  }
  return null;
}

/** Удаляет из папки .webp/.mp4, которые больше не соответствуют ни одному оригиналу. */
async function removeStale(dir, keep) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isFile() && /\.(webp|mp4)$/.test(e.name) && !keep.has(e.name)) {
      await fs.unlink(path.join(dir, e.name));
      removed++;
    }
  }
}

/* ---------- галерея ---------- */

async function buildGallery() {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(GALLERY_JSON, 'utf8'));
  } catch (e) {
    console.error(`\n✗ Не получилось прочитать content/gallery.json: ${e.message}`);
    console.error('  Исправь ошибку в файле и запусти снова.\n');
    process.exit(1);
  }
  const cats = Array.isArray(raw) ? raw : raw.items;
  const report = [];

  for (const dirName of await listDirs(path.join(ORIG, 'gallery'))) {
    const srcDir = path.join(ORIG, 'gallery', dirName);
    const id = slug(dirName);
    const known = cats.find((c) => c.id === dirName || c.id === id || c.title === dirName);

    // подборка-ссылки: внутри по папке на каждый пост с обложкой
    if (known && known.layout === 'links') {
      const lines = await buildLinkCovers(known, srcDir);
      if (lines.length) report.push(`  ✓ ${known.title}:`, ...lines);
      continue;
    }

    const files = await listImages(srcDir);
    // подпапки с картинками — подподборки (например, Ведьмочки / Witchtober 2026)
    const subdirs = [];
    for (const sd of await listDirs(srcDir)) {
      const f = await listImages(path.join(srcDir, sd));
      if (f.length) subdirs.push([sd, f]);
    }
    if (!files.length && !subdirs.length) continue; // пустая папка — подборку не трогаем

    let cat = known;
    let isNew = false;
    if (!cat) {
      cat = { id, title: dirName, images: [] };
      cats.push(cat);
      isNew = true;
    }

    if (files.length) {
      report.push(await buildImageSet(cat, srcDir, files, isNew, '  '));
    } else {
      // своих картинок нет — только подподборки
      cat.images = [];
      delete cat.cover;
      const outDir = path.join(ROOT, cat.folder || `assets/gallery/${cat.id}`);
      await removeStale(outDir, new Set());
      await removeStale(path.join(outDir, 'thumbs'), new Set());
      report.push(`  ${isNew ? '+ новая подборка' : '✓'} ${cat.title}:`);
    }

    for (const [sd, f] of subdirs) {
      const childId = `${cat.id}-${slug(sd)}`;
      let child = cats.find((c) => c.id === childId || (c.parent === cat.id && c.title === sd));
      let childNew = false;
      if (!child) {
        child = { id: childId, title: sd, parent: cat.id, images: [] };
        cats.push(child);
        childNew = true;
      }
      report.push(await buildImageSet(child, path.join(srcDir, sd), f, childNew, '      '));
    }
  }

  await fs.writeFile(GALLERY_JSON, JSON.stringify(raw, null, 2) + '\n');
  return report;
}

/** Картинки одной подборки: конвертирует, обновляет список, удаляет лишнее. */
async function buildImageSet(cat, srcDir, files, isNew, indent) {
  const outDir = path.join(ROOT, cat.folder || `assets/gallery/${cat.id}`);
  const thumbDir = path.join(outDir, 'thumbs');
  const oldEntries = new Map(
    (cat.images || []).filter((im) => im && typeof im === 'object' && im.src).map((im) => [im.src, im])
  );

  const coverFile = files.find(isCover);
  const pages = files.filter((f) => f !== coverFile);
  const names = uniqueNames(pages, ['cover']);
  const keep = new Set();

  if (coverFile) {
    await convert(path.join(srcDir, coverFile), path.join(outDir, 'cover.webp'), full);
    await convert(path.join(srcDir, coverFile), path.join(thumbDir, 'cover.webp'), thumb);
    keep.add('cover.webp');
    cat.cover = 'cover.webp';
  } else {
    delete cat.cover; // обложкой станет первая картинка
  }

  cat.images = [];
  for (let i = 0; i < pages.length; i++) {
    const out = `${names[i]}.webp`;
    await convert(path.join(srcDir, pages[i]), path.join(outDir, out), full);
    await convert(path.join(srcDir, pages[i]), path.join(thumbDir, out), thumb);
    keep.add(out);
    cat.images.push(oldEntries.get(out) || out); // подписи сохраняются
  }

  await removeStale(outDir, keep);
  await removeStale(thumbDir, keep);
  return `${indent}${isNew ? '+ новая подборка' : '✓'} ${cat.title}: ${pages.length} шт.${coverFile ? ' + обложка' : ''}`;
}

/** Обложки для подборки-ссылок: _originals/gallery/<Подборка>/<Название поста>/cover.png */
async function buildLinkCovers(cat, srcDir) {
  const items = Array.isArray(cat.items) ? cat.items : [];
  const lines = [];
  for (const dirName of await listDirs(srcDir)) {
    const key = slug(dirName);
    const item = items.find((it) => it.title === dirName || slug(it.title || '') === key);
    const image = await makeCover(path.join(srcDir, dirName), path.join(ROOT, 'assets', 'gallery', cat.id, key), `assets/gallery/${cat.id}/${key}`);
    if (!image) continue;
    if (!item) {
      lines.push(`    ? «${dirName}»: нет такого поста в подборке — путь: "${image}"`);
      continue;
    }
    item.image = image;
    lines.push(`    ✓ ${item.title}`);
  }
  return lines;
}

/* ---------- превью игр, ссылок, общие картинки ---------- */

async function buildFlat(sub) {
  const srcDir = path.join(ORIG, sub);
  const files = await listImages(srcDir);
  const names = uniqueNames(files);
  const lines = [];
  for (let i = 0; i < files.length; i++) {
    const out = `assets/${sub}/${names[i]}.webp`;
    await convert(path.join(srcDir, files[i]), path.join(ROOT, out), preview);
    lines.push(`  ${files[i]}  →  "${out}"`);
  }
  return lines;
}

/* ---------- игры и ссылки: папка на каждую карточку ---------- */

/**
 * _originals/games/<Название карточки>/cover.png  →  assets/games/<slug>/cover.webp
 * и путь сам вписывается в поле "image" карточки с таким названием.
 */
async function buildItems(sub) {
  const jsonPath = path.join(ROOT, 'content', `${sub}.json`);
  const dirs = await listDirs(path.join(ORIG, sub));
  if (!dirs.length) return [];

  let raw;
  try {
    raw = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  } catch (e) {
    return [`  ✗ Не получилось прочитать content/${sub}.json: ${e.message}`];
  }
  const items = Array.isArray(raw) ? raw : raw.items;
  const lines = [];
  let changed = false;

  for (const dirName of dirs) {
    const srcDir = path.join(ORIG, sub, dirName);
    const key = slug(dirName);
    const item = items.find((it) => it.title === dirName || slug(it.title || '') === key);

    // группа ссылок: подпапки — обложки вложенных постов
    if (item && Array.isArray(item.items)) {
      for (const sd of await listDirs(srcDir)) {
        const sk = slug(sd);
        const child = item.items.find((it) => it.title === sd || slug(it.title || '') === sk);
        const img = await makeCover(path.join(srcDir, sd), path.join(ROOT, 'assets', sub, key, sk), `assets/${sub}/${key}/${sk}`);
        if (!img) continue;
        if (!child) { lines.push(`    ? «${dirName} / ${sd}»: нет такого поста в группе — путь: "${img}"`); continue; }
        if (child.image !== img) { child.image = img; changed = true; }
        lines.push(`    ✓ ${item.title} / ${child.title}`);
      }
    }

    // видеоподборка ("layout": "videos"): все видео из папки копируются и попадают в список
    if (item && item.layout === 'videos') {
      if (await syncVideos(item, srcDir, `assets/${sub}/${key}`)) changed = true;
      lines.push(`  ✓ ${item.title}: ${list(item.videos).length} видео`);
      continue;
    }

    // наборы видео ("layout": "packs"): каждая подпапка — свой набор (стикерпак) со своими видео
    if (item && item.layout === 'packs') {
      if (!Array.isArray(item.packs)) item.packs = [];
      for (const sd of await listDirs(srcDir)) {
        const sk = slug(sd);
        let pack = item.packs.find((p) => p.title === sd || slug(p.title || '') === sk);
        if (!pack) { pack = { title: sd, videos: [] }; item.packs.push(pack); changed = true; }
        if (await syncVideos(pack, path.join(srcDir, sd), `assets/${sub}/${key}/${sk}`)) changed = true;
        lines.push(`    ✓ ${item.title} / ${pack.title}: ${list(pack.videos).length} видео`);
      }
      const image = (item.packs.find((p) => p.image) || {}).image;
      if (image && item.image !== image) { item.image = image; changed = true; }
      continue;
    }

    const image = await makeCover(srcDir, path.join(ROOT, 'assets', sub, key), `assets/${sub}/${key}`);
    if (!image) continue;

    if (!item) {
      lines.push(`  ? «${dirName}»: нет карточки с таким названием в content/${sub}.json — путь: "${image}"`);
      continue;
    }
    if (item.image !== image) {
      item.image = image;
      changed = true;
    }
    lines.push(`  ✓ ${item.title}`);
  }

  if (changed) await fs.writeFile(jsonPath, JSON.stringify(raw, null, 2) + '\n');
  return lines;
}

const list = (x) => (Array.isArray(x) ? x : []);

/**
 * Копирует все видео из папки в assets и обновляет target.videos / target.image.
 * Подписи, поправленные в JSON вручную, сохраняются. Возвращает true, если что-то поменялось.
 */
async function syncVideos(target, srcDir, base) {
  const outDir = path.join(ROOT, base);
  const vids = await listVideos(srcDir);
  const imgs = await listImages(srcDir);
  const names = uniqueNames(vids, ['cover']);
  const old = new Map(list(target.videos).filter((v) => v && v.src).map((v) => [v.src, v]));
  const keep = new Set();
  const videos = [];
  for (let i = 0; i < vids.length; i++) {
    const file = `${names[i]}${path.extname(vids[i]).toLowerCase()}`;
    const src = `${base}/${file}`;
    await copyIfNewer(path.join(srcDir, vids[i]), path.join(outDir, file));
    keep.add(file);
    videos.push(old.get(src) || { src, title: path.parse(vids[i]).name });
  }
  let image = videos[0] ? videos[0].src : null;
  if (imgs.length) {
    const f = imgs.find(isCover) || imgs[0];
    await convert(path.join(srcDir, f), path.join(outDir, 'cover.webp'), preview);
    keep.add('cover.webp');
    image = `${base}/cover.webp`;
  }
  await removeStale(outDir, keep);
  if (JSON.stringify(target.videos) === JSON.stringify(videos) && target.image === (image || undefined)) return false;
  target.videos = videos;
  if (image) target.image = image; else delete target.image;
  return true;
}

/* ---------- запуск ---------- */

console.log('\n✦ Обновляю картинки…\n');
const gallery = await buildGallery();
if (gallery.length) console.log('Галерея:\n' + gallery.join('\n') + '\n');

for (const [sub, label] of [['games', 'Игры'], ['links', 'Ссылки']]) {
  const lines = [...await buildItems(sub), ...await buildFlat(sub)];
  if (lines.length) console.log(`${label}:\n${lines.join('\n')}\n`);
}

const common = await buildFlat('common');
if (common.length) console.log(`Общие картинки:\n${common.join('\n')}\n`);

console.log(`Готово ✦ сконвертировано: ${converted}, без изменений: ${skipped}, удалено старых: ${removed}\n`);
