import { useEffect, useRef, useState, type RefObject } from 'react';

type Variant = 'sky' | 'orb';

interface Props {
  variant: Variant;
  className?: string;
  /** 0..1, speeds up the drift and brightens the clouds. */
  intensityRef?: RefObject<number>;
  /** Fraction of device pixels to render; clouds are soft, so low values look the same and cost less. */
  resolution?: number;
}

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLevel;
uniform float uOrb;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  // the orb shows a tilted slice of sky, like looking at it through a lens
  float ang = mix(0.0, -0.45, uOrb);
  p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
  float h = p.y + 0.5;
  float scale = mix(1.6, 2.4, uOrb);

  float t = uTime * 0.018;
  vec2 q = vec2(fbm(p * scale + vec2(t, 0.0)), fbm(p * scale + vec2(5.2, 1.3) - vec2(0.0, t * 0.7)));
  float n = fbm(p * scale * 1.35 + 1.7 * q + vec2(t * 1.6, t * 0.25));

  vec3 top  = vec3(0.000, 0.502, 0.373);
  vec3 mid  = vec3(0.235, 0.690, 0.525);
  vec3 low  = mix(vec3(0.890, 0.965, 0.935), vec3(0.780, 0.905, 0.860), uOrb);
  vec3 sky = mix(low, mid, smoothstep(0.05, 0.55, h));
  sky = mix(sky, top, smoothstep(0.5, 1.0, h));

  // dense cumulus toward the horizon, thin cirrus streaks up high
  float horizon = mix(0.92, 0.30, clamp(h, 0.0, 1.0));
  float cumulus = smoothstep(horizon - 0.08, horizon + 0.30, n + (1.0 - h) * 0.22);
  float streak = fbm(vec2(p.x * 1.1 + t * 2.2, p.y * 7.0) + q * 1.4);
  float cirrus = smoothstep(0.52, 0.86, streak) * smoothstep(0.25, 0.85, h) * 0.45;

  float cloud = clamp(cumulus * 0.96 + cirrus, 0.0, 1.0);
  vec3 col = mix(sky, vec3(1.0), cloud);
  col = mix(col, col * vec3(0.90, 1.0, 0.95), cumulus * (1.0 - n) * 0.55);
  col += uLevel * 0.06 * cloud;

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

export function CloudCanvas({ variant, className, intensityRef, resolution = 1 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl || gl.isContextLost()) {
      setFailed(true);
      return;
    }
    setFailed(false);

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
    } catch {
      setFailed(true);
      return;
    }
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'uRes');
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uLevel = gl.getUniformLocation(program, 'uLevel');
    gl.uniform1f(gl.getUniformLocation(program, 'uOrb'), variant === 'orb' ? 1 : 0);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * resolution;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let time = variant === 'orb' ? 40 : 0;
    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const lvl = Math.max(0, Math.min(1, intensityRef?.current ?? 0));
      time += dt * (1 + lvl * 4);
      if (!document.hidden) {
        gl.uniform2f(uRes, canvas.width, canvas.height);
        gl.uniform1f(uTime, time);
        gl.uniform1f(uLevel, lvl);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
    };
  }, [variant, resolution, intensityRef]);

  return <canvas ref={ref} className={`clouds clouds--${variant} ${failed ? 'clouds--fallback' : ''} ${className ?? ''}`} aria-hidden />;
}
