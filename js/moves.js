// Dance move library: each move has a pose detector (MediaPipe landmarks -> 0..1
// confidence) and a stick-figure spec used to render its icon.
//
// The camera view is mirrored, so the user's LEFT side appears on the LEFT of the
// screen. MediaPipe's "left" landmarks are the user's anatomical left, which means
// icon-space left == user's left. Detectors use anatomical left/right directly.

// Landmark indices
const NOSE = 0, L_SH = 11, R_SH = 12, L_EL = 13, R_EL = 14, L_WR = 15, R_WR = 16,
      L_HIP = 23, R_HIP = 24, L_KNEE = 25, R_KNEE = 26;

const clamp01 = v => Math.min(1, Math.max(0, v));
// 0 at lo, 1 at hi (works with hi < lo for inverted ramps)
const ramp = (v, lo, hi) => clamp01((v - lo) / (hi - lo));
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Extract normalized features from a landmark array. */
export function poseFeatures(lm) {
  const g = i => lm[i];
  const f = {
    nose: g(NOSE),
    ls: g(L_SH), rs: g(R_SH),
    lw: g(L_WR), rw: g(R_WR),
    le: g(L_EL), re: g(R_EL),
    lh: g(L_HIP), rh: g(R_HIP),
    lk: g(L_KNEE), rk: g(R_KNEE),
  };
  f.shMid = mid(f.ls, f.rs);
  f.hipMid = mid(f.lh, f.rh);
  f.shW = Math.max(0.04, dist(f.ls, f.rs));
  f.torso = Math.max(0.06, dist(f.shMid, f.hipMid));
  return f;
}

// --- shared detector fragments (all return 0..1) ---
const armUp = (f, wrist) => ramp(f.nose.y - wrist.y, -0.03, 0.09); // wrist above head
const armDown = (f, wrist, sh) => ramp(wrist.y - sh.y, 0.02, 0.14); // wrist below shoulder

// ctx = { baseline: {hipY, torso} | null }  (captured during calibration)
export const MOVES = [
  {
    id: 'hands_up', name: 'Hands Up!', pool: 'hype',
    detect: f => Math.min(armUp(f, f.lw), armUp(f, f.rw)),
    fig: { la: [[30, 20], [32, 4]], ra: [[70, 20], [68, 4]] },
  },
  {
    id: 'left_up', name: 'Left Arm Up', pool: 'groove',
    detect: f => Math.min(armUp(f, f.lw), armDown(f, f.rw, f.rs)),
    fig: { la: [[28, 20], [31, 4]], ra: [[70, 50], [72, 64]] },
  },
  {
    id: 'right_up', name: 'Right Arm Up', pool: 'groove',
    detect: f => Math.min(armUp(f, f.rw), armDown(f, f.lw, f.ls)),
    fig: { la: [[30, 50], [28, 64]], ra: [[72, 20], [69, 4]] },
  },
  {
    id: 't_pose', name: 'T-Pose', pool: 'groove',
    detect: f => {
      const yBand = w => ramp(Math.abs(w.y - f.shMid.y), 0.09, 0.03);
      const ext = (w, s, sign) => ramp(sign * (w.x - s.x), 0.6 * f.shW, 1.15 * f.shW);
      return Math.min(yBand(f.lw), yBand(f.rw), ext(f.lw, f.ls, 1), ext(f.rw, f.rs, -1));
    },
    fig: { la: [[16, 34], [2, 34]], ra: [[84, 34], [98, 34]] },
  },
  {
    id: 'hands_hips', name: 'Hands on Hips', pool: 'chill',
    detect: f => {
      const near = (w, h) => ramp(dist(w, h), 0.55 * f.shW, 0.22 * f.shW);
      return Math.min(near(f.lw, f.lh), near(f.rw, f.rh));
    },
    fig: { la: [[22, 52], [40, 72]], ra: [[78, 52], [60, 72]] },
  },
  {
    id: 'clap_high', name: 'Clap High', pool: 'hype',
    detect: f => {
      const together = ramp(dist(f.lw, f.rw), 0.6 * f.shW, 0.25 * f.shW);
      return Math.min(armUp(f, f.lw), armUp(f, f.rw), together);
    },
    fig: { la: [[34, 16], [48, 3]], ra: [[66, 16], [52, 3]] },
  },
  {
    id: 'flex', name: 'Flex!', pool: 'groove',
    detect: f => {
      // Wrists between head and shoulders, elbows out wide
      const band = w => Math.min(ramp(f.shMid.y - w.y, 0.0, 0.08), ramp(w.y - f.nose.y, -0.06, 0.02));
      const elbOut = (e, s, sign) => ramp(sign * (e.x - s.x), 0.25 * f.shW, 0.7 * f.shW);
      return Math.min(band(f.lw), band(f.rw), elbOut(f.le, f.ls, 1), elbOut(f.re, f.rs, -1));
    },
    fig: { la: [[18, 36], [24, 15]], ra: [[82, 36], [76, 15]] },
  },
  {
    id: 'lean_left', name: 'Lean Left', pool: 'chill',
    detect: f => ramp(f.shMid.x - f.hipMid.x, 0.18 * f.shW, 0.5 * f.shW),
    fig: { la: [[26, 14], [14, 2]], ra: [[56, 12], [42, 0]], dxTop: -13 },
  },
  {
    id: 'lean_right', name: 'Lean Right', pool: 'chill',
    detect: f => ramp(f.hipMid.x - f.shMid.x, 0.18 * f.shW, 0.5 * f.shW),
    fig: { la: [[44, 12], [58, 0]], ra: [[74, 14], [86, 2]], dxTop: 13 },
  },
  {
    id: 'squat', name: 'Squat!', pool: 'hype',
    detect: (f, ctx) => {
      if (ctx && ctx.baseline) {
        return ramp(f.hipMid.y - ctx.baseline.hipY, 0.18 * ctx.baseline.torso, 0.45 * ctx.baseline.torso);
      }
      // fallback: hips approaching knee height
      const kneeY = (f.lk.y + f.rk.y) / 2;
      return ramp(f.hipMid.y - (kneeY - f.torso), 0, 0.4 * f.torso);
    },
    fig: { la: [[24, 46], [12, 42]], ra: [[76, 46], [88, 42]], squat: true },
  },
];

export const MOVE_BY_ID = Object.fromEntries(MOVES.map(m => [m.id, m]));

// ================= icon rendering =================

/** Draw a stick-figure icon for a move onto a square canvas 2D context. */
export function drawMoveIcon(c, move, size, color = '#ffffff') {
  const s = size / 130;                 // figure designed in a 100x130 box
  const ox = (size - 100 * s) / 2;
  const P = (x, y) => [ox + x * s, y * s + 4 * s];
  const fig = move.fig;
  const dx = fig.dxTop || 0;
  const drop = fig.squat ? 9 : 0;

  const head = P(50 + dx, 15 + drop);
  const neck = P(50 + dx, 26 + drop);
  const lsh = P(37 + dx, 34 + drop), rsh = P(63 + dx, 34 + drop);
  const lhip = fig.squat ? P(41, 84) : P(41, 74);
  const rhip = fig.squat ? P(59, 84) : P(59, 74);
  const lknee = fig.squat ? P(29, 97) : P(39, 97);
  const rknee = fig.squat ? P(71, 97) : P(61, 97);
  const lfoot = fig.squat ? P(33, 121) : P(37, 121);
  const rfoot = fig.squat ? P(67, 121) : P(63, 121);
  const shMid = [(lsh[0] + rsh[0]) / 2, lsh[1]];
  const hipMid = [(lhip[0] + rhip[0]) / 2, lhip[1]];

  const off = fig.dxTop ? fig.dxTop : 0;
  const arm = (pts, sh) => [sh, P(pts[0][0] + (fig.dxTop ? 0 : 0), pts[0][1] + drop), P(pts[1][0], pts[1][1] + drop)];
  // arms are authored with lean already baked in, so no extra offset
  void off; void arm;

  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = color;
  c.lineWidth = Math.max(3, size * 0.055);

  const line = (...pts) => {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.stroke();
  };

  // torso + legs
  line(neck, shMid, hipMid);
  line(lsh, rsh);
  line(lhip, rhip);
  line(lhip, lknee, lfoot);
  line(rhip, rknee, rfoot);
  // arms
  line(lsh, P(fig.la[0][0], fig.la[0][1] + drop), P(fig.la[1][0], fig.la[1][1] + drop));
  line(rsh, P(fig.ra[0][0], fig.ra[0][1] + drop), P(fig.ra[1][0], fig.ra[1][1] + drop));
  // head
  c.beginPath();
  c.arc(head[0], head[1], 9.5 * s, 0, Math.PI * 2);
  c.stroke();
}

/** Pre-render an icon canvas for a move. */
export function makeIconCanvas(move, size, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  drawMoveIcon(cv.getContext('2d'), move, size, color);
  return cv;
}
