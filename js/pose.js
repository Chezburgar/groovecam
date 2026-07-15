// Camera + MediaPipe Pose Landmarker wrapper.
import {
  FilesetResolver,
  PoseLandmarker,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let landmarker = null;
let landmarkerPromise = null;

/** Load the pose model (idempotent; call early so it's warm). */
export function loadPoseModel() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      return landmarker;
    })();
  }
  return landmarkerPromise;
}

/** Start the webcam and return a playing <video> element. */
export async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  await video.play();
  return video;
}

export function stopCamera(video) {
  if (!video) return;
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach(t => t.stop());
  video.srcObject = null;
}

let lastVideoTime = -1;
let lastResult = null;

/** Detect pose landmarks for the current video frame. Returns landmark array or null. */
export function detectPose(video, nowMs) {
  if (!landmarker || video.readyState < 2) return lastResult;
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      const res = landmarker.detectForVideo(video, nowMs);
      lastResult = res.landmarks && res.landmarks.length ? res.landmarks[0] : null;
    } catch {
      lastResult = null;
    }
  }
  return lastResult;
}

// Skeleton connections for drawing (subset of MediaPipe pose topology)
export const SKELETON = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

/** Draw the mirrored camera frame + skeleton onto a canvas (cover-fit). */
export function drawCameraFrame(ctx, video, lm, opts = {}) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const vw = video.videoWidth || 4, vh = video.videoHeight || 3;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale, dh = vh * scale;
  const ox = (cw - dw) / 2, oy = (ch - dh) / 2;

  ctx.save();
  // mirror horizontally
  ctx.translate(cw, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, ox, oy, dw, dh);

  if (lm) {
    const px = p => [ox + p.x * dw, oy + p.y * dh];
    ctx.lineWidth = opts.lineWidth || 5;
    ctx.strokeStyle = opts.color || 'rgba(41,230,255,0.85)';
    ctx.lineCap = 'round';
    for (const [a, b] of SKELETON) {
      const pa = lm[a], pb = lm[b];
      if (!pa || !pb) continue;
      if ((pa.visibility ?? 1) < 0.4 || (pb.visibility ?? 1) < 0.4) continue;
      const [x1, y1] = px(pa), [x2, y2] = px(pb);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // head dot
    if (lm[0] && (lm[0].visibility ?? 1) >= 0.4) {
      const [hx, hy] = px(lm[0]);
      ctx.fillStyle = opts.color || 'rgba(41,230,255,0.85)';
      ctx.beginPath(); ctx.arc(hx, hy, (opts.lineWidth || 5) * 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
