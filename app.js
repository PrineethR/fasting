'use strict';

/* ════════════════════════════════════════════════════
   FAST — App Logic
   ════════════════════════════════════════════════════ */

// ── Dial geometry constants ───────────────────────────
const DCX = 110, DCY = 95, DR = 80;        // dial center x/y, radius
const D_MIN = 12, D_MAX = 23;              // min/max fasting hours
const D_RANGE = D_MAX - D_MIN;             // = 11 steps
const D_START = 240;                       // degrees from top, clockwise (8 o'clock)
const D_SWEEP = 240;                       // total arc sweep in degrees
const D_END   = (D_START + D_SWEEP) % 360; // = 120° (4 o'clock)

// Ring constants (must match CSS --ring-circum)
const RING_R      = 118;
const RING_CIRCUM = 2 * Math.PI * RING_R;  // ≈ 741.42

// ── State ─────────────────────────────────────────────
let S = {
  hours:     16,
  fastStart: null,   // Date.now() ms, null if not fasting
  isFasting: false,
  streak:    0,
  lastDate:  null    // ISO date string of last completed fast
};

let ticker = null;
let dragging = false;

// ── DOM refs ──────────────────────────────────────────
const $app        = document.getElementById('app');
const $ringFill   = document.getElementById('ringFill');
const $ringDot    = document.getElementById('ringDot');
const $ringTime   = document.getElementById('ringTime');
const $ringStatus = document.getElementById('ringStatus');
const $ringSub    = document.getElementById('ringSub');
const $ringTicks  = document.getElementById('ringTicks');
const $dialSvg    = document.getElementById('dialSvg');
const $dialTrack  = document.getElementById('dialTrack');
const $dialActive = document.getElementById('dialActive');
const $dialTicks  = document.getElementById('dialTicks');
const $dialKnob   = document.getElementById('dialKnob');
const $dialFastH  = document.getElementById('dialFastHours');
const $dialEatH   = document.getElementById('dialEatHours');
const $ctaBtn     = document.getElementById('ctaBtn');
const $ctaLabel   = document.getElementById('ctaLabel');
const $ctaSub     = document.getElementById('ctaSub');
const $streak     = document.getElementById('streakBadge');

// ── Geometry helpers ──────────────────────────────────

/** Convert angle (degrees clockwise from top) to SVG {x, y} */
function polar(cx, cy, r, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Build SVG arc path string (clockwise) */
function arcPath(cx, cy, r, startDeg, sweepDeg) {
  if (Math.abs(sweepDeg) < 0.5) return '';
  const s   = polar(cx, cy, r, startDeg);
  const eDeg = (startDeg + sweepDeg) % 360;
  const e   = polar(cx, cy, r, eDeg);
  const lg  = sweepDeg > 180 ? 1 : 0;
  return `M ${f(s.x)} ${f(s.y)} A ${r} ${r} 0 ${lg} 1 ${f(e.x)} ${f(e.y)}`;
}

/** Hours → dial angle (degrees from top, clockwise) */
function h2a(hours) {
  const t = (hours - D_MIN) / D_RANGE;
  return (D_START + t * D_SWEEP) % 360;
}

/** Dial angle → hours (returns null if outside valid arc) */
function a2h(deg) {
  let d = deg;
  if (d < D_END) d += 360;        // wrap: 0–120 → 360–480
  if (d < D_START || d > D_START + D_SWEEP) return null;
  const t = (d - D_START) / D_SWEEP;
  return Math.max(D_MIN, Math.min(D_MAX, Math.round(D_MIN + t * D_RANGE)));
}

/** Angle of pointer from dial center given a pointer event */
function eventAngle(e) {
  const rect = $dialSvg.getBoundingClientRect();
  const pt   = e.touches ? e.touches[0] : e;
  const sx   = (pt.clientX - rect.left) / rect.width  * 220;  // viewBox W
  const sy   = (pt.clientY - rect.top)  / rect.height * 148;  // viewBox H
  const dx   = sx - DCX, dy = sy - DCY;
  const math = Math.atan2(dy, dx) * 180 / Math.PI;
  return (math + 90 + 360) % 360;  // to "from top, CW"
}

const f = n => n.toFixed(2);
const pad = n => String(n).padStart(2, '0');

function fmtMs(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── Render: Dial ──────────────────────────────────────

function renderDial() {
  // Track (full arc)
  $dialTrack.setAttribute('d', arcPath(DCX, DCY, DR, D_START, D_SWEEP));

  // Active arc (start → current hours)
  const knobDeg = h2a(S.hours);
  let activeSweep = ((knobDeg - D_START) % 360 + 360) % 360;
  const activePath = activeSweep > 1 ? arcPath(DCX, DCY, DR, D_START, activeSweep) : '';
  $dialActive.setAttribute('d', activePath);

  // Knob position + rotation
  const kp = polar(DCX, DCY, DR, knobDeg);
  $dialKnob.setAttribute('transform', `translate(${f(kp.x)},${f(kp.y)}) rotate(${f(knobDeg)})`);

  // Ticks + labels
  renderDialTicks(knobDeg);

  // Display text
  $dialFastH.textContent = S.hours;
  $dialEatH.textContent  = 24 - S.hours;
}

function renderDialTicks(knobDeg) {
  $dialTicks.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';

  for (let h = D_MIN; h <= D_MAX; h++) {
    const ang      = h2a(h);
    const isActive = h === S.hours;
    const isMajor  = h % 2 === 0;

    // Tick line
    const inner = polar(DCX, DCY, DR - 13, ang);
    const outer = polar(DCX, DCY, DR + 3,  ang);
    const line  = document.createElementNS(ns, 'line');
    line.setAttribute('x1', f(inner.x)); line.setAttribute('y1', f(inner.y));
    line.setAttribute('x2', f(outer.x)); line.setAttribute('y2', f(outer.y));
    line.setAttribute('stroke-width', isActive ? '2.5' : isMajor ? '1.5' : '1');
    line.setAttribute('opacity',      isActive ? '0.9' : isMajor ? '0.35' : '0.18');
    $dialTicks.appendChild(line);

    // Label (every other hour + endpoints)
    if (isMajor || h === D_MIN || h === D_MAX) {
      const lp   = polar(DCX, DCY, DR + 17, ang);
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', f(lp.x));
      text.setAttribute('y', f(lp.y));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size',   isActive ? '8.5' : '7');
      text.setAttribute('font-weight', isActive ? '700' : '400');
      text.setAttribute('opacity',     isActive ? '0.95' : '0.45');
      text.textContent = h;
      $dialTicks.appendChild(text);
    }
  }
}

// ── Render: Ring ──────────────────────────────────────

function renderRing(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  const offset  = RING_CIRCUM * (1 - clamped);
  $ringFill.style.strokeDashoffset = offset;

  // Traveling dot
  const deg = clamped * 360;
  const dp  = polar(150, 150, RING_R, deg); // ring center = SVG center (150,150)
  $ringDot.setAttribute('cx', f(dp.x));
  $ringDot.setAttribute('cy', f(dp.y));
}

function buildRingTicks() {
  $ringTicks.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  for (let i = 0; i < 48; i++) {
    const deg    = i * (360 / 48);
    const major  = i % 4 === 0;
    const inner  = polar(150, 150, RING_R - (major ? 9 : 5),  deg);
    const outer  = polar(150, 150, RING_R + (major ? 2 : 1),  deg);
    const line   = document.createElementNS(ns, 'line');
    line.setAttribute('x1', f(inner.x)); line.setAttribute('y1', f(inner.y));
    line.setAttribute('x2', f(outer.x)); line.setAttribute('y2', f(outer.y));
    if (major) line.classList.add('major');
    $ringTicks.appendChild(line);
  }
}

// ── Full UI refresh ───────────────────────────────────

function refresh() {
  const now    = Date.now();
  const goal   = S.hours * 3600 * 1000;

  // Remove state classes
  $app.classList.remove('state-idle', 'state-fasting', 'state-complete');

  if (!S.isFasting) {
    $app.classList.add('state-idle');
    renderRing(0);
    $ringTime.textContent   = `${S.hours}:00:00`;
    $ringStatus.textContent = 'READY';
    $ringSub.textContent    = 'SET YOUR WINDOW';
    $ctaLabel.textContent   = 'START FAST';
    $ctaSub.textContent     = `${S.hours}H FAST / ${24 - S.hours}H EAT`;
    $ringFill.style.stroke  = '';
    $ringDot.style.fill     = '';

  } else {
    const elapsed  = now - S.fastStart;
    const progress = elapsed / goal;

    if (progress >= 1) {
      $app.classList.add('state-complete');
      renderRing(1);
      $ringFill.style.stroke = 'var(--yellow)';
      $ringDot.style.fill    = 'var(--yellow)';
      $ringTime.textContent   = fmtMs(elapsed);
      $ringStatus.textContent = 'COMPLETE!';
      $ringSub.textContent    = `${S.hours}H WINDOW DONE`;
      $ctaLabel.textContent   = 'END FAST';
      $ctaSub.textContent     = `WELL DONE — ${fmtMs(elapsed)} TOTAL`;

    } else {
      $app.classList.add('state-fasting');
      renderRing(progress);
      $ringFill.style.stroke = '';
      $ringDot.style.fill    = '';
      $ringTime.textContent   = fmtMs(elapsed);
      $ringStatus.textContent = 'FASTING';
      const rem = goal - elapsed;
      const rh  = Math.floor(rem / 3600000);
      const rm  = Math.floor((rem % 3600000) / 60000);
      $ringSub.textContent   = `${rh}H ${pad(rm)}M REMAINING`;
      $ctaLabel.textContent  = 'END FAST';
      $ctaSub.textContent    = `STARTED ${formatStartTime(S.fastStart)}`;
    }
  }

  // Streak
  $streak.textContent = S.streak > 0 ? `${S.streak} DAY STREAK` : '— —';
}

function formatStartTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${pad(m)} ${ampm}`;
}

// ── Actions ───────────────────────────────────────────

function startFast() {
  S.isFasting  = true;
  S.fastStart  = Date.now();
  save();
  tick();
  if (navigator.vibrate) navigator.vibrate([25, 10, 25]);
}

function endFast() {
  if (S.isFasting) {
    const elapsed = Date.now() - S.fastStart;
    const goal    = S.hours * 3600 * 1000;
    if (elapsed >= goal * 0.75) checkStreak();  // ≥75% complete counts
  }
  S.isFasting = false;
  S.fastStart = null;
  stopTick();
  save();
  refresh();
  renderDial();
  if (navigator.vibrate) navigator.vibrate(40);
}

function checkStreak() {
  const today = todayISO();
  if (S.lastDate === today) return;                           // already counted today
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  S.streak    = S.lastDate === yest ? S.streak + 1 : 1;
  S.lastDate  = today;
}

// ── Ticker ────────────────────────────────────────────

function tick() {
  if (ticker) clearInterval(ticker);
  refresh();
  ticker = setInterval(refresh, 1000);
}

function stopTick() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

// ── Persistence ───────────────────────────────────────

function save() {
  try { localStorage.setItem('fast_v2', JSON.stringify(S)); } catch (_) {}
}

function load() {
  try {
    const raw = localStorage.getItem('fast_v2');
    if (raw) S = { ...S, ...JSON.parse(raw) };
  } catch (_) {}
}

// ── Dial interaction ──────────────────────────────────

function onDialInput(e) {
  if (S.isFasting) return;
  e.preventDefault();
  const deg   = eventAngle(e);
  const hours = a2h(deg);
  if (hours !== null && hours !== S.hours) {
    S.hours = hours;
    renderDial();
    refresh();
    if (navigator.vibrate) navigator.vibrate(4);
  }
}

$dialSvg.addEventListener('mousedown',  e => { dragging = true; onDialInput(e); });
$dialSvg.addEventListener('touchstart', e => { dragging = true; onDialInput(e); }, { passive: false });

window.addEventListener('mousemove',  e => { if (dragging) onDialInput(e); });
window.addEventListener('touchmove',  e => { if (dragging) onDialInput(e); }, { passive: false });

window.addEventListener('mouseup',  () => { dragging = false; });
window.addEventListener('touchend', () => { dragging = false; });
window.addEventListener('touchcancel', () => { dragging = false; });

// ── CTA button ────────────────────────────────────────

$ctaBtn.addEventListener('click', () => {
  S.isFasting ? endFast() : startFast();
});

// ── Keyboard shortcuts ────────────────────────────────
window.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    S.isFasting ? endFast() : startFast();
  }
  if (!S.isFasting) {
    if (e.code === 'ArrowRight' || e.code === 'ArrowUp')   { S.hours = Math.min(D_MAX, S.hours + 1); renderDial(); refresh(); }
    if (e.code === 'ArrowLeft'  || e.code === 'ArrowDown') { S.hours = Math.max(D_MIN, S.hours - 1); renderDial(); refresh(); }
  }
});

// ── Visibility change (tab switch / lock screen) ──────
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.isFasting && !ticker) tick();
});

// ── Init ──────────────────────────────────────────────

load();
buildRingTicks();
renderDial();
refresh();
if (S.isFasting) tick();

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
