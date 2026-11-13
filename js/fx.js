// FX: shared scene engine for every template. Vanilla JS, one <canvas> per page.
// Ported from the "globo" reference: spring dust that reacts to the cursor, cameras
// with drag + inertia + wheel zoom + eased fly-to, DOM labels that follow scene points,
// hash routing, a Ctrl+K search palette and a circular panel reveal.
// Everything respects prefers-reduced-motion (FX.still): scenes render once per change.
(function () {
  'use strict';
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;
  const ease = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapAngle = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Seeded RNG so layouts are stable between reloads.
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  const gauss = r => (r() + r() + r() + r() - 2) / 2;

  /* ---------- pointer ---------- */
  const mouse = { x: -9999, y: -9999, on: false, moved: 0 };
  addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; mouse.moved = performance.now(); poke(); if (still) invalidateAll(); }, { passive: true });
  // Economy: after a few seconds without input the ambient animation drops to 30 fps.
  // Any input, scroll, camera flight or state change (FX.invalidate) brings it back to 60 at once.
  // Sleep: a few seconds later still, the loop stops entirely (the canvas keeps its last frame) until the next input.
  let lastInput = performance.now();
  const ECO_AFTER = 2500, SLEEP_AFTER = 9000;
  let asleep = false;
  function poke() {
    lastInput = performance.now();
    if (asleep) { asleep = false; if (active) document.documentElement.classList.remove('fx-idle'); stages.forEach(S => S.sync && S.sync()); }
    else stages.forEach(S => { if (S.raf === -1) { S.raf = 0; S.sync(); } });   // leave the 30 fps pace at once
  }
  ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(t => addEventListener(t, poke, { passive: true, capture: true }));
  addEventListener('scroll', poke, { passive: true, capture: true });
  document.addEventListener('pointerleave', () => { mouse.on = false; });
  addEventListener('blur', () => { mouse.on = false; });

  /* ---------- idle: zero work when the page is hidden or the window is not focused ---------- */
  // Every stage stops its rAF loop and <html> gets .fx-idle, which pauses all CSS animations.
  // The canvas keeps its last frame, so the page looks frozen, not blank.
  const stages = [];
  // window.__hubActive is set by the Folio viewer app (false when its tab is not the key one or the app is
  // in the background); in a plain browser it stays undefined and focus/visibility decide.
  const isActive = () => document.visibilityState === 'visible' && document.hasFocus() && window.__hubActive !== false;
  let active = isActive();
  function setActive() {
    const a = isActive(); if (a === active) return; active = a;
    if (a) { lastInput = performance.now(); asleep = false; }   // coming back to the page wakes the scene
    document.documentElement.classList.toggle('fx-idle', !a);
    stages.forEach(S => S.sync && S.sync());
  }
  addEventListener('focus', setActive); addEventListener('blur', setActive); addEventListener('hub-activity', setActive);
  document.addEventListener('visibilitychange', setActive);
  document.documentElement.classList.toggle('fx-idle', !active);
  // Pages may run their own timers; they should check FX.active() before doing work.

  function invalidateAll() { poke(); stages.forEach(s => s.invalidate()); }
  // stage(canvas, { draw(ctx, t, S) }) — draw is called every frame (or once per invalidate when still).
  function stage(canvas, opts) {
    const S = { canvas, ctx: canvas.getContext('2d'), W: 0, H: 0, dpr: 1, t: 0, draw: opts.draw, onResize: opts.onResize, raf: 0, dirty: true };
    function size() {
      S.dpr = Math.min(1.25, devicePixelRatio || 1);   // canvases hold glows and dust: 1.25x is indistinguishable and ~30% fewer pixels than 1.5x
      const r = canvas.getBoundingClientRect();
      S.W = Math.max(1, r.width || innerWidth); S.H = Math.max(1, r.height || innerHeight);
      canvas.width = Math.round(S.W * S.dpr); canvas.height = Math.round(S.H * S.dpr);
      if (S.onResize) S.onResize(S);
      S.dirty = true;
    }
    function frame(t) {
      S.t = Math.max(S.t || 0, t || performance.now());   // rAF and performance.now() timestamps mixed: never let scene time go back
      const ctx = S.ctx; ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, S.W, S.H);
      S.draw(ctx, S.t, S);
      S.dirty = false;
    }
    // The loop runs only while the window is active AND the canvas is on screen.
    S.visible = true;
    let ecoTimer = 0;
    function loop(t) {
      S.raf = 0;
      const idle = t - lastInput;
      if (idle > SLEEP_AFTER) { asleep = true; frame(t); document.documentElement.classList.add('fx-idle'); return; }   // last frame, then nothing until input
      frame(t);
      if (!(active && S.visible)) return;
      // Economy: the next frame is ~33 ms away instead of the next vsync, so the thread wakes half as often.
      if (idle > ECO_AFTER) { S.raf = -1; ecoTimer = setTimeout(() => { if (S.raf === -1) S.raf = requestAnimationFrame(loop); }, 26); }
      else S.raf = requestAnimationFrame(loop);
    }
    S.loop = loop;
    S.sync = () => {
      if (still) return;
      const run = active && S.visible && !asleep;
      if (run && !S.raf) S.raf = requestAnimationFrame(loop);
      else if (!run && S.raf) { if (S.raf > 0) cancelAnimationFrame(S.raf); clearTimeout(ecoTimer); S.raf = 0; }
    };
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { S.visible = es[es.length - 1].isIntersecting; S.sync(); }).observe(canvas);
    S.invalidate = () => { if (still || !active || !S.visible || asleep) { if (!S.pending) { S.pending = true; requestAnimationFrame(() => { S.pending = false; frame(performance.now()); }); } } };
    S.resize = size;
    let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { size(); S.invalidate(); }, 80); });
    size();
    frame(performance.now());
    if (!still && active) S.raf = requestAnimationFrame(loop);
    stages.push(S);
    return S;
  }

  /* ---------- dust: drifting particles that flee and brighten near the cursor ---------- */
  // opts: { color:'r,g,b', near:'r,g,b', density (px² per particle), min, max, repel (px), size }
  function dust(opts) {
    const o = Object.assign({ color: '220,228,240', near: '110,231,242', density: 11000, min: 40, max: 160, repel: 140, size: 1, seed: 7 }, opts || {});
    const r = rng(o.seed), P = [];
    return {
      draw(ctx, t, S, ox, oy) {
        const n = Math.round(clamp(S.W * S.H / o.density, o.min, o.max));
        while (P.length < n) { const x = r() * S.W, y = r() * S.H; P.push({ x, y, hx: x, hy: y, vx: 0, vy: 0, r: (.5 + r() * .9) * o.size, a: .16 + r() * .38, ph: r() * TAU, sp: .4 + r() * .6 }); }
        P.length = n;
        const R = o.repel, R2 = R * R, RN = R * 1.4, mx = mouse.x - (ox || 0), my = mouse.y - (oy || 0), on = mouse.on;
        const cBase = 'rgb(' + o.color + ')', cNear = 'rgb(' + o.near + ')';
        let cur = '';
        for (const p of P) {
          if (!still) {
            p.hx += Math.cos(p.ph + t * .00006 * p.sp) * .1; p.hy += Math.sin(p.ph + t * .00005 * p.sp) * .1;
            if (p.hx < -20) p.hx = S.W + 20; if (p.hx > S.W + 20) p.hx = -20; if (p.hy < -20) p.hy = S.H + 20; if (p.hy > S.H + 20) p.hy = -20;
            p.vx += (p.hx - p.x) * .012; p.vy += (p.hy - p.y) * .012;
            if (on) { const dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy; if (d2 < R2 && d2 > .01) { const d = Math.sqrt(d2), f = (1 - d / R) * 1.2; p.vx += dx / d * f; p.vy += dy / d * f; } }
            p.vx *= .86; p.vy *= .86; p.x += p.vx; p.y += p.vy;
          }
          let al = p.a, near = 0;
          if (on) { const dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy; if (d2 < RN * RN) { near = 1 - Math.sqrt(d2) / RN; al = Math.min(1, al + near * .5); } }
          const c = near > .05 ? cNear : cBase; if (c !== cur) { ctx.fillStyle = c; cur = c; }
          ctx.globalAlpha = al;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r + near * .8, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  /* ---------- sky: twinkling fixed stars with optional parallax ---------- */
  function sky(opts) {
    const o = Object.assign({ count: 160, color: '207,216,230', seed: 3 }, opts || {});
    const r = rng(o.seed), stars = Array.from({ length: o.count }, () => ({ x: r(), y: r(), r: r() < .85 ? .6 : 1.1, a: .1 + r() * .45, ph: r() * TAU, sp: .4 + r() * 1.2 }));
    return {
      draw(ctx, t, S, px, py) {
        ctx.fillStyle = 'rgb(' + o.color + ')';
        const ox = px || 0, oy = py || 0, tt = t * .001;
        for (const s of stars) {
          let x = (s.x * S.W + ox) % S.W; if (x < 0) x += S.W;
          let y = (s.y * S.H + oy) % S.H; if (y < 0) y += S.H;
          ctx.globalAlpha = still ? s.a : s.a * (.55 + .45 * Math.sin(tt * s.sp + s.ph));
          ctx.fillRect(x, y, s.r * 1.4, s.r * 1.4);
        }
        ctx.globalAlpha = 1;
      }
    };
  }

  /* ---------- drawing helpers ---------- */
  // Glows are cached sprites (one per colour and inner ratio), drawn scaled with globalAlpha:
  // no gradient object is created per call.
  const glowSprites = new Map();
  function glowSprite(rgb, inner) {
    const k = rgb + '|' + (inner || 0); let c = glowSprites.get(k);
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 64 * (inner || 0), 64, 64, 64);
    g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); glowSprites.set(k, c); return c;
  }
  function glow(ctx, x, y, r, rgb, a, inner) {
    if (r <= 0 || a <= 0) return;
    const prev = ctx.globalAlpha; ctx.globalAlpha = prev * a;
    ctx.drawImage(glowSprite(rgb, inner), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = prev;
  }
  function hexRgb(hex) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(','); }

  /* ---------- input binding shared by cameras ---------- */
  // Calls handlers: down(e), move(dx,dy,e), up(drag), wheel(deltaY,e). Distinguishes click from drag (4px).
  function bindDrag(el, h) {
    let drag = null;
    el.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      if (h.ignore && h.ignore(e)) return;
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId, target: e.target };
      if (h.down) h.down(e, drag);
    });
    el.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) { drag.moved = true; try { el.setPointerCapture(drag.id); } catch (err) {} el.classList.add('fx-dragging'); }
      if (drag.moved && h.move) h.move(dx, dy, e, drag);
    });
    const end = () => { if (!drag) return; const d = drag; drag = null; el.classList.remove('fx-dragging'); if (h.up) h.up(d); if (d.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 60); } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    if (h.wheel) el.addEventListener('wheel', e => { if (h.ignoreWheel && h.ignoreWheel(e)) return; e.preventDefault(); h.wheel(e.deltaY, e); }, { passive: false });
    return { get dragging() { return !!(drag && drag.moved); } };
  }
  let suppressClick = false;
  document.addEventListener('click', e => { if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); suppressClick = false; } }, true);

  /* ---------- 2D camera: pan + zoom with inertia and fly-to ---------- */
  // cam2d(el, { x, y, zoom, minZoom, maxZoom, bounds:{x0,y0,x1,y1}, drift }) — world coords centred on (x,y).
  function cam2d(el, opts) {
    const C = Object.assign({ x: 0, y: 0, zoom: 1, minZoom: .6, maxZoom: 2.6, vx: 0, vy: 0, anim: null, W: innerWidth, H: innerHeight, ox: .5, oy: .5, locked: false, drift: 0 }, opts || {});
    C.toScreen = (wx, wy) => ({ x: C.W * C.ox + (wx - C.x) * C.zoom, y: C.H * C.oy + (wy - C.y) * C.zoom });
    C.toWorld = (sx, sy) => ({ x: C.x + (sx - C.W * C.ox) / C.zoom, y: C.y + (sy - C.H * C.oy) / C.zoom });
    C.fly = (to, dur) => { C.vx = C.vy = 0; C.anim = { from: { x: C.x, y: C.y, zoom: C.zoom, ox: C.ox, oy: C.oy }, to: Object.assign({ x: C.x, y: C.y, zoom: C.zoom, ox: C.ox, oy: C.oy }, to), t0: performance.now(), dur: still ? 0 : (dur == null ? 900 : dur) }; invalidateAll(); };
    C.update = (S) => {
      C.W = S.W; C.H = S.H;
      if (C.anim) {
        const A = C.anim, u = A.dur ? Math.min(1, (performance.now() - A.t0) / A.dur) : 1, e = ease(u);
        ['x', 'y', 'zoom', 'ox', 'oy'].forEach(k => { C[k] = lerp(A.from[k], A.to[k], e); });
        if (u >= 1) C.anim = null;
      } else if (!input.dragging) {
        C.x += C.vx; C.y += C.vy; C.vx *= .92; C.vy *= .92;
        if (Math.abs(C.vx) < 1e-3) C.vx = 0; if (Math.abs(C.vy) < 1e-3) C.vy = 0;   // come to a true rest so caches can settle
        if (C.drift && !still) C.x += Math.sin(S.t * .00007) * C.drift * .02;
      }
      if (C.bounds) { C.x = clamp(C.x, C.bounds.x0, C.bounds.x1); C.y = clamp(C.y, C.bounds.y0, C.bounds.y1); }
    };
    C.zoomAt = (deltaY, sx, sy) => {
      if (C.locked) return;
      const before = C.toWorld(sx, sy);
      C.anim = null; C.zoom = clamp(C.zoom * (deltaY > 0 ? .92 : 1.08), C.minZoom, C.maxZoom);
      const after = C.toWorld(sx, sy); C.x += before.x - after.x; C.y += before.y - after.y; invalidateAll();
    };
    const input = bindDrag(el, {
      ignore: e => C.locked || (C.ignore && C.ignore(e)),
      move: (dx, dy) => { C.anim = null; C.vx = -dx / C.zoom; C.vy = -dy / C.zoom; C.x += C.vx; C.y += C.vy; touched(); invalidateAll(); },
      wheel: (d, e) => { C.zoomAt(d, e.clientX, e.clientY); touched(); },
      ignoreWheel: () => C.locked
    });
    C.input = input;
    return C;
  }

  /* ---------- 3D orbit camera: yaw/pitch/zoom with inertia, auto-spin and fly-to ---------- */
  // orbit(el, { yaw, pitch, zoom, R, spin, minPitch, maxPitch })
  function orbit(el, opts) {
    const Q = Object.assign({ yaw: 0, pitch: -.35, zoom: 1, R: 260, cx: 0, cy: 0, vy: 0, vp: 0, spin: .0014, minPitch: -1.45, maxPitch: 1.45, minZoom: .6, maxZoom: 2.4, anim: null, hold: false, locked: false, persp: 3.2 }, opts || {});
    Q.rot = v => {
      const [x, y, z] = v, cy = Math.cos(Q.yaw), sy = Math.sin(Q.yaw), cp = Math.cos(Q.pitch), sp = Math.sin(Q.pitch);
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
    };
    Q.project = (v, lift) => { const r = Q.rot(v), R = Q.R * Q.zoom * (lift || 1), k = Q.persp / (Q.persp - r[2] * .6); return { x: Q.cx + r[0] * R * k, y: Q.cy - r[1] * R * k, z: r[2], k }; };
    Q.fly = (to, dur) => { Q.vy = Q.vp = 0; const t = Object.assign({ yaw: Q.yaw, pitch: Q.pitch, zoom: Q.zoom, cx: Q.cx, cy: Q.cy }, to); if (to.yaw != null) t.yaw = Q.yaw + wrapAngle(to.yaw - Q.yaw); Q.anim = { from: { yaw: Q.yaw, pitch: Q.pitch, zoom: Q.zoom, cx: Q.cx, cy: Q.cy }, to: t, t0: performance.now(), dur: still ? 0 : (dur == null ? 900 : dur) }; invalidateAll(); };
    Q.update = () => {
      if (Q.anim) {
        const A = Q.anim, u = A.dur ? Math.min(1, (performance.now() - A.t0) / A.dur) : 1, e = ease(u);
        ['yaw', 'pitch', 'zoom', 'cx', 'cy'].forEach(k => { Q[k] = lerp(A.from[k], A.to[k], e); });
        if (u >= 1) Q.anim = null;
      } else if (!still && !input.dragging && !Q.locked) {
        if (!Q.hold) Q.vy += (Q.spin - Q.vy) * .02; else Q.vy *= .9;
        Q.yaw += Q.vy; Q.vp *= .92; Q.pitch = clamp(Q.pitch + Q.vp, Q.minPitch, Q.maxPitch);
      }
    };
    const input = bindDrag(el, {
      ignore: e => Q.locked || (Q.ignore && Q.ignore(e)),
      move: (dx, dy) => { Q.anim = null; Q.vy = dx * .006; Q.vp = dy * .006; Q.yaw += Q.vy; Q.pitch = clamp(Q.pitch + Q.vp, Q.minPitch, Q.maxPitch); touched(); invalidateAll(); },
      wheel: d => { if (Q.locked) return; Q.anim = null; Q.zoom = clamp(Q.zoom * (d > 0 ? .92 : 1.08), Q.minZoom, Q.maxZoom); touched(); invalidateAll(); },
      ignoreWheel: () => Q.locked
    });
    Q.input = input;
    return Q;
  }

  /* ---------- labels: DOM elements that follow scene points without overlapping ---------- */
  // items: [{ el, x, y, r, vis, side? }] in screen px. Call every frame after positions are known.
  // Sets el.style.transform, --vis and the .lt class (label sits left of its point).
  let fontGen = 0;
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fontGen++; invalidateAll(); });
  function labels(items, bounds) {
    const b = Object.assign({ x0: 12, y0: 12, x1: innerWidth - 12, y1: innerHeight - 12, gap: 6 }, bounds || {});
    const placed = [], mid = (b.x0 + b.x1) / 2;
    const order = items.slice().sort((a, c) => (c.z || 0) - (a.z || 0));
    for (const s of order) {
      if (!s.el) continue;
      if (s.w == null || s.measure || s._fg !== fontGen) { s.w = s.el.offsetWidth; s.h = s.el.offsetHeight; s.measure = false; s._fg = fontGen; }
      let side = s.side || (s.x < mid ? -1 : 1);
      const off = 9 + (s.r || 4);
      let x = side < 0 ? s.x - off - s.w : s.x + off;
      if (side > 0 && x + s.w > b.x1) { side = -1; x = s.x - off - s.w; }
      if (side < 0 && x < b.x0) { side = 1; x = s.x + off; }
      x = clamp(x, b.x0, b.x1 - s.w);
      const hits = (x, y) => placed.some(p => x < p.x + p.w + b.gap && p.x < x + s.w + b.gap && y < p.y + p.h + 3 && p.y < y + s.h + 3);
      const settle = x => { let y = s.y - s.h / 2; for (let pass = 0; pass < 8; pass++) for (const p of placed) { if (x < p.x + p.w + b.gap && p.x < x + s.w + b.gap && y < p.y + p.h + 3 && p.y < y + s.h + 3) y = (s.y < p.y + p.h / 2) ? p.y - s.h - 3 : p.y + p.h + 3; } return y; };
      let y = settle(x);
      if (hits(x, y)) { const ax = clamp(side < 0 ? s.x + off : s.x - off - s.w, b.x0, b.x1 - s.w), ay = settle(ax); if (!hits(ax, ay)) { x = ax; y = ay; side = -side; } }
      y = clamp(y, b.y0, b.y1 - s.h);
      placed.push({ x, y, w: s.w, h: s.h });
      if (s.lx == null || still) { s.lx = x; s.ly = y; } else { s.lx += (x - s.lx) * .5; s.ly += (y - s.ly) * .5; }
      const tf = `translate(${Math.round(s.lx * 2) / 2}px,${Math.round(s.ly * 2) / 2}px)`;
      if (tf !== s._tf) { s.el.style.transform = tf; s._tf = tf; }
      const vis = s.vis == null ? 1 : s.vis;
      if (s._vis !== vis) { s.el.style.setProperty('--vis', vis.toFixed(2)); s._vis = vis; }
      const lt = side < 0; if (lt !== s._lt) { s.el.classList.toggle('lt', lt); s._lt = lt; }
      s.anchor = { x: side < 0 ? s.lx + s.w : s.lx, y: s.ly + Math.min(15, s.h / 2) };
    }
  }
  // Thin line from each point to its label when they drift apart.
  function tethers(ctx, items, style) {
    for (const s of items) { if (!s.anchor) continue; if (Math.hypot(s.anchor.x - s.x, s.anchor.y - s.y) < 24) continue; ctx.strokeStyle = typeof style === 'function' ? style(s) : (style || 'rgba(255,255,255,.12)'); ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.anchor.x, s.anchor.y); ctx.stroke(); }
  }

  /* ---------- hash router ---------- */
  // FX.route.get() -> {k:v}; FX.route.set({k:v}, replace); FX.route.on(fn). Values are strings.
  const route = (() => {
    const fns = [];
    const parse = () => { const o = {}; location.hash.replace(/^#/, '').split('&').filter(Boolean).forEach(p => { const i = p.indexOf('='); const k = decodeURIComponent(i < 0 ? p : p.slice(0, i)); o[k] = i < 0 ? '' : decodeURIComponent(p.slice(i + 1)); }); return o; };
    const build = o => '#' + Object.keys(o).filter(k => o[k] != null && o[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
    addEventListener('hashchange', () => { const s = parse(); fns.forEach(f => f(s)); });
    return {
      get: parse,
      set(o, replace) { const h = build(o); if (h === location.hash || (h === '#' && !location.hash)) return; if (replace) history.replaceState(null, '', h === '#' ? location.pathname + location.search : h); else location.hash = h; if (replace) { const s = parse(); fns.forEach(f => f(s)); } },
      patch(o, replace) { this.set(Object.assign(parse(), o), replace); },
      on(fn) { fns.push(fn); }
    };
  })();

  /* ---------- Ctrl+K search palette ---------- */
  // FX.search({ placeholder, items: () => [{ group, title, sub, keywords, go() }], accent })
  function search(opts) {
    css();
    const box = document.createElement('div'); box.className = 'fx-sd'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Buscar');
    box.innerHTML = `<div class="fx-sbox"><div class="fx-sin"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="text" autocomplete="off" spellcheck="false" aria-label="Buscar" placeholder="${esc(opts.placeholder || 'Buscar')}"><kbd>Esc</kbd></div><ul class="fx-sres" role="listbox"></ul></div>`;
    if (opts.accent) box.style.setProperty('--fx-accent', opts.accent);
    document.body.appendChild(box);
    const input = box.querySelector('input'), list = box.querySelector('ul');
    let res = [], sel = 0, ret = null;
    function run(q) {
      const n = norm(q), all = opts.items();
      res = (n ? all.filter(it => norm(it.title + ' ' + (it.sub || '') + ' ' + (it.keywords || '') + ' ' + (it.group || '')).includes(n)) : all).slice(0, 40);
      sel = 0; let html = '', g = null;
      res.forEach((it, i) => { if (it.group && it.group !== g) { g = it.group; html += `<li class="fx-grp" aria-hidden="true">${esc(g)}</li>`; } html += `<li role="option" data-i="${i}" aria-selected="${i === 0}"><span class="fx-st">${esc(it.title)}</span>${it.sub ? `<span class="fx-sf">${esc(it.sub)}</span>` : ''}</li>`; });
      list.innerHTML = html || '<li class="fx-grp">Nada encontrado</li>';
    }
    function pick(i) { const it = res[i]; if (!it) return; close(false); it.go(); }
    function select(i) { if (!res.length) return; sel = (i + res.length) % res.length; list.querySelectorAll('[role=option]').forEach(li => li.setAttribute('aria-selected', String(+li.dataset.i === sel))); const el = list.querySelector(`[data-i="${sel}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
    function open() { ret = document.activeElement; box.classList.add('on'); input.value = ''; run(''); input.focus(); }
    function close(restore) { box.classList.remove('on'); if (restore && ret && document.contains(ret)) ret.focus(); }
    input.addEventListener('input', () => run(input.value));
    list.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) pick(+li.dataset.i); });
    box.addEventListener('click', e => { if (e.target === box) close(true); });
    addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); box.classList.contains('on') ? close(true) : open(); return; }
      if (!box.classList.contains('on')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); select(sel + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); select(sel - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); pick(sel); }
    }, true);
    return { open, close, get isOpen() { return box.classList.contains('on'); } };
  }

  /* ---------- hint: "arraste para girar · role para aproximar", gone after first interaction ---------- */
  let hintEl = null, wasTouched = false;
  // Command hints are off by request: pages call FX.hint() but nothing is shown.
  function hint(text) { return; css(); hintEl = document.createElement('div'); hintEl.className = 'fx-hint'; hintEl.setAttribute('aria-hidden', 'true'); hintEl.textContent = text; document.body.appendChild(hintEl); requestAnimationFrame(() => { if (!wasTouched) hintEl.classList.add('on'); }); }
  function touched() { if (wasTouched) return; wasTouched = true; if (hintEl) hintEl.classList.remove('on'); }

  /* ---------- reveal: open a panel with a short slide + fade ---------- */
  // FX.reveal(el, x, y, on). x/y are kept for compatibility (origin of the opening); the motion is a slide+fade
  // that stays smooth while a camera is flying (the old clip-path circle read as a glitchy wipe).
  function reveal(el, x, y, on) {
    css();
    el.classList.add('fx-reveal');
    if (x != null) { const r = el.getBoundingClientRect(); el.style.setProperty('--ox', (x - r.left) + 'px'); el.style.setProperty('--oy', (y - r.top) + 'px'); }
    el.classList.toggle('fx-on', !!on);
  }

  /* ---------- count-up for numbers ---------- */
  function countUp(el, to, dur) { if (still) { el.textContent = to; return; } const from = +el.textContent || 0, t0 = performance.now(); const step = t => { const u = Math.min(1, (t - t0) / (dur || 600)); el.textContent = Math.round(from + (to - from) * ease(u)); if (u < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }

  /* ---------- base CSS for the shared widgets ---------- */
  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    const s = document.createElement('style');
    s.textContent = `
.fx-sd{position:fixed;inset:0;z-index:90;display:none;align-items:flex-start;justify-content:center;padding:12vh 16px 16px;background:rgba(3,4,7,.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.fx-sd.on{display:flex;animation:fxIn 180ms ease-out}
.fx-sbox{width:min(640px,100%);max-height:70vh;display:flex;flex-direction:column;border-radius:14px;background:#0a0d14;border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden;font-family:'Space Grotesk',system-ui,sans-serif;color:#eceff4}
.fx-sin{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);color:var(--fx-accent,#7c9dff)}
.fx-sin input{flex:1;background:transparent;border:0;outline:0;color:#eceff4;font:inherit;font-size:15px}
.fx-sin kbd{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#808a9a;border:1px solid rgba(255,255,255,.15);border-radius:5px;padding:2px 6px}
.fx-sres{list-style:none;margin:0;padding:6px;overflow:auto}
.fx-sres li[role=option]{display:flex;flex-direction:column;gap:2px;padding:9px 12px;border-radius:8px;cursor:pointer}
.fx-sres li[aria-selected=true]{background:rgba(255,255,255,.05);box-shadow:inset 2px 0 0 var(--fx-accent,#7c9dff)}
.fx-st{font-size:14px;line-height:1.4}
.fx-sf{font-size:12px;color:#808a9a}
.fx-grp{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#808a9a;padding:10px 12px 4px;letter-spacing:.12em;text-transform:uppercase}
.fx-hint{position:fixed;left:50%;bottom:22px;transform:translate(-50%,6px);font:12px 'Space Grotesk',system-ui,sans-serif;color:#808a9a;letter-spacing:.02em;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 600ms,transform 600ms;z-index:5}
.fx-hint.on{opacity:1;transform:translate(-50%,0)}
.fx-reveal{opacity:0;translate:32px 0;visibility:hidden;pointer-events:none;transition:opacity 260ms ease-in,translate 320ms cubic-bezier(.5,0,.75,0),visibility 0s linear 320ms}
.fx-reveal.fx-on{opacity:1;translate:0 0;visibility:visible;pointer-events:auto;transition:opacity 420ms ease-out 80ms,translate 560ms cubic-bezier(.16,1,.3,1) 80ms,visibility 0s}
.fx-dragging{cursor:grabbing!important}
textarea:focus,textarea:focus-visible,input:not([type=checkbox]):not([type=radio]):focus,input:not([type=checkbox]):not([type=radio]):focus-visible{outline:none!important}
.fx-idle *,.fx-idle *::before,.fx-idle *::after{animation-play-state:paused!important}
@keyframes fxIn{from{opacity:0}to{opacity:1}}
@keyframes fxRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.fx-reveal,.fx-reveal.fx-on{transition:none}.fx-sd.on{animation:none}}`;
    document.head.appendChild(s);
  }

  css();
  window.FX = { still, TAU, ease, clamp, lerp, wrapAngle, esc, norm, rng, gauss, mouse, stage, dust, sky, glow, hexRgb, cam2d, orbit, bindDrag, labels, tethers, route, search, hint, touched, reveal, countUp, invalidate: invalidateAll, css, active: () => active, eco: () => performance.now() - lastInput > ECO_AFTER };
})();
