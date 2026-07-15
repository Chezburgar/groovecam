// Choreography generation: turn beat/energy analysis into a timed move chart.
import { MOVES } from './moves.js';

// Deterministic RNG so the same song + difficulty always produces the same dance.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN_SPACING = { easy: 1.9, normal: 1.25, hard: 0.85 }; // seconds between moves

/**
 * @param {{bpm:number, beats:number[], energies:number[], duration:number}} analysis
 * @param {'easy'|'normal'|'hard'} difficulty
 * @returns {Array<{time:number, move:object}>}
 */
export function generateChoreography(analysis, difficulty = 'normal') {
  const { beats, energies, duration, bpm } = analysis;
  const rng = mulberry32(Math.floor(duration * 1000) ^ Math.floor(bpm * 100) ^ difficulty.length * 7919);

  const beatInterval = 60 / bpm;
  const stride = Math.max(1, Math.ceil(MIN_SPACING[difficulty] / beatInterval));

  const pools = {
    chill: MOVES.filter(m => m.pool === 'chill'),
    groove: MOVES.filter(m => m.pool === 'groove'),
    hype: MOVES.filter(m => m.pool === 'hype'),
  };

  const chart = [];
  let lastId = null, secondLastId = null;

  for (let i = 0; i < beats.length; i += stride) {
    const t = beats[i];
    if (t < 3.5) continue;                 // skip the intro
    if (t > duration - 2.5) break;         // leave room at the end

    const e = energies[i] ?? 0.5;
    // Energy decides the vibe, with a little randomness at the boundaries
    let pool;
    if (e < 0.33) pool = rng() < 0.8 ? pools.chill : pools.groove;
    else if (e < 0.7) pool = rng() < 0.75 ? pools.groove : (rng() < 0.5 ? pools.chill : pools.hype);
    else pool = rng() < 0.75 ? pools.hype : pools.groove;

    // pick a move that isn't one of the last two
    let move = null;
    for (let tries = 0; tries < 8; tries++) {
      const cand = pool[Math.floor(rng() * pool.length)];
      if (cand.id !== lastId && cand.id !== secondLastId) { move = cand; break; }
    }
    if (!move) move = pool[Math.floor(rng() * pool.length)];

    chart.push({ time: t, move });
    secondLastId = lastId;
    lastId = move.id;
  }

  return chart;
}
