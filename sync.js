/* 菜谱网站同步层：页面口令 → 选小区 → 输入门牌号 → Supabase
 *
 * 设计要点
 *   - 页面口令只挡界面；真正的数据访问靠服务端校验门牌号（families 表 + bcrypt）
 *   - 每个小区一个固定 family（32 位 hex），门牌号只当口令用，不参与派生
 *   - 门牌号不分大小写（服务端统一 upper 后比对）
 *   - localStorage 是唯一真实数据源；云端挂了页面照常能用
 *   - 首次接入（云端该份为空 + 本地有数据）才把本地推上去
 */
(function () {
  'use strict';

  var API = 'https://brxlbwgyxcrilraxlbvt.supabase.co/rest/v1/rpc';
  var KEY = 'sb_publishable_n4_Ik7gMKPEpZgpGX_s2_Q_kS9jp3hH';

  var PAGE_PW = '12250504';

  var NBS = [
    { id: 'queenroad',  name: '皇后道',   fam: '0b0d3b8bf348c85fcc244691b77f8825' },
    { id: 'yongyi',     name: '雍颐湾',   fam: 'f688c606b8b3213afaca12d152556a1d' },
    { id: 'jianshang',  name: '简上村',   fam: '28b32bec231e9d2797270197f71ebbf4' },
    { id: 'tianyue',    name: '天樾府',   fam: '45311a241602fcd2450c36c8ef16d778' },
    { id: 'yulin',      name: '裕林花园', fam: '33619a67ac9a7642efb75ac6656508cc' },
    { id: 'birmingham', name: '伯明翰',   fam: '142ae6144dbb013b5e51146d29ec67ef' },
    { id: 'haorizi',    name: '好日子',   fam: '7256bfe636fb4da7458a09b7f0f9b1bf' }
  ];
  var DEFAULT_NB = 'queenroad';

  var DOCS = [
    { key: 'rb_stock', suffix: '_stock', wrap: false, week: false, mergeKeys: true },
    { key: 'rb_lists', suffix: '_orders', wrap: true, week: false },
    { key: 'rb_prints', suffix: '_prints', wrap: true, week: false },
    { key: 'rb_shop', suffix: '_shop-fresh', wrap: false, week: true, mergeKeys: true }
  ];

  var GATE_KEY = 'rb_gate';
  var FAM_KEY = 'rb_family';
  var REV_KEY = 'rb_rev';
  var DIRTY_KEY = 'rb_dirty';
  var DELAY = 700;

  function ls(k, d) {
    try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }
    catch (e) { return d; }
  }
  function lss(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function isDirty(doc) {
    var d = ls(DIRTY_KEY, {}) || {};
    return !!d[doc.suffix];
  }
  function markDirty(doc) {
    var d = ls(DIRTY_KEY, {}) || {};
    d[doc.suffix] = 1;
    lss(DIRTY_KEY, d);
  }
  function clearDirty(doc) {
    var d = ls(DIRTY_KEY, {}) || {};
    delete d[doc.suffix];
    lss(DIRTY_KEY, d);
  }

  // 换小区/退出：本机旧数据必须清掉，否则会并进新家的云端
  function purgeLocal() {
    DOCS.forEach(function (d) {
      if (d.week) {
        try {
          Object.keys(localStorage).forEach(function (k) {
            if (k.indexOf('rb_shop_') === 0) localStorage.removeItem(k);
          });
        } catch (e) {}
      } else {
        try { localStorage.removeItem(d.key); } catch (e) {}
      }
    });
    lss(REV_KEY, {});
    lss(DIRTY_KEY, {});
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

  function mergeByKey(doc, remote, local) {
    if (!remote || typeof remote !== 'object') return local;
    if (doc.week) {
      var out = {};
      var rt = remote.items || {};
      var lc = local || {};
      Object.keys(rt).forEach(function (k) { out[k] = 1; });
      Object.keys(lc).forEach(function (k) { out[k] = 1; });
      return out;
    }
    var r = (remote && remote.items) || {};
    var l = (local && local.items) || {};
    var merged = {};
    Object.keys(r).forEach(function (k) { merged[k] = r[k]; });
    Object.keys(l).forEach(function (k) {
      if (!merged[k]) { merged[k] = l[k]; return; }
      var a = Number((merged[k] && merged[k].ts) || 0);
      var b = Number((l[k] && l[k].ts) || 0);
      if (b > a) merged[k] = l[k];
    });
    // 墓碑：删除也要同步，否则另一台设备会把删掉的又并回来
    var rdel = (remote && remote.del) || {};
    var ldel = (local && local.del) || {};
    var del = {};
    Object.keys(rdel).forEach(function (k) {
      del[k] = Math.max(Number(del[k] || 0), Number(rdel[k] || 0));
    });
    Object.keys(ldel).forEach(function (k) {
      del[k] = Math.max(Number(del[k] || 0), Number(ldel[k] || 0));
    });
    Object.keys(del).forEach(function (k) {
      var it = merged[k];
      if (it && Number(it.ts || 0) > Number(del[k] || 0)) { delete del[k]; return; }
      delete merged[k];
    });
    return { v: 2, items: merged, del: del };
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
          if (val === null) return;

          if (doc.mergeKeys && isDirty(doc)) {
            writeLocal(doc, mergeByKey(doc, val, readLocal(doc)));
          } else {
            writeLocal(doc, val);
          }
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
        clearDirty(doc);
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
              if (r2.ok) { revs[doc.suffix] = r2.body.rev; lss(REV_KEY, revs); clearDirty(doc); return 'ok'; }
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

    markDirty(doc);
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
    var label = fam.name;
    var state = tone === 'doing' ? '同步中' : (tone === 'ok' ? '已同步' : '仅本机');
    dot.className = tone === 'doing' ? 'doing' : (tone === 'ok' ? 'on' : '');
    dot.innerHTML = '<i></i><b>' + label + '</b><u>切换</u>';
    dot.title = label + ' · ' + state;
  }

  function css() {
    var s = document.createElement('style');
    s.textContent = [
      '#rbg{position:fixed;inset:0;z-index:9999;background:#faf9f6;display:none;',
      'flex-direction:column;padding:0 22px;box-sizing:border-box;overflow-y:auto;}',
      '#rbg.on{display:flex;}',
      // 内容层（弹层 #dlg / 导航 / 弹窗）永远压在遮罩之上，避免遮罩万一残留就锁死全站。
      // 只抬 z-index，绝不改 position：#dlg/#mask 是 fixed、.top 是 sticky，
      // 一旦被覆盖成 relative，弹层会渲染到文档末尾（点“我的菜谱”看着像跳回总菜谱），导航也会失去吸顶。
      '#dlg,#mask,#top,.top{z-index:10000;}',
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
      '#rbg .g-rf{display:inline-block;margin-top:10px;padding:6px 12px;border:1px solid #d8d8d2;}',
      '#rbg .g-rf{border-radius:8px;background:#fff;color:#b5342a;font-weight:700;cursor:pointer;}',
      '#rbbar{display:flex;align-items:center;justify-content:space-between;',
      'padding:5px 12px;background:#fff;border-bottom:1px solid #efefeb;}',
      '#rbbar .rb-lbl{font-size:11px;color:#a8a8a3;font-weight:600;}',
      '#rbd{display:none;align-items:center;gap:6px;cursor:pointer;',
      'font-size:12.5px;font-weight:600;color:#444;',
      '-webkit-tap-highlight-color:transparent;}',
      '#rbd b{font-weight:700;}',
      '#rbd i{display:inline-block;width:6px;height:6px;border-radius:50%;',
      'background:#c4c4be;font-style:normal;flex:0 0 auto;}',
      '#rbd u{text-decoration:none;font-size:11px;font-weight:600;color:#333;',
      'border:1px solid #dcdcd6;background:#fff;border-radius:7px;',
      'padding:4px 11px;margin-left:3px;line-height:1.2;',
      'box-shadow:0 1px 2px rgba(0,0,0,.05);}',
      '#rbd:active u{background:#f2f2ee;}',
      '#rbd.on i{background:#2f7a45;}',
      '#rbd.doing i{background:#d99b3d;}',
      '#rbsheet{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.4);',
      'display:none;align-items:flex-end;}',
      '#rbsheet.on{display:flex;}',
      '#rbsheet .s-card{background:#fff;width:100%;box-sizing:border-box;',
      'border-radius:16px 16px 0 0;padding:20px 22px calc(24px + env(safe-area-inset-bottom));}',
      '#rbsheet h1{font-size:19px;margin:0 0 4px;font-weight:800;}',
      '#rbsheet .g-sub{margin:0 0 4px;}',
      '#rbsheet input{background:#f7f7f4;text-align:center;letter-spacing:1px;}',
      '#rbsheet .g-btn{margin-top:10px;}',
      '#rbsheet .g-ghost{background:#f2f2ee;color:#555;}',
      '@media print{#rbg,#rbsheet,#rbbar{display:none !important;}body.rb-lock{overflow:visible !important;}}'
    ].join('');
    document.head.appendChild(s);
  }

  function gate(force) {
    if (!force && ls(GATE_KEY, false)) return false;
    // 兜底：已有口令+家庭配置时绝不再挂遮罩。遮罩是 fixed 全屏 z-index:9999，
    // 一旦残留会把整个页面（含库存勾选）的点击全部拦掉。
    if (!force && ls(FAM_KEY, null)) return false;

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
      '<div class="g-foot">第一次输完会记住这台设备，以后直接进。<br>' +
      '<span class="g-rf" data-rf="1">看不到最新版？点这里刷新</span>' +
      '<br><span class="g-rf" data-skip="1" style="margin-top:6px">先不用，直接看菜谱</span></div>' +
      '</div>';
    document.body.appendChild(g);
    document.body.classList.add('rb-lock');
    g.classList.add('on');
    (function () {
      var sk = g.querySelector('[data-skip]');
      if (sk) sk.onclick = function (e) {
        e.preventDefault();
        document.body.classList.remove('rb-lock');
        g.remove();
        paint('off');
      };
    })();
    (function(){ var rf=g.querySelector('[data-rf]'); if(rf){ rf.onclick=function(e){ e.preventDefault(); if(window.RB_REFRESH) window.RB_REFRESH(); }; } })();

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
      '<p class="g-sub">选自己家，填门牌号，以后这台设备直接进。</p>' +
      '<label>小区</label><div class="g-nb" id="rgNbs">' + rows() + '</div>' +
      '<label>门牌号</label>' +
      '<input id="rgNpw" type="text" autocomplete="off" autocapitalize="characters" placeholder="例如 1801 或 6A27C">' +
      '<div class="g-err" id="rgNerr"></div>' +
      '<button class="g-btn" id="rgNgo">进入</button>' +
      '<div class="g-foot">门牌号输一次，这台手机以后不用再输。换设备要重输。不分大小写。<br>' +
      '<span class="g-rf" data-rf="1">看不到最新版？点这里刷新</span></div>' +
      '</div>';
    document.body.appendChild(g);
    document.body.classList.add('rb-lock');
    g.classList.add('on');
    (function(){ var rf=g.querySelector('[data-rf]'); if(rf){ rf.onclick=function(e){ e.preventDefault(); if(window.RB_REFRESH) window.RB_REFRESH(); }; } })();

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
      if (pw.length < 3) { err.textContent = '请输入门牌号'; return; }
      btn.disabled = true;
      btn.textContent = '连接中…';

      var nb = NBS.filter(function (n) { return n.id === picked; })[0] || NBS[0];
      var famId = nb.fam;

      call('put_family', { p_family: famId, p_token: pw, p_label: nb.name })
        .then(function (reg) {
          if (!reg.ok && reg.status !== 200) {
            if (reg.body && reg.body.code === 'PT403') throw new Error('门牌号不对');
            if (reg.body && reg.body.code === 'PT404') throw new Error('这个家还没开通');
            throw new Error('连不上服务器，请检查网络');
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
        }).catch(function (e) {
        err.textContent = (e && e.message) || '连不上服务器，请检查网络';
        btn.disabled = false;
        btn.textContent = '进入';
      });
    };
  }

  // 兼容旧的字符串格式（只存了 fam id）：转成对象，pw 缺失时只关闭同步、不影响本地使用。
  function normalizeFam(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      var hit = NBS.filter(function (n) { return n.fam === raw; })[0];
      return { id: hit ? hit.id : '', name: hit ? hit.name : '', pw: '', fam: raw };
    }
    if (raw.fam) return raw;
    return null;
  }

  function start() {
    var fam = normalizeFam(ls(FAM_KEY, null));
    if (!fam) {
      picker();
      return;
    }
    syncState.pw = fam.pw;
    syncState.fam = fam.fam;

    paint('off');
    if (!fam.pw) {
      // 只有小区没有门牌号：同步关掉，页面照常本地可用，不再弹遮罩。
      return;
    }
    pull(fam.pw, fam.fam).then(function (info) {
      var upload = (info && info.need && info.need.length)
        ? bootstrap(fam.pw, fam.fam, info.need) : Promise.resolve(0);
      return upload.then(function () {
        return pull(fam.pw, fam.fam);
      });
    }).then(function () {
      paint('ok');
      if (window.RB_ON_SYNC) window.RB_ON_SYNC();
    }).catch(function () { paint('off'); });

    // 别的设备改了？回到前台时再拉一次
    if (!start._bound) {
      start._bound = 1;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        if (!syncState.fam || !syncState.pw) return;
        pull(syncState.pw, syncState.fam).then(function () {
          paint('ok');
          if (window.RB_ON_SYNC) window.RB_ON_SYNC();
        }).catch(function () {});
      });
    }
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
      '<label>门牌号（换手机时要填）</label>' +
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

    var bar = document.createElement('div');
    bar.id = 'rbbar';
    bar.innerHTML = '<span class="rb-lbl">当前小区</span><span id="rbd"></span>';
    if (nav.parentNode) nav.parentNode.insertBefore(bar, nav.nextSibling);

    dot = document.getElementById('rbd');
    dot.onclick = sheet;
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
      purgeLocal();
      picker(function () { location.reload(); });
    },
    logout: function () {
      lss(GATE_KEY, false);
      lss(FAM_KEY, null);
      purgeLocal();
      location.reload();
    }
  };

  // 跨页导航会丢 query 和 hash（iOS 主屏 PWA 尤其明显），
  // 所以在点击瞬间把意图写进 localStorage，落地页读它再打开对应弹层。
  var OPEN_INTENT = 'rb_open_intent';
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href*="open="]') : null;
    if (!a) return;
    var m = (a.getAttribute('href') || '').match(/open=(\w+)/);
    if (m) { try { localStorage.setItem(OPEN_INTENT, m[1]); } catch (x) {} }
  }, true);

  function takeIntent() {
    var v = null;
    try { v = localStorage.getItem(OPEN_INTENT); localStorage.removeItem(OPEN_INTENT); } catch (x) {}
    return v;
  }
  window.RB_TAKE_INTENT = takeIntent;

  function boot() {
    css();
    mountDot();
    if (!gate()) start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* ===== 刷新按钮 + 强制拉取最新版本 ===== */
(function () {
  var BUSY = false;

  function go() {
    if (window.__rbGoing) return;
    window.__rbGoing = true;
    var base = location.pathname.replace(/index\.html$/, '');
    location.replace(base + '?_r=' + Date.now() + (location.hash || ''));
  }

  function hardRefresh() {
    if (BUSY) return;
    BUSY = true;
    var btn = document.getElementById('rbRefresh');
    if (btn) { btn.textContent = '刷新中…'; btn.style.opacity = '0.6'; }
    var p = Promise.resolve();

    // 1) 注销 Service Worker（旧版缓存的最大来源）
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        p = p.then(function () {
          return navigator.serviceWorker.getRegistrations().then(function (rs) {
            return Promise.all(rs.map(function (r) { try { return r.unregister(); } catch (e) { } }));
          });
        });
      }
    } catch (e) { }

    // 2) 清空所有 Cache Storage
    p = p.then(function () {
      if (window.caches && caches.keys) {
        return caches.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { try { return caches.delete(k); } catch (e) { } }));
        });
      }
    }).catch(function () { });

    p.then(go);
    setTimeout(go, 1500); // 兜底：promise 卡住也要刷新
  }

  window.RB_REFRESH = hardRefresh;

  function mount() {
    if (document.getElementById('rbRefresh')) return;

    var btn = document.createElement('button');
    btn.id = 'rbRefresh';
    btn.type = 'button';
    btn.textContent = '刷新';
    btn.setAttribute('aria-label', '强制刷新到最新版本');
    btn.style.cssText =
      'margin-left:8px;padding:3px 9px;font-family:inherit;font-size:12px;line-height:1.4;' +
      'border:1px solid #d8d8d2;border-radius:8px;background:#fff;color:#b5342a;' +
      'font-weight:700;vertical-align:middle;-webkit-tap-highlight-color:transparent;';
    btn.onclick = function (e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      hardRefresh();
    };

    // 优先挂在「更新 MM-DD HH:MM」这个版本戳旁边
    var host = document.querySelector('.stamp') ||
               document.querySelector('.upd') ||
               document.querySelector('.head');
    var nav = document.querySelector('.sitenav') || document.querySelector('.nav2');

    if (host) {
      if (host.classList.contains('head') || host.tagName === 'DIV') {
        host.appendChild(btn);            // .head / .stamp 是块级容器
      } else if (host.parentNode) {
        host.parentNode.insertBefore(btn, host.nextSibling);
      }
    } else if (nav && nav.parentNode) {
      nav.parentNode.insertBefore(btn, nav.nextSibling);
    } else {
      return; // 找不到落点就不挂，避免乱飘
    }
  }

  // 页面加载时主动查一次 SW 更新（配合 updateViaCache:'none'）
  // 延迟且只在已 activated 时调用，避免安装中的竞态报错
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
    setTimeout(function () {
      try {
        navigator.serviceWorker.getRegistration().then(function (r) {
          if (r && r.active && !r.installing && r.update) {
            try { r.update(); } catch (e) { }
          }
        }).catch(function () { });
      } catch (e) { }
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
