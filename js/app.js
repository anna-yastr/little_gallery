'use strict';

/* =========================================================
   Creative Hub — весь контент живёт в папке content/*.json.
   Этот файл трогать для добавления контента не нужно.
   ========================================================= */

const FILES = {
  site: 'content/site.json',
  games: 'content/games.json',
  gallery: 'content/gallery.json',
  links: 'content/links.json',
};

const SECTION_DEFAULTS = {
  games: { title: 'Игры и интерактивы', intro: '' },
  gallery: { title: 'Галерея', intro: '' },
  links: { title: 'Ссылки и всякое', intro: '' },
};

const STATUS = { new: 'Новое', active: 'Идёт', archived: 'Архив' };

const TINTS = ['#343a73', '#3b3572', '#2f4170', '#383869', '#40386f', '#2e466c'];

const app = document.getElementById('app');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const scrollBehavior = () => (reduceMotion.matches ? 'auto' : 'smooth');

/* ---------- загрузка JSON ---------- */

const cache = {};
function load(name) {
  if (!cache[name]) {
    cache[name] = fetch(FILES[name], { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`файл не найден (HTTP ${r.status})`);
        return r.text();
      })
      .then((text) => {
        try {
          return { data: JSON.parse(text) };
        } catch (e) {
          throw new Error(`ошибка в записи JSON: ${e.message}`);
        }
      })
      .catch((error) => ({ error, file: FILES[name] }));
  }
  return cache[name];
}

/** Массив элементов из файла: принимает и [ ... ], и { "items": [ ... ] }. */
function list(data) {
  const arr = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : [];
  return arr.filter((x) => x && typeof x === 'object' && !x.hidden);
}

/* ---------- маленькие помощники ---------- */

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

function safeUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(String(u), location.href);
    return ['http:', 'https:', 'tg:', 'mailto:'].includes(url.protocol) ? String(u) : null;
  } catch {
    return null;
  }
}

function linkAttrs(u) {
  let external = true;
  try {
    external = new URL(u, location.href).origin !== location.origin;
  } catch { /* оставляем external */ }
  return external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

function hashNum(seed) {
  let n = 0;
  for (const ch of String(seed || '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n;
}

function tint(seed) {
  const n = hashNum(seed);
  return TINTS[n % TINTS.length];
}

function plural(n, [one, few, many]) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Картинка с ленивой загрузкой. Сначала пробует src (обычно маленькое превью),
 * если его нет — fallback (полная картинка), если нет и её — цветную заглушку ✦.
 */
function pic(src, alt, seed, extraClass, eager, fallback) {
  const box = h('div', { class: `pic ${extraClass || ''}`.trim() });
  const placeholder = () => {
    box.classList.add('pic--empty');
    box.style.setProperty('--ph', tint(seed));
    box.replaceChildren(h('span', { class: 'pic__ph', 'aria-hidden': 'true' }, '✦'));
    if (alt) {
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', alt);
    }
  };
  if (!src) src = fallback;
  if (!src) {
    placeholder();
    return box;
  }
  if (/\.(mp4|webm)$/i.test(src)) {
    const video = h('video', {
      src, muted: true, loop: true, playsinline: true, preload: 'metadata',
      autoplay: !reduceMotion.matches, 'aria-hidden': alt ? null : 'true', 'aria-label': alt || null,
    });
    video.muted = true; // нужно свойство, а не только атрибут, чтобы автозапуск работал
    video.addEventListener('error', placeholder);
    box.append(video);
    return box;
  }
  let next = fallback && fallback !== src ? fallback : null;
  const img = h('img', { src, alt: alt || '', loading: eager ? 'eager' : 'lazy', decoding: 'async' });
  img.addEventListener('error', () => {
    if (next) { img.src = next; next = null; } else placeholder();
  });
  box.append(img);
  return box;
}

function notice(text, extra) {
  return h('div', { class: 'notice', role: 'status' }, h('p', null, text), extra && h('p', { class: 'notice__small' }, extra));
}

function loadError(res) {
  return notice(
    `Не получилось загрузить ${res.file} 😿`,
    `${res.error.message}. Проверь запятые, кавычки и скобки в этом файле.`
  );
}

const HOME_BACK = { href: '#', label: 'Главная' };

function pageHead(title, intro, back) {
  return h('header', { class: 'page-head' },
    back && h('a', { class: 'back', href: back.href }, `← ${back.label}`),
    h('h1', { class: 'page-title', tabindex: '-1' }, h('span', { class: 'star', 'aria-hidden': 'true' }, '✦'), ' ', title),
    intro && h('p', { class: 'page-intro' }, intro)
  );
}

function sectionInfo(site, key) {
  return { ...SECTION_DEFAULTS[key], ...((site && site.sections && site.sections[key]) || {}) };
}

/* ---------- карточки ---------- */

function card(item) {
  const url = safeUrl(item.url);
  const status = STATUS[item.status];
  const inner = [
    h('div', { class: 'card__media' },
      pic(item.image, '', item.title),
      status && h('span', { class: `badge badge--${item.status}` }, status)
    ),
    h('div', { class: 'card__body' },
      item.tag && h('span', { class: 'card__tag' }, item.tag),
      h('h3', { class: 'card__title' }, item.title || 'Без названия'),
      item.description && h('p', { class: 'card__text' }, item.description)
    ),
  ];
  const cls = `card${item.status === 'archived' ? ' card--archived' : ''}`;
  return url ? h('a', { class: cls, href: url, ...linkAttrs(url) }, inner) : h('div', { class: cls }, inner);
}

function cardGrid(cards, emptyText) {
  return cards.length ? h('div', { class: 'cards' }, cards) : notice(emptyText);
}

/* ---------- галерея: данные ---------- */

const isFullPath = (src) => /^(https?:)?\/\/|^assets\//.test(String(src));

function resolve(folder, src) {
  return isFullPath(src) ? String(src) : folder + src;
}

/** Превью, которое делает tools/build-images.mjs: папка/thumbs/имя.webp */
function thumbOf(folder, src) {
  return isFullPath(src) ? null : `${folder}thumbs/${src}`;
}

function normCategory(c) {
  const id = String(c.id || '').trim();
  const title = c.title || 'Без названия';
  const folder = c.folder ? String(c.folder).replace(/\/?$/, '/') : `assets/gallery/${id}/`;
  const images = (Array.isArray(c.images) ? c.images : [])
    .map((im) => (typeof im === 'string' ? { src: im } : im))
    .filter((im) => im && im.src)
    .map((im, i) => ({
      src: resolve(folder, im.src),
      thumb: thumbOf(folder, im.src),
      caption: im.caption || '',
      alt: im.alt || im.caption || `${title} — ${i + 1}`,
    }));
  const first = images[0] || {};
  return {
    ...c, id, title, images,
    hasCover: Boolean(c.cover),
    cover: c.cover ? resolve(folder, c.cover) : first.src,
    coverThumb: c.cover ? thumbOf(folder, c.cover) : first.thumb,
  };
}

function categories(data) {
  const all = list(data).map(normCategory).filter((c) => c.id);
  for (const c of all) {
    c.children = all.filter((x) => x.parent === c.id);
    if (!c.cover && c.children.length) {
      c.cover = c.children[0].cover;
      c.coverThumb = c.children[0].coverThumb;
    }
  }
  return all;
}

/** Подборки верхнего уровня — те, что стоят на полке. */
const topCategories = (data) => categories(data).filter((c) => !c.parent);

function countLabel(c) {
  if (c.layout === 'links') {
    const k = list(c.items).length;
    return k ? `${k} ${plural(k, ['пост', 'поста', 'постов'])}` : 'скоро';
  }
  const n = c.images.length;
  const k = (c.children || []).length;
  if (!n && k) return `${k} ${plural(k, ['подборка', 'подборки', 'подборок'])}`;
  if (!n) return 'скоро';
  return `${n} ${plural(n, (c.layout === 'strip' || c.layout === 'book') ? ['страница', 'страницы', 'страниц'] : ['работа', 'работы', 'работ'])}`;
}

function categoryTile(c) {
  return h('a', { class: 'card card--folder', href: `#gallery/${encodeURIComponent(c.id)}` },
    h('div', { class: 'card__media' }, pic(c.coverThumb, '', c.title, '', false, c.cover)),
    h('div', { class: 'card__body' },
      c.group && h('span', { class: 'card__tag' }, c.group),
      h('h3', { class: 'card__title' }, c.title),
      c.description && h('p', { class: 'card__text' }, c.description),
      h('span', { class: 'card__meta' }, countLabel(c))
    )
  );
}

/* ---------- страницы ---------- */

async function viewHome() {
  const [site, games, gallery, links] = await Promise.all(['site', 'games', 'gallery', 'links'].map(load));
  const s = site.data || {};
  const out = [];
  if (site.error) out.push(loadError(site));

  const channel = safeUrl(s.channel);
  out.push(h('section', { class: 'hero' },
    s.avatar && pic(s.avatar, s.name || '', s.name, 'hero__avatar'),
    h('div', { class: 'hero__text' },
      s.hello && h('p', { class: 'hero__hello' }, s.hello),
      h('h1', { class: 'hero__title', tabindex: '-1' }, s.name || 'Ame Tanami'),
      s.greeting && h('p', { class: 'hero__lead' }, s.greeting),
      channel && h('a', { class: 'btn', href: channel, ...linkAttrs(channel) }, s.channelLabel || 'В канал ✦')
    )
  ));

  if ((s.homeView || 'shelf') === 'shelf') {
    // галерея — по полке на каждую группу (Арты, Комиксы…), дальше игры и ссылки
    const galleryShelves = gallery.data
      ? [...groupBy(topCategories(gallery.data))].map(([name, cats]) => ({
        label: name || sectionInfo(s, 'gallery').title, href: '#gallery', books: cats.map(categoryBook),
      }))
      : [];
    out.push(bookcase([
      ...galleryShelves,
      ...['games', 'links'].map((key) => {
        const res = { games, links }[key];
        const books = res.data ? list(res.data).map((it) => itemBook(asEntry(key, it))).filter(Boolean) : [];
        return { label: sectionInfo(s, key).title, href: `#${key}`, books };
      }),
    ]));
    return out;
  }

  out.push(h('nav', { class: 'tiles', 'aria-label': 'Разделы' },
    ['games', 'gallery', 'links'].map((key, i) => {
      const info = sectionInfo(s, key);
      return h('a', { class: `tile tile--${i + 1}`, href: `#${key}` },
        h('span', { class: 'tile__star', 'aria-hidden': 'true' }, '✦'),
        h('span', { class: 'tile__title' }, info.title),
        info.intro && h('span', { class: 'tile__text' }, info.intro)
      );
    })
  ));

  const featured = [
    ...(games.data ? list(games.data).filter((x) => x.featured).map(card) : []),
    ...(gallery.data ? topCategories(gallery.data).filter((x) => x.featured).map(categoryTile) : []),
    ...(links.data ? list(links.data).filter((x) => x.featured).map(card) : []),
  ];
  if (featured.length) {
    out.push(h('section', { class: 'section', 'aria-labelledby': 'featured-title' },
      h('h2', { class: 'section-title', id: 'featured-title' }, s.featuredTitle || 'Сейчас интересно'),
      h('div', { class: 'cards' }, featured)
    ));
  }
  return out;
}

/** Карточка-группа (есть items) ведёт на свою страницу, а не наружу. */
const isGroup = (it) => Boolean(it.id) && (Array.isArray(it.items) || it.layout === 'videos' || it.layout === 'packs');

/** Разделы, где карточка открывает свою страницу (обложка, описание, кнопка), а не ссылку сразу. */
const DETAIL_SECTIONS = ['games'];

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
/** Адрес страницы карточки: поле id или латиница из названия. */
const itemId = (it) => String(it.id || [...String(it.title || '').toLowerCase()]
  .map((c) => TRANSLIT[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));

/** Страница одной карточки: обложка, описание, кнопка-ссылка. */
function detail(it) {
  const url = safeUrl(it.url);
  const status = STATUS[it.status];
  const text = it.about || it.description;
  return h('article', { class: 'detail' },
    h('div', { class: 'detail__media' }, pic(it.image, it.title, it.title, '', true)),
    h('div', { class: 'detail__body' },
      (it.tag || status) && h('p', { class: 'detail__meta' },
        it.tag && h('span', { class: 'card__tag' }, it.tag),
        status && h('span', { class: `badge badge--${it.status} detail__badge` }, status)
      ),
      text && h('p', { class: 'detail__text' }, text),
      url && h('a', { class: 'btn', href: url, ...linkAttrs(url) }, it.linkLabel || 'Играть ✦')
    )
  );
}

function asEntry(key, it) {
  if (!isGroup(it)) {
    if (!DETAIL_SECTIONS.includes(key) || !itemId(it)) return it;
    return { ...it, url: `#${key}/${encodeURIComponent(itemId(it))}` };
  }
  const k = list(it.layout === 'videos' ? it.videos : it.layout === 'packs' ? it.packs : it.items).length;
  const count = it.layout === 'videos' ? `${k} видео`
    : it.layout === 'packs' ? `${k} ${plural(k, ['пак', 'пака', 'паков'])}`
    : `${k} ${plural(k, ['пост', 'поста', 'постов'])}`;
  return { ...it, url: `#${key}/${encodeURIComponent(it.id)}`, description: it.description || count };
}

/** Страница с видеоплеерами; играет только одно видео за раз. */
function videoGrid(g) {
  const vids = list(g.videos);
  if (!vids.length) return notice('Видео скоро появятся ✦');
  // autoplay: true — крутятся сами без звука, как стикеры; иначе обычный плеер
  const auto = Boolean(g.autoplay) && !reduceMotion.matches;
  const players = vids.map((v) => {
    const p = auto
      ? h('video', { src: v.src, muted: true, loop: true, autoplay: true, playsinline: true, preload: 'auto' })
      : h('video', { src: v.src, controls: true, preload: 'metadata', playsinline: true });
    if (auto) p.muted = true;
    return p;
  });
  if (!auto) players.forEach((p) => p.addEventListener('play', () => players.forEach((o) => { if (o !== p) o.pause(); })));
  const more = safeUrl(g.url);
  return [
    h('div', { class: g.autoplay ? 'videos videos--stickers' : 'videos' }, vids.map((v, i) => h('figure', { class: 'video' },
      players[i],
      v.title && h('figcaption', { class: 'video__title' }, v.title)
    ))),
    more && h('p', { class: 'more' }, h('a', { class: 'btn', href: more, ...linkAttrs(more) }, g.moreLabel || 'Больше видео ✦')),
  ];
}

/** Наборы видео (стикерпаки): у каждого заголовок, превью и своя кнопка. */
function packs(g) {
  const ps = list(g.packs);
  if (!ps.length) return notice('Скоро появится ✦');
  return ps.map((p) => h('section', { class: 'section pack' },
    h('h2', { class: 'section-title' }, p.title),
    p.description && h('p', { class: 'pack__text' }, p.description),
    videoGrid({ autoplay: true, ...p })
  ));
}

async function viewList(key, groupId) {
  const [site, res] = await Promise.all([load('site'), load(key)]);
  const info = sectionInfo(site.data, key);
  if (res.error) return [pageHead(info.title, info.intro, HOME_BACK), loadError(res)];

  if (groupId) {
    const back = { href: `#${key}`, label: info.title };
    const all = list(res.data);
    const one = DETAIL_SECTIONS.includes(key) && all.find((it) => !isGroup(it) && itemId(it) === groupId);
    if (one) return [pageHead(one.title, '', back), detail(one)];
    const g = all.find((it) => it.id === groupId && isGroup(it));
    if (!g) return [pageHead('Такого раздела нет', '', back), notice('Возможно, он переехал или ещё не готов.')];
    return [
      pageHead(g.title, g.description, back),
      g.layout === 'videos' ? videoGrid(g) : g.layout === 'packs' ? packs(g) : cardGrid(list(g.items).map(card), 'Скоро появится ✦'),
    ];
  }
  return [
    pageHead(info.title, info.intro, HOME_BACK),
    cardGrid(list(res.data).map((it) => card(asEntry(key, it))), 'Пока здесь пусто — скоро появится ✦'),
  ];
}

/** Подборки по группам (поле group) в порядке первого появления. */
function groupBy(cats) {
  const groups = new Map();
  for (const c of cats) {
    const g = c.group || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  return groups;
}

async function viewGallery() {
  const [site, res] = await Promise.all([load('site'), load('gallery')]);
  const info = sectionInfo(site.data, 'gallery');
  if (res.error) return [pageHead(info.title, info.intro, HOME_BACK), loadError(res)];

  const groups = groupBy(topCategories(res.data));
  if (!groups.size) return [pageHead(info.title, info.intro, HOME_BACK), notice('Подборки скоро появятся ✦')];

  const asShelf = ((site.data && site.data.galleryView) || 'shelf') === 'shelf';
  if (asShelf) {
    return [
      pageHead(info.title, info.intro, HOME_BACK),
      bookcase([...groups].map(([name, cats]) => ({ label: name, books: cats.map(categoryBook) }))),
    ];
  }
  return [
    pageHead(info.title, info.intro, HOME_BACK),
    [...groups].map(([name, cats]) => h('section', { class: 'section' },
      name && h('h2', { class: 'section-title' }, name),
      h('div', { class: 'cards' }, cats.map((c) => categoryTile({ ...c, group: '' })))
    )),
  ];
}

/* ---------- книжный стеллаж ---------- */

const SPINES = ['#3b3f86', '#4b3a7e', '#2f4f7f', '#5a3b6e', '#2c3a6a', '#47407a', '#3a5a7a', '#553a5e'];
const STACK_SIZE = 3; // обычно книг в стопке
const MAX_STACKS = 3; // больше стопок на полку не ставим — стопки становятся выше

/** Книга, лежащая на полке. o: { title, href, seed, color, meta, marked } */
function shelfBook(o) {
  const n = hashNum(o.seed || o.title);
  const color = /^#[0-9a-f]{3,8}$/i.test(o.color || '') ? o.color : SPINES[n % SPINES.length];
  const len = 180 + (n % 90);
  const thick = 40 + ((n >> 5) % 12);
  const dx = (n >> 9) % 24;
  const external = linkAttrs(o.href).target === '_blank';
  return h('a', {
    class: 'hbook',
    href: o.href,
    ...linkAttrs(o.href),
    style: `--spine:${color};--len:${len}px;--t:${thick}px;--dx:${dx}px`,
    title: o.meta ? `${o.title} — ${o.meta}` : o.title,
    onclick: external ? null : pullOut,
  },
    h('span', { class: 'hbook__title' }, o.title),
    h('span', { class: 'hbook__star', 'aria-hidden': 'true' }, '✦'),
    o.marked && h('span', { class: 'hbook__ribbon', 'aria-hidden': 'true' })
  );
}

/** Стеллаж: shelves = [{ label, href?, books: [элементы] }] */
function bookcase(shelves) {
  return h('div', { class: 'bookcase' },
    shelves.filter((sh) => sh.books.length).map((sh) => {
      const stacks = [];
      // раскладываем книги на ровные стопки: 4 → 2+2, 5 → 3+2, 7 → 3+2+2, 10 → 4+3+3
      const count = Math.min(MAX_STACKS, Math.ceil(sh.books.length / STACK_SIZE));
      let from = 0;
      for (let i = 0; i < count; i++) {
        const size = Math.ceil((sh.books.length - from) / (count - i));
        stacks.push(sh.books.slice(from, from + size));
        from += size;
      }
      return h('section', { class: 'shelf', 'aria-label': sh.label || 'Полка' },
        h('div', { class: 'shelf__row' }, stacks.map((st) => h('div', { class: 'stack' }, st))),
        h('div', { class: 'shelf__plank' },
          sh.label && (sh.href
            ? h('a', { class: 'shelf__label', href: sh.href }, sh.label, ' →')
            : h('span', { class: 'shelf__label' }, sh.label))
        )
      );
    })
  );
}

const categoryBook = (c) => shelfBook({
  title: c.shelfTitle || c.title, href: `#gallery/${encodeURIComponent(c.id)}`, seed: c.id, color: c.color,
  meta: countLabel(c), marked: c.featured,
});

const itemBook = (it) => {
  const url = safeUrl(it.url);
  return url && shelfBook({
    title: it.title || 'Без названия', href: url, seed: it.title, color: it.color,
    meta: it.description, marked: it.featured || it.status === 'new',
  });
};

/** Книга выезжает с полки, потом открывается страница. */
function pullOut(e) {
  if (reduceMotion.matches || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const a = e.currentTarget;
  a.classList.add('is-out');
  setTimeout(() => { location.hash = a.getAttribute('href'); }, 320);
}

async function viewCategory(id) {
  const [site, res] = await Promise.all([load('site'), load('gallery')]);
  const back = { href: '#gallery', label: sectionInfo(site.data, 'gallery').title };
  if (res.error) return [pageHead('Галерея', '', back), loadError(res)];

  const all = categories(res.data);
  const c = all.find((x) => x.id === id);
  if (!c) return [pageHead('Такой подборки нет', '', back), notice('Возможно, она переехала или ещё не готова.')];

  const parent = c.parent && all.find((x) => x.id === c.parent);
  if (parent) Object.assign(back, { href: `#gallery/${encodeURIComponent(parent.id)}`, label: parent.title });

  const kids = c.children;
  const own = c.layout === 'links'
    ? cardGrid(list(c.items).map(card), 'Посты скоро появятся ✦')
    : c.images.length
    ? (c.layout === 'strip' ? strip(c) : c.layout === 'book' ? book(c) : masonry(c))
    : !kids.length && notice('Картинки скоро появятся ✦');
  const sub = kids.length && h('section', { class: 'section' },
    own && h('h2', { class: 'section-title' }, 'Ещё в этой подборке'),
    h('div', { class: 'cards' }, kids.map((k) => categoryTile({ ...k, group: '' })))
  );
  return [pageHead(c.title, c.description, back), own, sub];
}

/* ---------- галерея: сетка ---------- */

function masonry(c) {
  return h('div', { class: 'masonry' },
    c.images.map((im, i) => h('figure', { class: 'masonry__item' },
      h('button', { class: 'masonry__btn', type: 'button', onclick: () => openLightbox(c.images, i) },
        pic(im.thumb, im.alt, c.title + i, '', false, im.src)
      ),
      im.caption && h('figcaption', { class: 'masonry__cap' }, im.caption)
    ))
  );
}

/* ---------- галерея: книга с перелистыванием (комиксы) ---------- */

const spreadQuery = window.matchMedia('(min-width: 720px)');

function book(c) {
  // есть обложка — книга сначала закрыта, иначе сразу открыта на развороте 1–2
  const coverItem = c.hasCover ? { src: c.cover, alt: `${c.title} — обложка`, caption: '', isCover: true } : null;
  const items = coverItem ? [coverItem, ...c.images] : c.images;
  const total = c.images.length;

  const stage = h('div', { class: 'book', tabindex: '0', role: 'region', 'aria-label': `${c.title}: книга, листай стрелками` });
  const count = h('span', { class: 'strip__count', 'aria-live': 'polite' });
  const prev = h('button', { class: 'round-btn', type: 'button', 'aria-label': 'Предыдущая страница', onclick: () => go(-1) }, '←');
  const next = h('button', { class: 'round-btn', type: 'button', 'aria-label': 'Следующая страница', onclick: () => go(1) }, '→');
  const zoom = h('button', { class: 'round-btn round-btn--ghost', type: 'button', 'aria-label': 'Открыть страницу крупно', title: 'Открыть крупно', onclick: () => zoomIn() }, '⤢');
  const cap = h('p', { class: 'strip__cap' });

  let spread = false, pos = 0, minPos = 0, leaves = [], pages = [];

  const face = (item, side, i) => h('div', { class: `leaf__face leaf__face--${side}` },
    item && pic(item.src, item.alt, c.title + i, 'page', i < 5));

  // сколько листов можно перевернуть
  const maxPos = () => (spread ? (pages.length % 2 === 0 ? leaves.length : leaves.length - 1) : leaves.length - 1);
  // видимые сейчас страницы (индексы в pages)
  const visible = () => (spread
    ? [2 * pos - 1, 2 * pos].filter((i) => i >= 0 && i < pages.length && pages[i])
    : [pos]);
  const currentItem = () => { const v = visible(); return pages[v[v.length - 1]] || items[0]; };
  const label = (item) => (item.isCover ? 'обложка' : String(c.images.indexOf(item) + 1));
  const zoomIn = () => openLightbox(items, Math.max(0, items.indexOf(currentItem())));

  function build() {
    const keep = leaves.length ? currentItem() : items[0];
    spread = spreadQuery.matches && items.length > 1;
    stage.classList.toggle('book--spread', spread);
    // без обложки на развороте: слева от первой страницы пустой форзац, он сразу перевёрнут
    pages = spread && !coverItem ? [null, ...items] : items.slice();
    minPos = spread && !coverItem ? 1 : 0;
    const leafCount = spread ? Math.ceil(pages.length / 2) : pages.length;
    leaves = Array.from({ length: leafCount }, (_, k) => h('div', { class: 'leaf' },
      spread ? face(pages[2 * k], 'front', 2 * k) : face(pages[k], 'front', k),
      spread ? face(pages[2 * k + 1], 'back', 2 * k + 1) : h('div', { class: 'leaf__face leaf__face--back' })
    ));
    stage.replaceChildren(...leaves);
    // оборотные страницы не видны до переворота — декодируем их заранее,
    // иначе после поворота лист может оказаться пустым
    stage.querySelectorAll('img').forEach((img) => {
      img.decoding = 'sync';
      img.addEventListener('load', () => { if (img.decode) img.decode().catch(() => {}); }, { once: true });
    });
    const idx = Math.max(0, pages.indexOf(keep));
    pos = Math.max(minPos, Math.min(spread ? Math.ceil(idx / 2) : idx, maxPos()));
    const first = stage.querySelector('img');
    if (first) first.addEventListener('load', () => {
      if (first.naturalWidth) stage.style.setProperty('--ratio', (first.naturalWidth / first.naturalHeight).toFixed(4));
    }, { once: true });
    update();
  }

  function update() {
    leaves.forEach((leaf, k) => {
      const flipped = k < pos;
      leaf.classList.toggle('is-flipped', flipped);
      leaf.style.zIndex = flipped ? k + 1 : leaves.length * 2 - k;
    });
    const shown = visible().map((i) => pages[i]);
    count.textContent = `${shown.map(label).join('–')} / ${total}`;
    cap.textContent = shown.map((it) => it.caption).filter(Boolean).join(' · ');
    prev.disabled = pos <= minPos;
    next.disabled = pos >= maxPos();
  }

  function go(d) {
    const to = pos + d;
    if (to < minPos || to > maxPos()) return;
    const turning = leaves[d > 0 ? pos : to];
    turning.classList.add('is-turning');
    setTimeout(() => turning.classList.remove('is-turning'), 750);
    pos = to;
    update();
  }

  // клик по правой половине — вперёд, по левой — назад; свайп листает
  let sx = 0, sy = 0, swiped = false;
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; swiped = false; });
  stage.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { swiped = true; go(dx < 0 ? 1 : -1); }
  });
  stage.addEventListener('click', (e) => {
    if (swiped) return;
    const r = stage.getBoundingClientRect();
    go(e.clientX - r.left > r.width / 2 ? 1 : -1);
  });
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'Enter') { e.preventDefault(); zoomIn(); }
  });

  const onResize = () => { if (stage.isConnected) build(); else spreadQuery.removeEventListener('change', onResize); };
  spreadQuery.addEventListener('change', onResize);

  build();
  return h('div', { class: 'book-wrap' },
    stage,
    h('div', { class: 'strip__bar' }, prev, count, next, zoom),
    cap
  );
}

/* ---------- галерея: горизонтальная листалка (комиксы) ---------- */

function strip(c) {
  const imgs = c.images;
  const pages = imgs.map((im, i) =>
    h('button', { class: 'strip__page', type: 'button', onclick: () => openLightbox(imgs, i) },
      pic(im.src, im.alt, c.title + i, '', i < 3)
    )
  );
  const track = h('div', { class: 'strip__track', tabindex: '0', role: 'region', 'aria-label': `${c.title}: листай вбок` }, pages);
  const prev = h('button', { class: 'round-btn', type: 'button', 'aria-label': 'Предыдущая страница', onclick: () => go(cur - 1) }, '←');
  const next = h('button', { class: 'round-btn', type: 'button', 'aria-label': 'Следующая страница', onclick: () => go(cur + 1) }, '→');
  const count = h('span', { class: 'strip__count', 'aria-live': 'polite' });
  const cap = h('p', { class: 'strip__cap' });

  let cur = 0;
  const update = () => {
    count.textContent = `${cur + 1} / ${imgs.length}`;
    cap.textContent = imgs[cur].caption;
    prev.disabled = cur === 0;
    next.disabled = cur === imgs.length - 1;
  };
  const offset = (i) => pages[i].offsetLeft - pages[0].offsetLeft;
  const go = (i) => {
    i = Math.max(0, Math.min(imgs.length - 1, i));
    track.scrollTo({ left: offset(i), behavior: scrollBehavior() });
    cur = i;
    update();
  };

  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const x = track.scrollLeft;
      let best = 0;
      if (x >= track.scrollWidth - track.clientWidth - 2) best = imgs.length - 1;
      else pages.forEach((_, i) => { if (Math.abs(offset(i) - x) < Math.abs(offset(best) - x)) best = i; });
      if (best !== cur) { cur = best; update(); }
    });
  }, { passive: true });

  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); }
  });

  update();
  return h('div', { class: 'strip' },
    track,
    h('div', { class: 'strip__bar' }, prev, count, next),
    cap
  );
}

/* ---------- lightbox ---------- */

const lb = (() => {
  const el = document.getElementById('lightbox');
  const img = el.querySelector('.lb__img');
  const empty = el.querySelector('.lb__empty');
  const cap = el.querySelector('.lb__cap');
  const count = el.querySelector('.lb__count');
  const prev = el.querySelector('[data-lb-prev]');
  const next = el.querySelector('[data-lb-next]');
  const stage = el.querySelector('.lb__stage');
  let items = [], i = 0, returnTo = null;

  img.addEventListener('error', () => { if (img.getAttribute('src')) { img.hidden = true; empty.hidden = false; } });

  function show(n, dir) {
    i = Math.max(0, Math.min(items.length - 1, n));
    const it = items[i];
    img.hidden = false;
    empty.hidden = true;
    img.alt = it.alt;
    img.src = it.src;
    cap.textContent = it.caption;
    // пустая подпись всё равно занимает место — картинка остаётся по центру
    count.textContent = items.length > 1 ? `${i + 1} / ${items.length}` : '';
    prev.hidden = next.hidden = items.length < 2;
    prev.disabled = i === 0;
    next.disabled = i === items.length - 1;
    img.classList.remove('from-left', 'from-right');
    if (dir) { void img.offsetWidth; img.classList.add(dir > 0 ? 'from-right' : 'from-left'); }
    [items[i + 1], items[i - 1]].forEach((x) => { if (x) new Image().src = x.src; });
  }

  function step(d) {
    if (i + d >= 0 && i + d < items.length) show(i + d, d);
  }

  function open(list, start) {
    items = list;
    returnTo = document.activeElement;
    show(start, 0);
    document.documentElement.classList.add('lb-open');
    el.showModal();
  }

  el.addEventListener('close', () => {
    document.documentElement.classList.remove('lb-open');
    img.removeAttribute('src');
    if (returnTo && returnTo.focus) returnTo.focus();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  });
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  el.querySelector('[data-lb-close]').addEventListener('click', () => el.close());

  // клик по пустому месту закрывает, свайп листает
  let sx = 0, sy = 0, swiped = false;
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; swiped = false; });
  stage.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { swiped = true; step(dx < 0 ? 1 : -1); }
  });
  stage.addEventListener('click', (e) => {
    if (!swiped && (e.target === stage || e.target === empty)) el.close();
  });

  return { open };
})();

function openLightbox(items, start) {
  lb.open(items, start);
}

/* ---------- шапка и подвал ---------- */

async function renderChrome() {
  const site = await load('site');
  const s = site.data || {};
  if (s.name) document.querySelectorAll('[data-site-name]').forEach((el) => { el.textContent = s.name; });

  const socials = list(s.socials).map((x) => ({ ...x, url: safeUrl(x.url) })).filter((x) => x.url);
  const channel = safeUrl(s.channel);
  if (channel) socials.unshift({ title: s.channelLabel || 'Канал', url: channel });
  document.getElementById('socials').replaceChildren(
    ...socials.map((x) => h('li', null, h('a', { href: x.url, ...linkAttrs(x.url) }, x.title)))
  );
}

/* ---------- роутер ---------- */

let routeToken = 0;
let firstRoute = true;

async function route() {
  const token = ++routeToken;
  const [page = '', sub = ''] = location.hash.replace(/^#\/?/, '').split('/').map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });

  document.querySelectorAll('[data-route]').forEach((a) => {
    if (a.dataset.route === (page || 'home')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  let view;
  if (page === 'games') view = await viewList('games', sub);
  else if (page === 'links') view = await viewList('links', sub);
  else if (page === 'gallery' && sub) view = await viewCategory(sub);
  else if (page === 'gallery') view = await viewGallery();
  else view = await viewHome();

  if (token !== routeToken) return; // пока грузилось, пользователь ушёл на другую страницу
  app.replaceChildren(...[view].flat(Infinity).filter(Boolean));

  const name = (await load('site')).data?.name || 'Ame Tanami';
  const heading = app.querySelector('h1');
  document.title = page && heading ? `${heading.textContent.replace('✦', '').trim()} — ${name}` : `${name} — библиотека творчества`;

  if (!firstRoute) {
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (heading) heading.focus({ preventScroll: true });
  }
  firstRoute = false;
}

document.querySelector('[data-skip]').addEventListener('click', (e) => {
  e.preventDefault();
  app.focus();
});

window.addEventListener('hashchange', route);
renderChrome();
route();
