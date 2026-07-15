// Audio analysis: beat detection, BPM estimation, and energy profiling.
// Runs entirely in the browser on the decoded AudioBuffer.

const TARGET_SR = 11025;   // downsampled rate for analysis
const WIN = 512;
const HOP = 256;

/**
 * Analyze a decoded AudioBuffer.
 * Returns { bpm, beats[], energies[] (0..1 per beat), duration }
 */
export function analyzeBuffer(audioBuffer, onProgress = () => {}) {
  const sr = audioBuffer.sampleRate;
  const decim = Math.max(1, Math.round(sr / TARGET_SR));
  const dsr = sr / decim;

  // --- mono downmix + decimate ---
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
  const n = Math.floor(ch0.length / decim);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * decim;
    mono[i] = ch1 ? (ch0[j] + ch1[j]) * 0.5 : ch0[j];
  }
  onProgress(0.2, 'Reading the waveform…');

  // --- RMS energy per frame ---
  const nFrames = Math.max(2, Math.floor((n - WIN) / HOP));
  const hopTime = HOP / dsr;
  const rms = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let sum = 0;
    const off = f * HOP;
    for (let i = 0; i < WIN; i++) { const v = mono[off + i]; sum += v * v; }
    rms[f] = Math.sqrt(sum / WIN);
  }
  onProgress(0.45, 'Feeling the energy…');

  // --- onset strength envelope (positive energy flux) ---
  const onset = new Float32Array(nFrames);
  for (let f = 1; f < nFrames; f++) onset[f] = Math.max(0, rms[f] - rms[f - 1]);
  let mean = 0;
  for (let f = 0; f < nFrames; f++) mean += onset[f];
  mean = mean / nFrames || 1e-9;
  for (let f = 0; f < nFrames; f++) onset[f] /= mean;

  // --- tempo via autocorrelation of onset envelope, with a prior near 120 BPM ---
  const minBPM = 65, maxBPM = 195;
  const lagMin = Math.max(1, Math.round(60 / maxBPM / hopTime));
  const lagMax = Math.min(nFrames - 2, Math.round(60 / minBPM / hopTime));
  let bestLag = lagMin, bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0, cnt = 0;
    for (let i = 0; i + lag < nFrames; i += 2) { s += onset[i] * onset[i + lag]; cnt++; }
    s /= cnt || 1;
    const bpm = 60 / (lag * hopTime);
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.55, 2));
    const score = s * prior;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  let periodFrames = bestLag;
  const bpm = Math.round((60 / (periodFrames * hopTime)) * 10) / 10;
  onProgress(0.7, 'Locking onto the beat…');

  // --- beat phase: pick the grid offset that lands on the most onsets ---
  const period = periodFrames;
  let bestPhase = 0, bestPhaseScore = -Infinity;
  for (let phase = 0; phase < period; phase++) {
    let s = 0;
    for (let t = phase; t < nFrames; t += period) {
      const i = Math.round(t);
      s += Math.max(onset[i] || 0, onset[i - 1] || 0, onset[i + 1] || 0);
    }
    if (s > bestPhaseScore) { bestPhaseScore = s; bestPhase = phase; }
  }

  // --- beat times ---
  const beats = [];
  for (let t = bestPhase; t < nFrames; t += period) beats.push(t * hopTime);
  onProgress(0.85, 'Mapping the song sections…');

  // --- per-beat energy (local smoothed RMS, rank-normalized 0..1) ---
  const halfWinFrames = Math.round(1.5 / hopTime); // ±1.5 s window
  const rawEnergy = beats.map(bt => {
    const c = Math.round(bt / hopTime);
    let s = 0, cnt = 0;
    for (let i = Math.max(0, c - halfWinFrames); i < Math.min(nFrames, c + halfWinFrames); i++) { s += rms[i]; cnt++; }
    return cnt ? s / cnt : 0;
  });
  const sorted = [...rawEnergy].sort((a, b) => a - b);
  const energies = rawEnergy.map(e => {
    let lo = 0, hi = sorted.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < e) lo = m + 1; else hi = m; }
    return sorted.length > 1 ? lo / (sorted.length - 1) : 0.5;
  });

  onProgress(1, 'Done!');
  return { bpm, beats, energies, duration: audioBuffer.duration };
}
