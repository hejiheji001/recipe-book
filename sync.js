/* 菜谱网站同步层：页面口令 → 小区口令 → SHA-256 派生 family → Supabase
 *
 * 设计要点
 *   - 页面口令只挡界面；真正的数据访问靠服务端校验小区口令（families 表 + bcrypt）
 *   - family = SHA-256(base|小区口令) 前 32 位，网页里只有 base，完整 family 不落源码
 *   - localStorage 是唯一真实数据源；云端挂了页面照常能用
 *   - 首次开通（云端全空 + 本地有数据）才允许把本地推上去
 */
(function () {
  'use strict';

  var BASE = 'LuY62vdp5T0VYj3WmjldwANnvDKq5tC3';
  var API = 'https://brxlbwgyxcrilraxlbvt.supabase.co/rest/v1/rpc';
  var KEY = 'sb_publishable_n4_Ik7gMKPEpZgpGX_s2_Q_kS9jp3hH';

  var PAGE_PW = '12250504';

  var NBS = [
    { id: 'queenroad', name: '皇后道' },
    { id: 'jianshang', name: '简上村' },
    { id: 'yongyi', name: '雍颐湾' },
    { id: 'tianyue', name: '天樾府' },
    { id: 'haorizi', name: '好日子' },
    { id: 'birmingham', name: '伯明翰' },
    { id: 'yulin', name: '裕林花园' }
  ];
  var DEFAULT_NB = 'queenroad';

  var DOCS = [
    { key: 'rb_stock', suffix: '_stock', wrap: false, week: false },
    { key: 'rb_lists', suffix: '_orders', wrap: true, week: false },
    { key: 'rb_prints', suffix: '_prints', wrap: true, week: false },
    { key: 'rb_shop', suffix: '_shop-fresh', wrap: false, week: true }
  ];

  var GATE_KEY = 'rb_gate';
  var FAM_KEY = 'rb_family';
  var REV_KEY = 'rb_rev';
  var DELAY = 700;

  function ls(k, d) {
    try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }
    catch (e) { return d; }
  }
  function lss(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf),
      function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function deriveFamily(nbId, pw) {
    if (!window.crypto || !window.crypto.subtle) return Promise.resolve(null);
    var data = new TextEncoder().encode(BASE + '|' + nbId + '|' + pw);
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      return hex(buf).slice(0, 32);
    });
  }

  function call(fn, body) {
    return fetch(API + '/' + fn, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (t) {
        var j = {};
        try { j = t ? JSON.parse(t) : {}; } catch (e) {}
        return { ok: res.ok, status: res.status, body: j };
      });
    });
  }

  function weekCode() {
    var el = document.querySelector('meta[name="rb-week"]');
    return el ? el.getAttribute('content') : '';
  }

  function readLocal(doc) {
    if (doc.week) {
      var wk = weekCode();
      return wk ? ls('rb_shop_' + wk, {}) : {};
    }
    return ls(doc.key, doc.wrap ? [] : null);
  }

  function writeLocal(doc, data) {
    if (doc.week) {
      var wk = weekCode();
      if (wk) lss('rb_shop_' + wk, data || {});
      return;
    }
    lss(doc.key, data);
  }

  function pack(doc, local) {
    if (doc.week) return { v: 1, week: weekCode(), items: local || {} };
    if (doc.wrap) return { v: 1, list: Array.isArray(local) ? local : [] };
    return local && typeof local === 'object' ? local : { v: 1, items: {} };
  }

  function unpack(doc, items) {
    if (!items) return null;
    if (doc.week) {
      if (items.week && weekCode() && items.week !== weekCode()) return {};
      return items.items || {};
    }
    if (doc.wrap) return Array.isArray(items.list) ? items.list : null;
    return items;
  }

  function localHas(doc) {
    var v = readLocal(doc);
    if (doc.week) return !!(v && Object.keys(v).length);
    if (doc.wrap) return !!(v && v.length);
    return !!(v && v.items && Object.keys(v.items).length);
  }

  function pull(pw, fam) {
    var revs = {};
    var need = [];

    return Promise.all(DOCS.map(function (doc) {
      return call('get_stock', { p_family: fam + doc.suffix, p_token: pw })
        .then(function (r) { return { doc: doc, r: r }; });
    })).then(function (rows) {
      rows.forEach(function (x) {
        var doc = x.doc;

        if (x.r.body.code === 'PT404') {
          need.push(doc);
          return;
        }
        if (!x.r.ok) return;

        revs[doc.suffix] = x.r.body.rev || 0;

        if (x.r.body.rev > 0) {
          var val = unpack(doc, x.r.body.items);
          if (val !== null) writeLocal(doc, val);
        } else if (localHas(doc)) {
          need.push(doc);
        }
      });
      lss(REV_KEY, revs);
      return { revs: revs, need: need };
    });
  }

  function bootstrap(pw, fam, docs) {
    var jobs = (docs || []).map(function (doc) {
      return call('put_stock', {
        p_family: fam + doc.suffix,
        p_items: pack(doc, readLocal(doc)),
        p_rev: 0,
        p_token: pw
      }).then(function (r) {
        if (r.ok) {
          var revs = ls(REV_KEY, {});
          revs[doc.suffix] = r.body.rev;
          lss(REV_KEY, revs);
        }
        return r.ok ? 1 : 0;
      });
    });
    return Promise.all(jobs).then(function (rs) {
      return rs.filter(Boolean).length;
    });
  }

  function push(pw, fam, doc) {
    var local = readLocal(doc);
    var revs = ls(REV_KEY, {});
    var rev = revs[doc.suffix] || 0;

    return call('put_stock', {
      p_family: fam + doc.suffix,
      p_items: pack(doc, local),
      p_rev: rev,
      p_token: pw
    }).then(function (r) {
      if (r.ok) {
        revs[doc.suffix] = r.body.rev;
        lss(REV_KEY, revs);
        return 'ok';
      }
      if (r.status === 409) {
        return call('get_stock', { p_family: fam + doc.suffix, p_token: pw })
          .then(function (g) {
            if (!g.ok) return 'fail';
            revs[doc.suffix] = g.body.rev || 0;
            lss(REV_KEY, revs);
            return call('put_stock', {
              p_family: fam + doc.suffix,
              p_items: pack(doc, local),
              p_rev: g.body.rev,
              p_token: pw
            }).then(function (r2) {
              if (r2.ok) { revs[doc.suffix] = r2.body.rev; lss(REV_KEY, revs); return 'ok'; }
              return 'fail';
            });
          });
      }
      return 'fail';
    });
  }

  var syncState = { pw: null, fam: null, timer: null, busy: false, again: false };

  function schedule(docKey) {
    if (!syncState.fam || !syncState.pw) return;
    var doc = DOCS.filter(function (d) { return d.key === docKey; })[0];
    if (!doc) return;

    if (syncState.busy) {
      syncState.again = true;
      clearTimeout(syncState.timer);
      syncState.timer = setTimeout(function () { schedule(docKey); }, DELAY);
      return;
    }

    clearTimeout(syncState.timer);
    syncState.timer = setTimeout(function () {
      syncState.busy = true;
      paint('doing');
      push(syncState.pw, syncState.fam, doc).then(function (res) {
        syncState.busy = false;
        paint(res === 'ok' ? 'ok' : 'off');
        if (syncState.again) {
          syncState.again = false;
          schedule(docKey);
        }
      });
    }, DELAY);
  }

  var dot = null;
  function paint(tone) {
    if (!dot) return;
    var fam = ls(FAM_KEY, null);
    if (!fam) { dot.style.display = 'none'; return; }
    dot.style.display = 'inline-block';
    var map = { ok: ['#2f7a45', '已同步'], doing: ['#d99b3d', '同步中'], off: ['#b8b8b2', '本地'] };
    var t = map[tone] || (syncState.fam ? ['#b8b8b2', '本地'] : ['#b8b8b2', '本地']);
    dot.style.background = t[0];
    dot.title = fam.name + ' · ' + t[1];
  }

  function css() {
    var s = document.createElement('style');
    s.textContent = [
      '#rbg{position:fixed;inset:0;z-index:9999;background:#faf9f6;display:none;',
      'flex-direction:column;padding:0 22px;box-sizing:border-box;overflow-y:auto;}',
      '#rbg.on{display:flex;}',
      'body.rb-lock{overflow:hidden;}',
      '#rbg .g-in{max-width:420px;margin:auto;width:100%;padding:40px 0;}',
      '#rbg h1{font-size:22px;margin:0 0 6px;font-weight:800;letter-spacing:.5px;}',
      '#rbg .g-sub{font-size:13px;color:#9a9a95;margin:0 0 22px;line-height:1.6;}',
      '#rbg label{display:block;font-size:12px;font-weight:700;color:#8a8a85;',
      'margin:14px 0 6px;letter-spacing:.5px;}',
      '#rbg input{width:100%;box-sizing:border-box;font-family:inherit;font-size:16px;',
      'padding:12px 13px;border:1px solid #dedeD8;border-radius:10px;background:#fff;',
      'color:#111;-webkit-appearance:none;}',
      '#rbg input:focus{outline:none;border-color:#111;}',
      '#rbg .g-btn{width:100%;margin-top:20px;font-family:inherit;font-size:16px;',
      'font-weight:700;padding:14px;border-radius:11px;border:none;background:#111;',
      'color:#fff;-webkit-tap-highlight-color:transparent;}',
      '#rbg .g-btn[disabled]{opacity:.45;}',
      '#rbg .g-err{font-size:12.5px;color:#c0392b;margin-top:10px;min-height:18px;}',
      '#rbg .g-nb{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;}',
      '#rbg .g-nb b{font-size:13.5px;font-weight:600;padding:9px 14px;border-radius:9px;',
      'border:1px solid #e0e0dc;background:#fff;color:#555;cursor:pointer;',
      'font-family:inherit;-webkit-tap-highlight-color:transparent;}',
      '#rbg .g-nb b.on{background:#111;color:#fff;border-color:#111;}',
      '#rbg .g-foot{font-size:11.5px;color:#c0c0bc;margin-top:26px;line-height:1.7;}',
      '#rbd{display:none;width:7px;height:7px;border-radius:50%;margin-left:7px;',
      'background:#b8b8b2;vertical-align:middle;cursor:pointer;}',
      '#rbsheet{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.4);',
      'display:none;align-items:flex-end;}',
      '#rbsheet.on{display:flex;}',
      '#rbsheet .s-card{background:#fff;width:100%;box-sizing:border-box;',
      'border-radius:16px 16px 0 0;padding:20px 22px calc(24px + env(safe-area-inset-bottom));}',
      '#rbsheet h1{font-size:19px;margin:0 0 4px;font-weight:800;}',
      '#rbsheet .g-sub{margin:0 0 4px;}',
      '#rbsheet input{background:#f7f7f4;text-align:center;letter-spacing:1px;}',
      '#rbsheet .g-btn{margin-top:10px;}',
      '#rbsheet .g-ghost{background:#f2f2ee;color:#555;}'
    ].join('');
    document.head.appendChild(s);
  }

  function gate(force) {
    if (!force && ls(GATE_KEY, false)) return false;

    css();
    var g = document.createElement('div');
    g.id = 'rbg';
    g.innerHTML =
      '<div class="g-in">' +
      '<h1>菜谱</h1>' +
      '<p class="g-sub">输入家庭口令进入。</p>' +
      '<label>页面口令</label>' +
      '<input id="rgPass" type="password" inputmode="numeric" autocomplete="off" placeholder="8 位数字">' +
      '<div class="g-err" id="rgErr"></div>' +
      '<button class="g-btn" id="rgGo">进入</button>' +
      '<div class="g-foot">第一次输完会记住这台设备，以后直接进。</div>' +
      '</div>';
    document.body.appendChild(g);
    document.body.classList.add('rb-lock');
    g.classList.add('on');

    var inp = document.getElementById('rgPass');
    var err = document.getElementById('rgErr');
    var btn = document.getElementById('rgGo');

    function go() {
      var v = (inp.value || '').trim();
      if (v !== PAGE_PW) {
        err.textContent = '口令不对';
        inp.value = '';
        return;
      }
      lss(GATE_KEY, true);
      document.body.classList.remove('rb-lock');
      g.remove();
      start();
    }
    btn.onclick = go;
    inp.oninput = function () { err.textContent = ''; };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    setTimeout(function () { inp.focus(); }, 300);
    return true;
  }

  function picker(done) {
    css();
    var fam = ls(FAM_KEY, null);
    var g = document.createElement('div');
    g.id = 'rbg';

    var picked = fam ? fam.id : DEFAULT_NB;
    function rows() {
      return NBS.map(function (n) {
        return '<b data-nb="' + n.id + '"' +
          (n.id === picked ? ' class="on"' : '') + '>' + n.name + '</b>';
      }).join('');
    }

    g.innerHTML =
      '<div class="g-in">' +
      '<h1>哪一家？</h1>' +
      '<p class="g-sub">选自己家，输一次口令，以后这台设备直接进。</p>' +
      '<label>小区</label><div class="g-nb" id="rgNbs">' + rows() + '</div>' +
      '<label>这家的小区口令</label>' +
      '<input id="rgNpw" type="password" autocomplete="off" placeholder="至少 6 位，字母数字混合">' +
      '<div class="g-err" id="rgNerr"></div>' +
      '<button class="g-btn" id="rgNgo">进入</button>' +
      '<div class="g-foot">口令存在这台手机上。换设备要重输一次。</div>' +
      '</div>';
    document.body.appendChild(g);
    document.body.classList.add('rb-lock');
    g.classList.add('on');

    var err = document.getElementById('rgNerr');
    var btn = document.getElementById('rgNgo');

    document.getElementById('rgNbs').onclick = function (e) {
      var b = e.target.closest('[data-nb]');
      if (!b) return;
      picked = b.getAttribute('data-nb');
      [].slice.call(g.querySelectorAll('[data-nb]')).forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      err.textContent = '';
    };

    btn.onclick = function () {
      var pw = (document.getElementById('rgNpw').value || '').trim();
      if (pw.length < 6) { err.textContent = '口令至少 6 位'; return; }
      btn.disabled = true;
      btn.textContent = '连接中…';

      deriveFamily(picked, pw).then(function (famId) {
        if (!famId) { err.textContent = '此浏览器不支持安全计算'; btn.disabled = false; btn.textContent = '进入'; return; }
        var nb = NBS.filter(function (n) { return n.id === picked; })[0] || NBS[0];
        return call('put_family', {
          p_family: famId, p_token: pw, p_label: nb.name
        }).then(function (reg) {
          if (!reg.ok && reg.status !== 200) {
            if (reg.body && reg.body.code === 'PT403') {
              throw new Error('此小区口令不对');
            }
            throw new Error('连接失败');
          }
          return pull(pw, famId);
        }).then(function (info) {
          if (!info.need.length) return 0;
          return bootstrap(pw, famId, info.need).then(function (n) {
            return pull(pw, famId).then(function () { return n; });
          });
        }).then(function (n) {
          lss(FAM_KEY, { id: nb.id, name: nb.name, pw: pw, fam: famId });
          syncState.pw = pw;
          syncState.fam = famId;
          g.classList.remove('on');
          document.body.classList.remove('rb-lock');
          setTimeout(function () { g.remove(); }, 200);
          paint('ok');
          if (done) done(n);
        });
      }).catch(function (e) {
        err.textContent = (e && e.message) || '连不上服务器，请检查网络';
        btn.disabled = false;
        btn.textContent = '进入';
      });
    };
  }

  function start() {
    var fam = ls(FAM_KEY, null);
    if (!fam || !fam.fam) {
      picker();
      return;
    }
    syncState.pw = fam.pw;
    syncState.fam = fam.fam;

    paint('off');
    pull(fam.pw, fam.fam).then(function () {
      paint('ok');
      if (window.RB_ON_SYNC) window.RB_ON_SYNC();
    }).catch(function () { paint('off'); });
  }

  function sheet() {
    var fam = ls(FAM_KEY, null);
    if (!fam) return;
    css();
    var old = document.getElementById('rbsheet');
    if (old) old.remove();

    var d = document.createElement('div');
    d.id = 'rbsheet';
    d.innerHTML =
      '<div class="s-card">' +
      '<h1>' + fam.name + '</h1>' +
      '<p class="g-sub">这台设备已连到这个家，改动会自动同步。</p>' +
      '<label>小区口令（记下来，换手机要用）</label>' +
      '<input id="rsPw" type="text" readonly value="' + fam.pw + '">' +
      '<button class="g-btn" id="rsSw">换一个家</button>' +
      '<button class="g-btn g-ghost" id="rsOut">退出这台设备</button>' +
      '<button class="g-btn g-ghost" id="rsClose">关闭</button>' +
      '</div>';
    document.body.appendChild(d);
    d.classList.add('on');

    document.getElementById('rsPw').onclick = function () {
      this.select();
      try { document.execCommand('copy'); } catch (e) {}
    };
    document.getElementById('rsClose').onclick = function () { d.remove(); };
    document.getElementById('rsSw').onclick = function () { d.remove(); RBSYNC.switchFamily(); };
    document.getElementById('rsOut').onclick = function () { d.remove(); RBSYNC.logout(); };
  }

  function mountDot() {
    var nav = document.querySelector('.sitenav') || document.querySelector('.nav') || document.querySelector('.nav2');
    if (!nav) return;
    dot = document.createElement('span');
    dot.id = 'rbd';
    dot.onclick = sheet;
    nav.appendChild(dot);
  }

  window.RBSYNC = {
    save: function (docKey) {
      if (docKey === 'rb_shop' && !weekCode()) {
        docKey = 'rb_shop';
      }
      schedule(docKey);
    },
    state: function () { return { on: !!syncState.fam, fam: ls(FAM_KEY, null) }; },
    switchFamily: function () {
      lss(FAM_KEY, null);
      lss(REV_KEY, {});
      picker(function () { location.reload(); });
    },
    logout: function () {
      lss(GATE_KEY, false);
      lss(FAM_KEY, null);
      lss(REV_KEY, {});
      location.reload();
    }
  };

  function boot() {
    mountDot();
    if (!gate()) start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
