/* Prototype helper: icons, bilingual text, and the theme / direction / language toggles.
   <i data-i="search"></i>                  -> inline lucide-style SVG
   <x-t ur="ورک اسپیس" en="Workspace"></x-t> -> text in the active language
   Not shipped code; the real app keeps using lucide-react + src/locales. */
(function () {
  var P = {
    menu: 'M4 6h16M4 12h16M4 18h16', search: ['c11,11,8', 'M21 21l-4.3-4.3'], plus: 'M5 12h14M12 5v14',
    'chev-l': 'M15 18l-6-6 6-6', 'chev-r': 'M9 18l6-6-6-6', 'chev-d': 'M6 9l6 6 6-6', x: 'M18 6L6 18M6 6l12 12',
    more: ['c12,12,1', 'c19,12,1', 'c5,12,1'], book: 'M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
    file: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8',
    sliders: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4',
    mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
    volume: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
    scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h8M7 12h10M7 16h6',
    lang: 'M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6',
    spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16v4M17 18h4',
    shield: 'M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4',
    user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'c12,7,4'], dash: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
    cloud: 'M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z', key: ['M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3', 'c7.5,15.5,5.5'],
    check: 'M20 6L9 17l-5-5', warn: 'M21.7 18l-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3zM12 9v4M12 17h.01',
    wifioff: 'M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-10-3.8M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-1.9-1.5M2 2l20 20',
    eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'c12,12,3'], download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    panel: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 3v18'],
    pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
    bot: ['M12 8V4H8M2 14h2M20 14h2M15 13v2M9 13v2', 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z'],
    globe: ['M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z', 'c12,12,10'],
    moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z', sun: ['M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4', 'c12,12,4'],
    home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10', folder: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z',
    clock: ['M12 6v6l4 2', 'c12,12,10'], disk: 'M22 12H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16h.01M10 16h.01',
    refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
    copy: ['M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2', 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z'],
    lock: ['M7 11V7a5 5 0 0 1 10 0v4', 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z'],
    trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', info: ['M12 16v-4M12 8h.01', 'c12,12,10'],
    arrow: 'M5 12h14M12 5l7 7-7 7', graph: 'M12 12V8M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M16 16h6v6h-6zM2 16h6v6H2zM9 2h6v6H9z',
    tasks: 'M3 17l2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8', bold: 'M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z', italic: 'M19 4h-9M14 20H5M15 4L9 20',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', quote: 'M3 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h4M15 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h4',
    undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13', play: 'M6 3l14 9-14 9z', pause: 'M6 4h4v16H6zM14 4h4v16h-4z', link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
    cmd: 'M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3', star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
    image: ['M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21M9 8.5h.01', 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'],
    tablet: 'M12 18h.01M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', monitor: 'M8 21h8M12 17v4M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9', help: ['M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01', 'c12,12,10'], bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
    heart: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z',
    bolt: 'M13 2L3 14h9l-1 8 10-12h-9z', sidebar: 'M4 6h16M4 12h10M4 18h16', filter: 'M22 3H2l8 9.46V19l4 2v-8.54z'
  };
  function build(name) {
    var d = P[name]; if (!d) return '';
    if (!Array.isArray(d)) d = [d];
    return d.map(function (s) {
      var m = /^c(-?[\d.]+),(-?[\d.]+),([\d.]+)$/.exec(s);
      return m ? '<circle cx="' + m[1] + '" cy="' + m[2] + '" r="' + m[3] + '"/>' : '<path d="' + s + '"/>';
    }).join('');
  }
  function icons(root) {
    (root || document).querySelectorAll('i[data-i]').forEach(function (el) {
      var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i ' + (el.getAttribute('class') || ''));
      s.setAttribute('aria-hidden', 'true'); s.innerHTML = build(el.getAttribute('data-i'));
      var sz = el.getAttribute('data-s'); if (sz) { s.style.fontSize = sz + 'px'; }
      if (el.hasAttribute('data-flip')) s.classList.add('flip');
      el.replaceWith(s);
    });
  }
  function texts() {
    var lang = document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ur';
    document.querySelectorAll('x-t').forEach(function (el) { el.textContent = el.getAttribute(lang) || el.getAttribute('ur') || ''; });
    document.querySelectorAll('[data-ph-ur]').forEach(function (el) { el.setAttribute('placeholder', el.getAttribute(lang === 'en' ? 'data-ph-en' : 'data-ph-ur')); });
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} }
  function apply() {
    var h = document.documentElement;
    h.setAttribute('data-theme', store('ee-theme') || 'light');
    var lang = store('ee-lang') || 'ur';
    h.setAttribute('lang', lang); h.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
    texts();
  }
  function head() {
    var t = document.body.getAttribute('data-title'); if (!t) return;
    var el = document.createElement('header'); el.className = 'stage-head';
    el.innerHTML = '<a class="back" href="index.html">←</a><h1></h1><span class="note"></span>' +
      '<div class="segmented" role="group" aria-label="theme"><button class="seg" data-act="light">Light</button><button class="seg" data-act="dark">Dark</button></div>' +
      '<div class="segmented" role="group" aria-label="language"><button class="seg" data-act="ur">اردو RTL</button><button class="seg" data-act="en">English LTR</button></div>';
    el.querySelector('h1').textContent = t; el.querySelector('.note').textContent = document.body.getAttribute('data-note') || '';
    el.querySelectorAll('.seg').forEach(function (b) { b.style.cssText = 'border:0;background:none;font:inherit;padding:6px 12px;border-radius:9px;font-size:13px;font-weight:500;cursor:pointer;color:inherit;'; });
    document.body.prepend(el);
    function mark() {
      var th = document.documentElement.getAttribute('data-theme'), lg = document.documentElement.getAttribute('lang');
      el.querySelectorAll('.seg').forEach(function (b) { var a = b.getAttribute('data-act'); var on = a === th || a === lg; b.style.background = on ? 'hsl(var(--card))' : 'none'; b.style.boxShadow = on ? 'var(--shadow-sm)' : 'none'; b.style.color = on ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))'; });
    }
    el.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-act'); if (!a) return;
      if (a === 'light' || a === 'dark') store('ee-theme', a); else store('ee-lang', a);
      apply(); mark();
    });
    mark();
  }
  function fonts() {
    var l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;500;600;700&family=Noto+Nastaliq+Urdu:wght@400;500;600&family=Lora:wght@400;600&display=swap';
    document.head.appendChild(l);
  }
  document.addEventListener('DOMContentLoaded', function () { fonts(); apply(); head(); icons(); });
})();
