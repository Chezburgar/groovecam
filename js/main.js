// App flow: setup -> analyzing -> ready/calibration -> game -> results
import { analyzeBuffer } from './analyzer.js';
import { generateChoreography } from './choreo.js';
import { loadPoseModel, startCamera, stopCamera, detectPose, drawCameraFrame } from './pose.js';
import { poseFeatures } from './moves.js';
import { runGame } from './game.js';

const $ = id => document.getElementById(id);
const screens = ['setup', 'analyzing', 'ready', 'game', 'results'];

function show(name) {
  for (const s of screens) $(`screen-${s}`).classList.toggle('active', s === name);
}

// ---------- app state ----------
const app = {
  audioCtx: null,
  buffer: null,
  analysis: null,
  chart: null,
  difficulty: 'normal',
  songName: '',
  video: null,
  baseline: null,
  calRaf: 0,
  game: null,
};

// Warm the pose model in the background right away.
loadPoseModel().catch(() => { /* retried when actually needed */ });

// ---------- setup screen ----------
const fileInput = $('file-input');
const dropZone = $('drop-zone');

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    app.difficulty = btn.dataset.diff;
  });
});

fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
});
['dragover', 'dragenter'].forEach(ev =>
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(ev =>
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
dropZone.addEventListener('drop', e => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) handleFile(f);
});

function setupError(msg) {
  const el = $('setup-error');
  el.textContent = msg;
  el.hidden = false;
  show('setup');
}

async function handleFile(file) {
  $('setup-error').hidden = true;
  show('analyzing');
  $('analyze-status').textContent = 'Listening to your song…';
  $('analyze-detail').textContent = file.name;

  try {
    if (!app.audioCtx) app.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Don't await: resume() only resolves after a user gesture, and decoding
    // works while suspended. The real resume happens on the Start click.
    if (app.audioCtx.state === 'suspended') app.audioCtx.resume().catch(() => {});

    const bytes = await file.arrayBuffer();
    await nextFrame();
    app.buffer = await app.audioCtx.decodeAudioData(bytes);

    if (app.buffer.duration < 15) {
      return setupError('That song is under 15 seconds — pick something longer to dance to!');
    }

    await nextFrame();
    app.analysis = analyzeBuffer(app.buffer, (p, msg) => { $('analyze-status').textContent = msg; });
    app.chart = generateChoreography(app.analysis, app.difficulty);
    app.songName = file.name.replace(/\.[^.]+$/, '');

    if (app.chart.length < 4) {
      return setupError("Couldn't find a danceable beat in that file — try another song!");
    }

    await enterReady();
  } catch (err) {
    console.error(err);
    setupError("Couldn't read that file as audio. Try an MP3, WAV, or OGG.");
  } finally {
    fileInput.value = '';
  }
}

// setTimeout (not rAF) so analysis still proceeds in throttled/background tabs
const nextFrame = () => new Promise(r => setTimeout(r, 40));

// ---------- ready / calibration screen ----------
async function enterReady() {
  show('ready');
  $('song-title').textContent = app.songName;
  $('stat-bpm').textContent = Math.round(app.analysis.bpm);
  $('stat-moves').textContent = app.chart.length;
  const d = app.buffer.duration;
  $('stat-length').textContent = `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}`;

  const btn = $('btn-start');
  btn.disabled = true;
  btn.textContent = 'Detecting your body…';
  const camStatus = $('cam-status');
  camStatus.className = 'cam-status';
  camStatus.textContent = 'Starting camera…';

  try {
    await loadPoseModel();
    if (!app.video) app.video = await startCamera();
  } catch (err) {
    console.error(err);
    camStatus.textContent = err && err.name === 'NotAllowedError'
      ? '🚫 Camera blocked — allow camera access and reload'
      : '🚫 Camera unavailable on this device';
    return;
  }

  // calibration loop: need head + hips visible for ~1.2 s
  const canvas = $('ready-canvas');
  let goodFrames = 0;
  const hipSamples = [];
  const torsoSamples = [];

  cancelAnimationFrame(app.calRaf);
  const tick = () => {
    if (!$('screen-ready').classList.contains('active')) return;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    const lm = detectPose(app.video, performance.now());
    drawCameraFrame(canvas.getContext('2d'), app.video, lm, { color: 'rgba(77,255,136,0.9)', lineWidth: 4 });

    const visible = lm &&
      [0, 11, 12, 23, 24].every(i => lm[i] && (lm[i].visibility ?? 1) > 0.6);
    if (visible) {
      const f = poseFeatures(lm);
      goodFrames++;
      hipSamples.push(f.hipMid.y);
      torsoSamples.push(f.torso);
      if (hipSamples.length > 60) { hipSamples.shift(); torsoSamples.shift(); }
      camStatus.textContent = goodFrames < 35 ? '👀 Found you! Hold still…' : '✅ Ready to dance!';
      camStatus.className = goodFrames < 35 ? 'cam-status' : 'cam-status good';
      if (goodFrames >= 35 && btn.disabled) {
        const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        app.baseline = { hipY: avg(hipSamples), torso: avg(torsoSamples) };
        btn.disabled = false;
        btn.textContent = "▶ Let's Dance!";
      }
    } else {
      goodFrames = 0;
      camStatus.className = 'cam-status';
      camStatus.textContent = '↔ Step back — head and hips need to be in frame';
    }
    app.calRaf = requestAnimationFrame(tick);
  };
  app.calRaf = requestAnimationFrame(tick);
}

$('btn-back').addEventListener('click', () => {
  cancelAnimationFrame(app.calRaf);
  stopCamera(app.video);
  app.video = null;
  show('setup');
});

// ---------- game ----------
$('btn-start').addEventListener('click', startGame);

async function startGame() {
  cancelAnimationFrame(app.calRaf);
  show('game');
  const canvas = $('game-canvas');
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  $('hud-score').textContent = '0';
  $('hud-combo-wrap').hidden = true;
  $('progress-fill').style.width = '0%';

  if (app.audioCtx.state === 'suspended') await app.audioCtx.resume();

  // keep camera warm during the countdown
  const cd = $('countdown');
  cd.hidden = false;
  const warm = setInterval(() => detectPose(app.video, performance.now()), 100);
  for (const n of ['3', '2', '1', 'GO!']) {
    cd.textContent = n;
    await new Promise(r => setTimeout(r, n === 'GO!' ? 500 : 800));
  }
  clearInterval(warm);
  cd.hidden = true;

  app.game = runGame({
    audioCtx: app.audioCtx,
    buffer: app.buffer,
    chart: app.chart,
    video: app.video,
    baseline: app.baseline,
    bpm: app.analysis.bpm,
    canvas,
    hud: {
      score: $('hud-score'),
      combo: $('hud-combo'),
      comboWrap: $('hud-combo-wrap'),
      progress: $('progress-fill'),
    },
    onEnd: showResults,
  });
}

$('btn-quit').addEventListener('click', () => {
  if (app.game) app.game.stop();
  app.game = null;
  enterReady();
});

// ---------- results ----------
const RANKS = [
  { min: 0.92, rank: 'S', headline: 'DANCE MACHINE! 🔥' },
  { min: 0.8,  rank: 'A', headline: 'You crushed it!' },
  { min: 0.65, rank: 'B', headline: 'Solid moves!' },
  { min: 0.45, rank: 'C', headline: 'Getting warmed up!' },
  { min: -1,   rank: 'D', headline: 'The dance floor awaits…' },
];

function showResults(res) {
  app.game = null;
  const r = RANKS.find(r => res.quality >= r.min);
  $('result-rank').textContent = r.rank;
  $('result-headline').textContent = r.headline;
  $('result-score').textContent = res.score.toLocaleString();
  $('r-perfect').textContent = res.perfect;
  $('r-great').textContent = res.great;
  $('r-ok').textContent = res.ok;
  $('r-miss').textContent = res.miss;
  $('r-maxcombo').textContent = res.maxCombo;
  show('results');
}

$('btn-replay').addEventListener('click', () => enterReady());
$('btn-newsong').addEventListener('click', () => {
  stopCamera(app.video);
  app.video = null;
  show('setup');
});
