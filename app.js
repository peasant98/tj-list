// TJ's Run — family Trader Joe's list. Vanilla JS + IndexedDB, no build step.
'use strict';

// ---------- tiny IndexedDB layer ----------
var DB_NAME = 'tjlist', STORE = 'items', db = null;

function openDB() {
  return new Promise(function (res, rej) {
    var rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE, { keyPath: 'id' }); };
    rq.onsuccess = function () { res(rq.result); };
    rq.onerror = function () { rej(rq.error); };
  });
}
function tx(mode) { return db.transaction(STORE, mode).objectStore(STORE); }
function dbAll() {
  return new Promise(function (res, rej) {
    var rq = tx('readonly').getAll();
    rq.onsuccess = function () { res(rq.result); };
    rq.onerror = function () { rej(rq.error); };
  });
}
function dbPut(item) {
  return new Promise(function (res, rej) {
    var rq = tx('readwrite').put(item);
    rq.onsuccess = function () { res(); };
    rq.onerror = function () { rej(rq.error); };
  });
}
function dbDel(id) {
  return new Promise(function (res, rej) {
    var rq = tx('readwrite').delete(id);
    rq.onsuccess = function () { res(); };
    rq.onerror = function () { rej(rq.error); };
  });
}
function dbClear() {
  return new Promise(function (res, rej) {
    var rq = tx('readwrite').clear();
    rq.onsuccess = function () { res(); };
    rq.onerror = function () { rej(rq.error); };
  });
}

// ---------- state ----------
var items = [];
var photoURLs = {};            // id -> objectURL (revoked on removal)
var pendingPhoto = null;       // Blob chosen in the add form
var qtyValue = 1;

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function urlFor(item) {
  if (!item.photo) return null;
  if (!photoURLs[item.id]) photoURLs[item.id] = URL.createObjectURL(item.photo);
  return photoURLs[item.id];
}
function dropURL(id) {
  if (photoURLs[id]) { URL.revokeObjectURL(photoURLs[id]); delete photoURLs[id]; }
}

// ---------- photo shrink (max 512px JPEG) ----------
function shrinkPhoto(file) {
  return createImageBitmap(file).then(function (bmp) {
    var s = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
    var c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.82); });
  });
}

// ---------- render ----------
var $ = function (id) { return document.getElementById(id); };

function cardHTML(item, i) {
  var thumb;
  if (item.photo) {
    thumb = '<div class="thumbWrap" data-zoom="' + item.id + '"><img alt="" src="' + urlFor(item) + '"></div>';
  } else {
    thumb = '<div class="thumbWrap noPhoto">🛍️</div>';
  }
  return '<div class="card' + (item.done ? ' isDone' : '') + '" style="--i:' + i + '" data-id="' + item.id + '">' +
    thumb +
    '<div class="cardBody">' +
      '<div class="cardName"></div>' +
      '<div class="cardQty">' +
        '<button class="qbtn small" data-act="minus" aria-label="less">−</button>' +
        '<span class="qtyBadge">' + item.qty + '</span>' +
        '<button class="qbtn small" data-act="plus" aria-label="more">+</button>' +
      '</div>' +
    '</div>' +
    (item.done ? '<span class="stamp">got it!</span>' : '') +
    '<button class="checkBtn" data-act="toggle" aria-label="check off">✓</button>' +
    '<button class="delBtn" data-act="del" aria-label="remove">✕</button>' +
  '</div>';
}

function render() {
  var todo = items.filter(function (x) { return !x.done; });
  var done = items.filter(function (x) { return x.done; });

  $('todoCards').innerHTML = todo.map(cardHTML).join('');
  $('doneCards').innerHTML = done.map(cardHTML).join('');

  // names via textContent (no HTML injection from item names)
  var all = todo.concat(done);
  document.querySelectorAll('.card').forEach(function (el) {
    var item = all.find(function (x) { return x.id === el.dataset.id; });
    if (item) el.querySelector('.cardName').textContent = item.name;
  });

  $('todoEmpty').hidden = todo.length > 0;
  $('doneEmpty').hidden = done.length > 0;
  $('clearBtn').hidden = done.length === 0;
  $('counts').innerHTML = '<b>' + todo.length + '</b> to find · <b class="cartN">' + done.length + '</b> in the cart';
}

// ---------- actions ----------
function addItem(name, qty, photoBlob) {
  var item = { id: uid(), name: name, qty: qty, done: false, ts: Date.now(), photo: photoBlob || null };
  items.push(item);
  return dbPut(item).then(render);
}
function findItem(id) { return items.find(function (x) { return x.id === id; }); }

function toggleItem(id) {
  var it = findItem(id); if (!it) return Promise.resolve();
  it.done = !it.done;
  return dbPut(it).then(render);
}
function bumpQty(id, d) {
  var it = findItem(id); if (!it) return Promise.resolve();
  it.qty = Math.max(1, Math.min(99, it.qty + d));
  return dbPut(it).then(render);
}
function removeItem(id) {
  items = items.filter(function (x) { return x.id !== id; });
  dropURL(id);
  return dbDel(id).then(render);
}
function clearDone() {
  var gone = items.filter(function (x) { return x.done; });
  items = items.filter(function (x) { return !x.done; });
  return Promise.all(gone.map(function (x) { dropURL(x.id); return dbDel(x.id); })).then(render);
}

// ---------- wire up ----------
function resetForm() {
  $('addForm').reset();
  pendingPhoto = null;
  qtyValue = 1;
  $('qtyVal').textContent = '1';
  $('photoPick').innerHTML = '<input type="file" id="photoInput" accept="image/*">' +
    '<span class="photoPickInner">📷<em>photo</em></span>';
  wirePhotoInput();
}

function wirePhotoInput() {
  $('photoPick').querySelector('input').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    shrinkPhoto(f).then(function (blob) {
      pendingPhoto = blob;
      var img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      var pick = $('photoPick');
      var input = pick.querySelector('input');
      pick.innerHTML = '';
      pick.appendChild(input);
      pick.appendChild(img);
    });
  });
}

function init() {
  $('qtyMinus').addEventListener('click', function () {
    qtyValue = Math.max(1, qtyValue - 1); $('qtyVal').textContent = qtyValue;
  });
  $('qtyPlus').addEventListener('click', function () {
    qtyValue = Math.min(99, qtyValue + 1); $('qtyVal').textContent = qtyValue;
  });
  wirePhotoInput();

  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('nameInput').value.trim();
    if (!name) return;
    addItem(name, qtyValue, pendingPhoto).then(resetForm);
  });

  document.body.addEventListener('click', function (e) {
    var zoom = e.target.closest('[data-zoom]');
    if (zoom) {
      var it = findItem(zoom.dataset.zoom);
      if (it && it.photo) {
        $('lightImg').src = urlFor(it);
        $('lightName').textContent = it.qty + ' × ' + it.name;
        $('lightbox').hidden = false;
      }
      return;
    }
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var card = btn.closest('.card'); if (!card) return;
    var id = card.dataset.id;
    if (btn.dataset.act === 'toggle') toggleItem(id);
    else if (btn.dataset.act === 'plus') bumpQty(id, 1);
    else if (btn.dataset.act === 'minus') bumpQty(id, -1);
    else if (btn.dataset.act === 'del') removeItem(id);
  });

  $('lightbox').addEventListener('click', function () { $('lightbox').hidden = true; });
  $('clearBtn').addEventListener('click', clearDone);

  $('shareBtn').addEventListener('click', function () {
    var todo = items.filter(function (x) { return !x.done; });
    var text = 'TJ Run 🛒\n' + (todo.length
      ? todo.map(function (x) { return '• ' + x.qty + '× ' + x.name; }).join('\n')
      : '(all done!)');
    if (navigator.share) navigator.share({ text: text }).catch(function () {});
    else navigator.clipboard.writeText(text).then(function () {
      $('shareBtn').textContent = '📋 copied!';
      setTimeout(function () { $('shareBtn').textContent = '📤 share the list'; }, 1600);
    });
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
}

// ---------- demo seed & selftest (dev hooks, hash-gated) ----------
function demoBlob(label, color) {
  var c = document.createElement('canvas'); c.width = c.height = 256;
  var g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.beginPath(); g.arc(128, 118, 78, 0, 7); g.fill();
  g.fillStyle = '#2c2420'; g.font = '900 90px Karla, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 128, 122);
  return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.85); });
}

function seedDemo() {
  var rows = [
    ['Mandarin Orange Chicken', 2, '#e8862c', 'O', false],
    ['Everything Bagel Seasoning', 1, '#c8a24a', 'E', false],
    ['Unexpected Cheddar', 1, '#e6c33c', 'C', false],
    ['Dark Chocolate PB Cups', 3, '#7a4a2b', 'P', false],
    ['Cauliflower Gnocchi', 2, '#9db86e', 'G', true],
    ['Cold Brew Concentrate', 1, '#4a3325', 'B', true]
  ];
  return dbClear().then(function () {
    items = []; Object.keys(photoURLs).forEach(dropURL);
    return rows.reduce(function (p, r, i) {
      return p.then(function () {
        var mk = (i === 1 || i === 5) ? Promise.resolve(null) : demoBlob(r[3], r[2]); // a couple without photos
        return mk.then(function (blob) {
          var it = { id: 'demo' + i, name: r[0], qty: r[1], done: r[4], ts: Date.now() + i, photo: blob };
          items.push(it);
          return dbPut(it);
        });
      });
    }, Promise.resolve());
  }).then(render);
}

function selftest() {
  var out = [], t0 = performance.now();
  function ok(name, cond) { out.push((cond ? 'PASS' : 'FAIL') + ' ' + name); }
  return dbClear().then(function () { items = []; return demoBlob('T', '#c8102e'); })
    .then(function (blob) { return addItem('Test Chicken', 2, blob); })
    .then(function () { return addItem('Test Bagel', 1, null); })
    .then(function () {
      ok('add 2 items', items.length === 2);
      ok('photo stored as blob', items[0].photo instanceof Blob && items[0].photo.size > 500);
      return toggleItem(items[0].id);
    })
    .then(function () {
      ok('toggle done', items[0].done === true);
      return bumpQty(items[1].id, 1);
    })
    .then(function () {
      ok('qty bump', items[1].qty === 2);
      return dbAll();
    })
    .then(function (rows) {
      ok('persisted 2 rows', rows.length === 2);
      var stored = rows.find(function (r) { return r.name === 'Test Chicken'; });
      ok('blob persisted in idb', stored && stored.photo instanceof Blob);
      return removeItem(items[1].id);
    })
    .then(function () { return dbAll(); })
    .then(function (rows) {
      ok('delete persisted', rows.length === 1 && items.length === 1);
      var pass = out.every(function (l) { return l.indexOf('PASS') === 0; });
      out.push((pass ? 'SELFTEST PASS' : 'SELFTEST FAIL') + ' in ' + Math.round(performance.now() - t0) + 'ms');
      document.title = pass ? 'SELFTEST PASS' : 'SELFTEST FAIL';
      var pre = $('testOut'); pre.hidden = false; pre.textContent = out.join('\n');
      beacon({ selftest: pass ? 'PASS' : 'FAIL', lines: out });
    })
    .catch(function (err) {
      document.title = 'SELFTEST FAIL';
      var pre = $('testOut'); pre.hidden = false; pre.textContent = out.join('\n') + '\nERR ' + err;
      beacon({ selftest: 'FAIL', lines: out, err: String(err) });
    });
}

// dev: beacon results to the test receiver (minecraft/test-recv.js on :8001)
function beacon(o) {
  try {
    fetch('http://localhost:8001/?r=' + encodeURIComponent(JSON.stringify(o)), { mode: 'no-cors' })
      .catch(function () {});
  } catch (e) {}
}

// ---------- boot ----------
openDB().then(function (d) {
  db = d;
  return dbAll();
}).then(function (rows) {
  items = rows.sort(function (a, b) { return a.ts - b.ts; });
  if (location.hash.indexOf('still') >= 0) document.documentElement.classList.add('noAnim');
  init();
  render();
  if (location.hash.indexOf('demo') >= 0) return seedDemo();
  if (location.hash.indexOf('selftest') >= 0) return selftest();
});
