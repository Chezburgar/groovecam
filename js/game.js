// Game loop: plays the song, scrolls the move chart toward a hit ring,
// scores the player's pose via the camera, and reports results.
import { poseFeatures, makeIconCanvas } from './moves.js';
import { detectPose, drawCameraFrame } from './pose.js';

const WINDOW_BEFORE = 0.55;  // seconds before the beat a move starts being judged
const WINDOW_AFTER = 0.45;   // seconds after
const APPROACH_TIME = 2.6;   // seconds a move is visible before its beat
const ICON_SIZE = 92;

const GRADES = [
  { key: 'perfect', label: 'PERFECT!', min: 0.8, pts: 100, color: '#ffd23d' },
  { key: 'great',   label: 'GREAT',    min: 0.5, pts: 70,  color: '#4dff88' },
  { key: 'ok',      label: 'OK',       min: 0.25, pts: 40, color: '#29e6ff' },
  { key: 'miss',    label: 'MISS',     min: -1,  pts: 0,   color: '#ff6b6b' },
];

export function runGame(opts) {
  const { audioCtx, buffer, chart, video, baseline, canvas, bpm, hud, onEnd } = opts;
  const ctx2d = canvas.getContext('2d');
  const detectCtx = { baseline };

  const icons = {};
  for (const { move } of chart) {
    if (!icons[move.id]) icons[move.id] = makeIconCanvas(move, ICON_SIZE, '#ffffff');
  }

  // per-note runtime state
  const notes = chart.map(n => ({ ...n, best: 0, graded: null, gradedAt: 0 }));
  const state = {
    score: 0, combo: 0, maxCombo: 0,
    counts: { perfect: 0, great: 0, ok: 0, miss: 0 },
    popups: [], running: true, startedAt: 0, source: null, raf: 0,
  };

  function resize() {
    canvas.width = canvas.clientWidth || window.innerWidth;
    canvas.height = canvas.clientHeight || window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // ---- audio ----
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  state.source = source;
  const startAt = audioCtx.currentTime + 0.06;
  source.start(startAt);
  state.startedAt = startAt;
  let ended = false;
  source.onended = () => { ended = true; };

  const songTime = () => audioCtx.currentTime - state.startedAt;

  function grade(note, now) {
    let g = GRADES[3];
    for (const cand of GRADES) { if (note.best >= cand.min) { g = cand; break; } }
    note.graded = g;
    note.gradedAt = now;
    state.counts[g.key]++;
    if (g.key === 'miss') {
      state.combo = 0;
    } else {
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      const mult = 1 + Math.min(state.combo, 30) * 0.033;
      state.score += Math.round(g.pts * mult);
    }
    state.popups.push({ text: g.label, color: g.color, t0: now });
    hud.score.textContent = state.score.toLocaleString();
    hud.combo.textContent = state.combo;
    hud.comboWrap.hidden = state.combo < 3;
  }

  function frame() {
    if (!state.running) return;
    const now = songTime();
    const w = canvas.width, h = canvas.height;

    // ---- pose ----
    const lm = detectPose(video, performance.now());
    const feats = lm ? poseFeatures(lm) : null;

    // ---- judge active notes ----
    for (const note of notes) {
      if (note.graded) continue;
      const dt = now - note.time;
      if (dt >= -WINDOW_BEFORE && dt <= WINDOW_AFTER && feats) {
        const timing = Math.abs(dt) <= 0.25 ? 1 : 0.75;
        note.best = Math.max(note.best, note.move.detect(feats, detectCtx) * timing);
      }
      if (dt > WINDOW_AFTER) grade(note, now);
    }

    // ---- draw ----
    drawCameraFrame(ctx2d, video, lm, { color: 'rgba(41,230,255,0.9)', lineWidth: Math.max(4, w * 0.004) });

    // darken top band for the lane
    const laneY = Math.max(78, h * 0.11);
    const grad = ctx2d.createLinearGradient(0, 0, 0, laneY * 2);
    grad.addColorStop(0, 'rgba(5,5,15,0.82)');
    grad.addColorStop(1, 'rgba(5,5,15,0)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, w, laneY * 2);

    // hit ring (pulses on the beat)
    const hitX = Math.max(110, w * 0.18);
    const beatPhase = ((now % (60 / bpm)) / (60 / bpm));
    const pulse = 1 + 0.1 * Math.max(0, 1 - beatPhase * 3);
    ctx2d.strokeStyle = 'rgba(255,61,129,0.95)';
    ctx2d.lineWidth = 5;
    ctx2d.beginPath();
    ctx2d.arc(hitX, laneY, (ICON_SIZE / 2 + 12) * pulse, 0, Math.PI * 2);
    ctx2d.stroke();

    // notes sliding right -> left toward the ring
    const speed = (w - hitX) / APPROACH_TIME;
    for (const note of notes) {
      const dt = note.time - now;
      if (dt > APPROACH_TIME + 0.5) break;
      const x = hitX + dt * speed;
      if (x < -ICON_SIZE) continue;

      const icon = icons[note.move.id];
      let alpha = 1, scale = 1;
      if (note.graded) {
        const age = now - note.gradedAt;
        if (age > 0.4) continue;
        alpha = 1 - age / 0.4;
        scale = 1 + age * 0.8;
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.shadowColor = note.graded.color;
        ctx2d.shadowBlur = 30;
        const s = ICON_SIZE * scale;
        ctx2d.drawImage(icon, hitX - s / 2, laneY - s / 2, s, s);
        ctx2d.restore();
        continue;
      }
      // grow slightly as it approaches
      scale = dt < 0.6 ? 1.15 : 1;
      const s = ICON_SIZE * scale;
      ctx2d.save();
      if (Math.abs(dt) < WINDOW_BEFORE) { ctx2d.shadowColor = '#29e6ff'; ctx2d.shadowBlur = 22; }
      ctx2d.drawImage(icon, x - s / 2, laneY - s / 2, s, s);
      ctx2d.restore();

      // label under the imminent move
      if (dt < 1.4 && dt > -WINDOW_AFTER) {
        ctx2d.font = `700 ${Math.max(15, w * 0.014)}px "Segoe UI", sans-serif`;
        ctx2d.fillStyle = '#fff';
        ctx2d.textAlign = 'center';
        ctx2d.shadowColor = 'rgba(0,0,0,0.9)';
        ctx2d.shadowBlur = 8;
        ctx2d.fillText(note.move.name, x, laneY + ICON_SIZE / 2 + 26);
        ctx2d.shadowBlur = 0;
      }
    }

    // judgement popups
    for (let i = state.popups.length - 1; i >= 0; i--) {
      const p = state.popups[i];
      const age = now - p.t0;
      if (age > 0.8) { state.popups.splice(i, 1); continue; }
      const a = 1 - age / 0.8;
      ctx2d.save();
      ctx2d.globalAlpha = a;
      ctx2d.font = `900 ${Math.max(34, w * 0.038)}px "Segoe UI", sans-serif`;
      ctx2d.textAlign = 'center';
      ctx2d.fillStyle = p.color;
      ctx2d.shadowColor = p.color;
      ctx2d.shadowBlur = 24;
      ctx2d.fillText(p.text, hitX + 30, laneY + ICON_SIZE + 80 - age * 50);
      ctx2d.restore();
    }

    // "no body" warning
    if (!lm) {
      ctx2d.font = `700 ${Math.max(18, w * 0.018)}px "Segoe UI", sans-serif`;
      ctx2d.textAlign = 'center';
      ctx2d.fillStyle = '#ff6b6b';
      ctx2d.shadowColor = 'rgba(0,0,0,0.9)';
      ctx2d.shadowBlur = 8;
      ctx2d.fillText("Can't see you! Step back into frame", w / 2, h - 60);
      ctx2d.shadowBlur = 0;
    }

    hud.progress.style.width = `${Math.min(100, (now / buffer.duration) * 100)}%`;

    // ---- end condition ----
    const lastNote = notes[notes.length - 1];
    const allDone = notes.every(n => n.graded);
    if (ended || now > buffer.duration + 0.3 || (allDone && lastNote && now > lastNote.time + 1.5)) {
      finish();
      return;
    }
    state.raf = requestAnimationFrame(frame);
  }

  function finish() {
    if (!state.running) return;
    state.running = false;
    window.removeEventListener('resize', resize);
    try { source.onended = null; source.stop(); } catch { /* already stopped */ }
    // any un-graded notes count as played-through misses only if their window passed
    const total = state.counts.perfect + state.counts.great + state.counts.ok + state.counts.miss;
    const quality = total
      ? (state.counts.perfect + state.counts.great * 0.7 + state.counts.ok * 0.4) / total
      : 0;
    onEnd({ ...state.counts, score: state.score, maxCombo: state.maxCombo, quality, total });
  }

  state.raf = requestAnimationFrame(frame);

  return {
    stop() { // user quit — tear down without results
      if (!state.running) return;
      state.running = false;
      cancelAnimationFrame(state.raf);
      window.removeEventListener('resize', resize);
      try { source.onended = null; source.stop(); } catch { /* already stopped */ }
    },
  };
}
