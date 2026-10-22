/* v3 prototype partials. Runs before kit.js renders icons and text (kit waits for DOMContentLoaded).
   <aside data-side="home|chat|doc|files|me" data-folder></aside>  -> desktop sidebar
   <nav data-tabs="home|files"></nav>                             -> mobile tab bar (2 tabs + centred plus)
   <span data-av data-dot></span>                                  -> top-bar avatar that opens "Me"
   <div data-sb></div>                                             -> phone status bar
   <div data-tb="desk|web" data-t="title"></div>                   -> window chrome */
(function () {
  function T(ur, en) { return '<x-t ur="' + ur + '" en="' + en + '"></x-t>'; }
  var recent = [
    ['chat', 'ic-c', 'زکوٰۃ کے نصاب کا سوال', 'Question on zakat nisab', 'chat'],
    ['file', 'ic-c', 'مسئلہ اباحت — مسودہ', 'Default ruling — draft', 'doc'],
    ['mic', 'ic-a', 'بیان 12 ربیع الاول', 'Lecture, 12 Rabi al-Awwal', 'ext'],
    ['lang', 'ic-t', 'فتاویٰ جلد 2 — ترجمہ', 'Fatawa vol. 2 — translation', 'tr']
  ];
  function side(active, folder) {
    var r = recent.map(function (x, i) {
      var on = (active === 'chat' && i === 0) || (active === 'doc' && i === 1);
      return '<a class="ritem' + (on ? ' on' : '') + '"><i data-i="' + x[0] + '"></i><span class="t">' + T(x[2], x[3]) + '</span></a>';
    }).join('');
    return '<div class="head"><span class="logo">ع</span><b>Easy Editor</b><span class="grow"></span><button class="icon-btn sm"><i data-i="search"></i></button></div>' +
      '<button class="newbtn"><i data-i="plus"></i>' + T('نیا', 'New') + '<span class="kbd">Ctrl N</span></button>' +
      '<a class="ritem' + (active === 'home' ? ' on' : '') + '"><i data-i="home"></i><span class="t">' + T('ہوم', 'Home') + '</span></a>' +
      '<a class="ritem' + (active === 'files' ? ' on' : '') + '"><i data-i="folder"></i><span class="t">' + T('فائلیں', 'Files') + '</span></a>' +
      '<div class="slabel">' + T('حالیہ', 'RECENT') + '</div>' + r +
      '<div class="slabel">' + T('فولڈر', 'FOLDERS') + '<i data-i="plus" data-s="14"></i></div>' +
      '<a class="ritem' + (folder ? ' on' : '') + '"><i data-i="folder"></i><span class="t">' + T('زکوٰۃ کے فتاویٰ', 'Zakat fatwas') + '</span><span class="d">12</span></a>' +
      '<a class="ritem"><i data-i="folder"></i><span class="t">' + T('مسئلہ اباحت', 'Default ruling') + '</span><span class="d">5</span></a>' +
      '<span class="grow"></span>' +
      '<div class="jobs"><div class="row between xs"><b>' + T('جاری کام', 'Running') + '</b><span class="chip info">2</span></div>' +
      '<div class="job"><i data-i="lang" data-s="14"></i><span>' + T('ترجمہ', 'Translation') + '</span><span class="bar"><i style="inline-size:38%"></i></span><span class="mono">38%</span></div>' +
      '<div class="job"><i data-i="mic" data-s="14"></i><span>' + T('ٹرانسکرائب', 'Transcribe') + '</span><span class="bar"><i style="inline-size:72%"></i></span><span class="mono">72%</span></div></div>' +
      '<div class="me-row' + (active === 'me' ? ' on' : '') + '"><span class="avatar">ح</span><div class="col grow" style="--g:0"><b class="sm">حافظ خلیل</b><span class="xs muted">' + T('پرو', 'Pro') + '</span></div><button class="icon-btn sm" style="position:relative"><i data-i="bell"></i></button></div>';
  }
  function tabs(active) {
    function a(k, i, ur, en) { return '<a class="' + (active === k ? 'on' : '') + '"><i data-i="' + i + '"></i>' + T(ur, en) + '</a>'; }
    // Option 1 (approved): two tabs with the plus exactly centred; "Me" is the top-bar avatar.
    return a('home', 'chat', 'چیٹ/لکھیں', 'Chat/Write') + '<span class="plus"><i data-i="plus"></i></span>' + a('files', 'folder', 'فائلیں', 'Files');
  }
  document.querySelectorAll('[data-side]').forEach(function (el) { el.classList.add('side'); el.innerHTML = side(el.getAttribute('data-side'), el.hasAttribute('data-folder')); });
  document.querySelectorAll('[data-tabs]').forEach(function (el) { el.classList.add('tabbar'); el.innerHTML = tabs(el.getAttribute('data-tabs')); });
  document.querySelectorAll('[data-av]').forEach(function (el) { el.className = 'av'; el.innerHTML = '<span class="avatar">ح</span>' + (el.hasAttribute('data-dot') ? '<span class="dotn"></span>' : ''); });
  document.querySelectorAll('[data-sb]').forEach(function (el) { el.className = 'statusbar'; el.innerHTML = '<span>9:41</span><span>●●●● 100%</span>'; });
  document.querySelectorAll('[data-tb]').forEach(function (el) {
    var web = el.getAttribute('data-tb') === 'web', t = el.getAttribute('data-t') || 'Al-Ulama Easy Editor';
    el.className = 'titlebar';
    el.innerHTML = '<div class="dots"><i></i><i></i><i></i></div>' + (web ? '<div class="urlbar"><i data-i="lock" data-s="12"></i>' + t + '</div>' : '<span class="grow" style="text-align:center">' + t + '</span><span class="chip neutral"><i data-i="disk"></i>' + T('مقامی', 'Local') + '</span>');
  });
})();
