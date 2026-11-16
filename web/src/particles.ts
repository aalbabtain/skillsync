import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Clock,
  Group,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";

import { chapterProgress, headerHeight } from "./chapters";

/**
 * The landing page's particle field: one large object of particles, fitted into each chapter's
 * open middle (`.ch-stage`). It turns slowly, collapses into a bright swirling core between
 * chapters and opens into the next shape. Particles under text (`[data-mask]`) dim.
 * The landing page imports this module on demand, so the service pages never download three.js.
 */

export type FieldOptions = {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  lang: "en" | "ar";
  cvWord: string;
  /** Read every frame, so pausing never rebuilds the scene. */
  isPlaying: () => boolean;
};

type Shape = (out: Float32Array, extra: Float32Array) => void;

const MAX_RECTS = 8;
// Half width and height of each shape, to fit it inside its chapter's stage.
const EXTENT: [number, number][] = [
  [1.0, 0.8],
  [0.68, 0.92],
  [0.98, 0.62],
  [0.86, 0.84],
  [0.6, 0.95],
];

// Colours go to the shader as plain sRGB numbers, so three.js does not convert them.
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export async function startField(options: FieldOptions): Promise<() => void> {
  const { root, canvas, lang, cvWord, isPlaying } = options;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true });
  } catch {
    return () => {};
  }

  const chapters = Array.from(root.querySelectorAll<HTMLElement>(".chapter"));
  const phone = () => window.innerWidth < 860;
  const COUNT = phone() ? 9000 : 20000;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 6.2);

  // ---------- Shapes, each COUNT points in roughly -1..1 ----------
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const inSphere = (r: number) => {
    const w = Math.cbrt(Math.random()) * r;
    const th = 2 * Math.PI * Math.random();
    const ph = Math.acos(2 * Math.random() - 1);
    return [w * Math.sin(ph) * Math.cos(th), w * Math.sin(ph) * Math.sin(th), w * Math.cos(ph)];
  };
  const onSphere = (r: number) => {
    const th = 2 * Math.PI * Math.random();
    const ph = Math.acos(2 * Math.random() - 1);
    return [r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)];
  };

  const arabic = lang === "ar";
  const fontFamily = arabic ? '"IBM Plex Sans Arabic", Tahoma, sans-serif' : "Arial, Helvetica, sans-serif";
  try {
    await document.fonts.load(`700 120px ${fontFamily}`, cvWord);
  } catch {
    // A missing web font falls back to the system face; the shape still reads.
  }

  // Points inside text drawn on a canvas, for words and glyphs made of particles.
  function textPoints(text: string, size: number, w: number, h: number) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.font = `700 ${size}px ${fontFamily}`;
    g.direction = arabic ? "rtl" : "ltr";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2);
    const data = g.getImageData(0, 0, w, h).data;
    const pts: [number, number][] = [];
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        if (data[(y * w + x) * 4 + 3] > 128) pts.push([x / w - 0.5, 0.5 - y / h]);
      }
    }
    return pts.length ? pts : [[0, 0] as [number, number]];
  }
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

  // 0. The SkillSync mark: the rising line through three points to the final dot.
  const NODES = [[13, 47], [27, 31], [41, 39], [53, 17]].map(([x, y]) => [(x - 33) / 22, (32 - y) / 22]);
  const logo: Shape = (out, accent) => {
    for (let i = 0; i < COUNT; i++) {
      const r = Math.random();
      let x: number, y: number, z: number;
      let acc = 0;
      if (r < 0.62) {
        const seg = Math.min(2, Math.floor(Math.random() * 3));
        const t = Math.random();
        const [ax, ay] = NODES[seg];
        const [bx, by] = NODES[seg + 1];
        x = ax + (bx - ax) * t + gauss() * 0.045;
        y = ay + (by - ay) * t + gauss() * 0.045;
        z = gauss() * 0.09;
      } else {
        const n = r < 0.86 ? Math.floor(Math.random() * 3) : 3;
        const [sx, sy, sz] = inSphere(n === 3 ? 0.17 : 0.11);
        x = NODES[n][0] + sx;
        y = NODES[n][1] + sy;
        z = sz;
        acc = n === 3 ? 1 : 0;
      }
      out.set([x, y, z], i * 3);
      accent[i] = acc;
    }
  };

  // 1. A CV as a thin 3D page: the word on top in particles, lines of text below, a back face
  //    and edges, so it reads as an object as it turns.
  const cvPage: Shape = (out) => {
    const W = 0.62, H = 0.86, D = 0.09, fold = 0.2;
    const words = textPoints(cvWord, 120, 600, 170);
    const lines = [0.18, 0.06, -0.06, -0.18, -0.34, -0.46, -0.58, -0.7];
    const lengths = [0.95, 0.75, 0.9, 0.6, 0.95, 0.8, 0.9, 0.5];
    for (let i = 0; i < COUNT; i++) {
      const r = Math.random();
      let x: number, y: number;
      let z = D;
      if (r < 0.26) {
        const p = pick(words);
        x = p[0] * 1.05;
        y = 0.5 + p[1] * 0.3;
        z = D + 0.01;
      } else if (r < 0.56) {
        const k = Math.floor(Math.random() * lines.length);
        const length = (2 * W - 0.24) * lengths[k];
        // Lines start at the reading side: the left in English, the right in Arabic.
        const from = Math.random() * length;
        x = arabic ? W - 0.12 - from : -W + 0.12 + from;
        y = lines[k] + gauss() * 0.012;
      } else if (r < 0.9) {
        const t = Math.random() * 4.25;
        if (t < 1) { x = -W + t * (2 * W - fold); y = H; }
        else if (t < 1.25) { const s = (t - 1) * 4; x = W - fold + s * fold; y = H - s * fold; }
        else if (t < 2.25) { x = W; y = H - fold - (t - 1.25) * (2 * H - fold); }
        else if (t < 3.25) { x = W - (t - 2.25) * 2 * W; y = -H; }
        else { x = -W; y = -H + (t - 3.25) * 2 * H; }
        z = Math.random() < 0.6 ? D : -D;
        if (Math.random() < 0.18) z = (Math.random() * 2 - 1) * D;
      } else {
        x = (Math.random() * 2 - 1) * W;
        y = (Math.random() * 2 - 1) * H;
        z = (Math.random() * 2 - 1) * D;
      }
      out.set([x + gauss() * 0.006, y + gauss() * 0.006, z], i * 3);
    }
  };

  // 2. Your skills and the market's: two overlapping spheres, the overlap brighter.
  const spheres: Shape = (out, bright) => {
    const R = 0.58, cA = -0.34, cB = 0.34;
    for (let i = 0; i < COUNT; i++) {
      const c = Math.random() < 0.5 ? cA : cB;
      const [sx, sy, sz] = Math.random() < 0.55 ? onSphere(R) : inSphere(R);
      const x = c + sx;
      const inBoth = Math.hypot(x - cA, sy, sz) < R && Math.hypot(x - cB, sy, sz) < R;
      bright[i] = inBoth ? 1 : 0;
      out.set([x, sy, sz], i * 3);
    }
  };

  // 3. Three groups of people joined to one centre: students, career changers, professionals.
  const people: Shape = (out, bright) => {
    const centers = [90, 210, 330].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return [Math.cos(a) * 0.6, Math.sin(a) * 0.6 - 0.05];
    });
    for (let i = 0; i < COUNT; i++) {
      const r = Math.random();
      let x: number, y: number, z: number;
      bright[i] = 0;
      if (r < 0.72) {
        const [cx, cy] = pick(centers);
        const [sx, sy, sz] = Math.random() < 0.5 ? onSphere(0.24) : inSphere(0.24);
        x = cx + sx;
        y = cy + sy;
        z = sz;
      } else if (r < 0.92) {
        const [cx, cy] = pick(centers);
        const t = Math.random();
        x = cx * t + gauss() * 0.02;
        y = -0.05 + (cy + 0.05) * t + gauss() * 0.02;
        z = gauss() * 0.03;
      } else {
        const [sx, sy, sz] = inSphere(0.1);
        x = sx;
        y = sy - 0.05;
        z = sz;
        bright[i] = 1;
      }
      out.set([x, y, z], i * 3);
    }
  };

  // 4. A question mark with depth, for the common questions; the Arabic one in Arabic.
  const question: Shape = (out) => {
    const glyph = textPoints(arabic ? "؟" : "?", 300, 260, 320);
    for (let i = 0; i < COUNT; i++) {
      const p = pick(glyph);
      out.set([p[0] * 1.5, p[1] * 1.85, (Math.random() * 2 - 1) * 0.14], i * 3);
    }
  };

  const builders = [logo, cvPage, spheres, people, question].slice(0, Math.max(2, chapters.length));
  const SHAPES = builders.length;
  const shapes = builders.map(() => new Float32Array(COUNT * 3));
  const accent = new Float32Array(COUNT);
  const bright = new Float32Array(COUNT);
  const peopleBright = new Float32Array(COUNT);
  builders.forEach((build, n) => build(shapes[n], n === 0 ? accent : n === 3 ? peopleBright : bright));

  const seeds = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT * 4; i++) seeds[i] = Math.random();

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(shapes[0], 3));
  shapes.forEach((s, n) => geometry.setAttribute(`p${n}`, new BufferAttribute(s, 3)));
  geometry.setAttribute("seed", new BufferAttribute(seeds, 4));
  geometry.setAttribute("accent", new BufferAttribute(accent, 1));
  geometry.setAttribute("bright", new BufferAttribute(bright, 1));
  geometry.setAttribute("bright3", new BufferAttribute(peopleBright, 1));

  const attributes = shapes.map((_, n) => `attribute vec3 p${n};`).join("\n");
  const shapeOf = shapes.map((_, n) => `if (k < ${n}.5) return p${n};`).join(" ");
  const vec3 = (hex: string) => new Vector3(...rgb(hex));

  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uMorph: { value: 0 },
      uTime: { value: 0 },
      uDrift: { value: 1 },
      uSize: { value: phone() ? 11 : 14 },
      uRatio: { value: renderer.getPixelRatio() },
      uAspect: { value: 1 },
      uRepel: { value: 0 },
      uPointer: { value: new Vector2(9, 9) },
      uRects: { value: Array.from({ length: MAX_RECTS }, () => new Vector4(2, 2, 2, 2)) },
      uRectCount: { value: 0 },
      uBlue: { value: vec3("#3b6cf5") },
      uCyan: { value: vec3("#79d4ff") },
      uViolet: { value: vec3("#a78bfa") },
      uCore: { value: vec3("#cfe9ff") },
    },
    vertexShader: `
      ${attributes}
      attribute vec4 seed; attribute float accent; attribute float bright; attribute float bright3;
      uniform float uMorph, uTime, uDrift, uSize, uRatio, uAspect, uRepel;
      uniform vec2 uPointer;
      uniform vec4 uRects[${MAX_RECTS}];
      uniform int uRectCount;
      uniform vec3 uBlue, uCyan, uViolet, uCore;
      varying vec3 vColor; varying float vAlpha;
      vec3 shape(float k) { ${shapeOf} return p${SHAPES - 1}; }
      void main() {
        float seg = clamp(floor(uMorph), 0.0, ${SHAPES - 2}.0);
        float f = clamp(uMorph - seg, 0.0, 1.0);
        float d = seed.x * 0.25;
        float t = smoothstep(d, d + 0.75, f);
        vec3 pos = mix(shape(seg), shape(seg + 1.0), t);
        // Between shapes the cloud collapses into a bright swirling core, then opens again.
        float pull = sin(t * 3.14159);
        float a = uTime * 2.4 + seed.w * 6.2831 + seed.y * 12.0;
        float r = 0.08 + seed.z * 0.22;
        vec3 core = vec3(cos(a) * r, (seed.x - 0.5) * 0.18, sin(a) * r);
        pos = mix(pos, core, pull * 0.88);
        pos += uDrift * 0.02 * vec3(sin(uTime * 0.7 + seed.w * 6.28), cos(uTime * 0.6 + seed.z * 6.28), sin(uTime * 0.5 + seed.y * 6.28));
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vec4 clip = projectionMatrix * mv;
        vec2 ndc = clip.xy / clip.w;
        // Particles under the cursor step aside.
        vec2 diff = (ndc - uPointer) * vec2(uAspect, 1.0);
        float near = smoothstep(0.28, 0.0, length(diff)) * uRepel;
        mv.xy += normalize(diff + 0.0001) * near * 0.35;
        gl_Position = projectionMatrix * mv;
        // Under text the particles dim, so the words stay readable.
        float under = 0.0;
        for (int i = 0; i < ${MAX_RECTS}; i++) {
          if (i >= uRectCount) break;
          vec4 q = uRects[i];
          vec2 inside = smoothstep(q.xy - 0.04, q.xy, ndc) * (1.0 - smoothstep(q.zw, q.zw + 0.04, ndc));
          under = max(under, inside.x * inside.y);
        }
        float logoness = 1.0 - smoothstep(0.0, 0.5, uMorph);
        float gapness = 1.0 - smoothstep(0.0, 0.5, abs(uMorph - 2.0));
        float whoness = 1.0 - smoothstep(0.0, 0.5, abs(uMorph - 3.0));
        float isAccent = accent * logoness;
        float lit = bright * gapness + bright3 * whoness;
        gl_PointSize = uSize * uRatio * (0.45 + seed.y * 0.9) * (1.0 + isAccent * 0.6) * (1.0 - pull * 0.25) / -mv.z;
        vec3 base = mix(mix(uBlue, uCyan, seed.z * 0.7 + lit * 0.6), uViolet, isAccent + bright3 * whoness * 0.7);
        vColor = mix(base, uCore, pull * 0.6);
        vAlpha = (0.55 + seed.x * 0.45) * (1.0 + pull * 0.6) * (1.0 - under * 0.78);
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor, a * a * vAlpha * 0.9);
      }`,
  });

  const cloud = new Points(geometry, material);
  cloud.frustumCulled = false;
  const group = new Group();
  group.add(cloud);
  scene.add(group);

  // Fit shape n inside its chapter's stage, as the stage sits when that chapter fills the screen.
  function stagePlace(n: number, halfW: number, halfH: number) {
    const chapter = chapters[n];
    const stage = chapter?.querySelector<HTMLElement>(".ch-stage");
    if (!stage || !stage.offsetWidth || !stage.offsetHeight) return { x: 0, y: 0, size: halfH * 0.45 };
    const box = stage.getBoundingClientRect();
    const top = box.top - chapter.getBoundingClientRect().top + headerHeight();
    const cx = box.left + box.width / 2;
    const cy = top + box.height / 2;
    const w = (box.width / window.innerWidth) * halfW;
    const h = (box.height / window.innerHeight) * halfH;
    const [ex, ey] = EXTENT[n] ?? [1, 1];
    return {
      x: (cx / window.innerWidth) * 2 - 1,
      y: -((cy / window.innerHeight) * 2 - 1),
      size: Math.min(w / ex, h / ey) * 0.98,
    };
  }

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const pointer = { x: 0, y: 0, sx: 0, sy: 0, active: false };
  const onPointer = (e: PointerEvent) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    pointer.active = e.pointerType === "mouse";
  };
  const onLeave = () => {
    pointer.active = false;
  };
  window.addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("pointerleave", onLeave);

  const masks = Array.from(root.querySelectorAll<HTMLElement>("[data-mask]"));
  const track = root.querySelector<HTMLElement>(".ch-track");
  const trackItems = track ? Array.from(track.querySelectorAll("li")) : [];
  const markHere = (n: number) => chapters.forEach((c, i) => c.toggleAttribute("data-here", i === n));
  const cur = { morph: chapterProgress(chapters) };
  const clock = new Clock();
  let time = 0;
  let spin = 0;
  let lastHere = -1;
  let frameId = 0;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const playing = isPlaying();
    if (playing) {
      time += dt;
      spin += dt * 0.35;
    }
    const target = chapterProgress(chapters);
    const goal = playing ? target : Math.round(target);
    cur.morph += (goal - cur.morph) * (playing ? 1 - Math.exp(-dt * 6) : 1);

    const here = Math.round(cur.morph);
    if (here !== lastHere && Math.abs(cur.morph - here) < 0.12) {
      markHere(here);
      lastHere = here;
    }

    const i = Math.min(chapters.length - 2, Math.floor(cur.morph));
    const f = cur.morph - i;
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    const halfW = halfH * camera.aspect;
    const a = stagePlace(i, halfW, halfH);
    const b = stagePlace(i + 1, halfW, halfH);
    const follow = playing ? 1 : 0;
    pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-dt * 2));
    pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-dt * 2));
    group.position.set(
      (a.x + (b.x - a.x) * f + pointer.sx * 0.05 * follow) * halfW,
      (a.y + (b.y - a.y) * f + pointer.sy * 0.05 * follow) * halfH,
      0,
    );
    group.scale.setScalar(a.size + (b.size - a.size) * f);
    // A slow turn like an object on display, swaying so words keep facing the reader,
    // and a lean toward the cursor.
    group.rotation.y = Math.sin(spin) * 0.55 + pointer.sx * 0.35 * follow;
    group.rotation.x = -0.08 - pointer.sy * 0.22 * follow;
    group.rotation.z = -pointer.sx * 0.06 * follow;

    // Text areas on screen, in normalised device coordinates, for the dimming.
    let count = 0;
    for (const el of masks) {
      if (count >= MAX_RECTS) break;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.width === 0) continue;
      material.uniforms.uRects.value[count++].set(
        (r.left / window.innerWidth) * 2 - 1,
        -((r.bottom / window.innerHeight) * 2 - 1),
        (r.right / window.innerWidth) * 2 - 1,
        -((r.top / window.innerHeight) * 2 - 1),
      );
    }
    material.uniforms.uRectCount.value = count;

    if (track) {
      const fill = Math.min(1, Math.max(0, (cur.morph - 0.55) / 0.45));
      track.style.setProperty("--fill", fill.toFixed(3));
      trackItems.forEach((li, n) =>
        li.classList.toggle("is-reached", fill >= n / (trackItems.length - 1) - 0.01),
      );
    }

    material.uniforms.uMorph.value = cur.morph;
    material.uniforms.uTime.value = time;
    material.uniforms.uDrift.value = playing ? 1 : 0;
    material.uniforms.uAspect.value = camera.aspect;
    material.uniforms.uPointer.value.set(pointer.x, pointer.y);
    const repelGoal = pointer.active && playing ? 1 : 0;
    material.uniforms.uRepel.value += (repelGoal - material.uniforms.uRepel.value) * (1 - Math.exp(-dt * 6));
    canvas.style.opacity = phone() ? "0.6" : "1";
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(frame);
  }
  frameId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(frameId);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", onPointer);
    document.removeEventListener("pointerleave", onLeave);
    chapters.forEach((c) => c.removeAttribute("data-here"));
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  };
}

