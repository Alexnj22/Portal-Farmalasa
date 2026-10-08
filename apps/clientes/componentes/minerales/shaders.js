// Los materiales de la tarjeta (2026-10-08), como shaders de Skia (SkSL).
// La MISMA fuente dibuja la tarjeta de la app (componentes/minerales/Mineral.js)
// y genera las franjas de Apple Wallet (scripts/wallet/franjas.mjs), así que
// la tarjeta del teléfono y la de Wallet son el mismo material.
//
// Uniformes: `res` (ancho, alto), `t` (segundos) y `tilt` (−1…1, la
// inclinación del teléfono más el dedo). Todo se mide en `uv = p / res.y`.
//
//   Metales (Puntos Salud): VIP seda morada · Plata cepillada · Oro cepillado
//   con destellos · Platino titanio negro con tornasol.
//   Piedras (Cliente Mayorista): Jade con vetas y luz interior · Zafiro
//   facetado con estrella (asterismo) · Rubí facetado con fuego · Diamante
//   facetado con dispersión de arcoíris.

export const PRELUDIO = `
uniform float2 res;
uniform float t;
uniform float2 tilt;

float hash(float2 p) { p = fract(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float2 hash2(float2 p) { float n = hash(p); return float2(n, hash(p + n + 1.7)); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x), mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}
float fbm(float2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + float2(1.7, 9.2); a *= 0.5; }
  return v;
}
// Voronoi: (distancia al centro, ancho del borde, id de la faceta).
float3 voro(float2 p) {
  float2 g = floor(p); float2 f = fract(p);
  float d1 = 8.0; float d2 = 8.0; float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float2 b = float2(float(i), float(j));
      float2 r = b + hash2(g + b) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = hash(g + b + 3.1); } else if (d < d2) { d2 = d; }
    }
  }
  return float3(sqrt(d1), sqrt(d2) - sqrt(d1), id);
}
// Voronoi con el vector al centro de la faceta: (rel.x, rel.y, borde, id).
float4 voro4(float2 p) {
  float2 g = floor(p); float2 f = fract(p);
  float d1 = 8.0; float d2 = 8.0; float id = 0.0; float2 rel = float2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float2 b = float2(float(i), float(j));
      float2 r = b + hash2(g + b) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = hash(g + b + 3.1); rel = r; } else if (d < d2) { d2 = d; }
    }
  }
  return float4(rel, sqrt(d2) - sqrt(d1), id);
}
// Una piedra tallada: dos capas de facetas (grandes y finas), cada faceta con
// su propia pendiente — se aclara de un lado y se oscurece del otro, y cambia
// con la inclinación —, bisel brillante en las aristas y profundidad oscura.
float3 gema(float2 uv, float escala, float3 hondo, float3 cuerpo, float3 brillo, float semilla) {
  float4 v = voro4(uv * escala + semilla);
  float4 w = voro4(uv * escala * 2.3 + semilla * 1.7);
  float2 n = hash2(float2(v.w * 91.0, v.w * 17.0)) * 2.0 - 1.0;
  float2 m = hash2(float2(w.w * 53.0, w.w * 29.0)) * 2.0 - 1.0;
  float pend = dot(n, -v.xy) * 1.7 + dot(n, tilt) * 1.1 + dot(m, tilt) * 0.35 + dot(m, -w.xy) * 0.5;
  float k = clamp(0.45 + 0.45 * pend, 0.0, 1.0);
  float3 c = mix(hondo, cuerpo, k);
  c = mix(c, brillo, smoothstep(0.78, 1.0, k) * 0.85);
  float arista = 1.0 - smoothstep(0.0, 0.035, v.z);
  float aristaFina = 1.0 - smoothstep(0.0, 0.02, w.z);
  c += brillo * arista * (0.30 + 0.35 * max(0.0, dot(n, tilt)));
  c += brillo * aristaFina * 0.10;
  return c;
}
// Destellos que titilan sobre una grilla fina.
float destellos(float2 p, float densidad, float velocidad) {
  float celda = res.y * 0.045;
  float2 g = floor(p / celda); float h = hash(g + 7.0);
  float2 f = fract(p / celda) - 0.5;
  float tw = pow(max(0.0, sin(t * velocidad + h * 40.0)), 24.0);
  float cruz = exp(-abs(f.x) * 60.0) * exp(-abs(f.y) * 8.0) + exp(-abs(f.y) * 60.0) * exp(-abs(f.x) * 8.0);
  return step(1.0 - densidad, h) * tw * (exp(-length(f) * 14.0) + cruz * 0.6);
}
float sq(float x) { return x * x; }
float2 luz(float a) { return float2(a * (0.5 + tilt.x * 0.38), 0.5 - tilt.y * 0.38); }
`;

export const SHADERS = {
  vip: `
half4 main(float2 p) {
  float a = res.x / res.y; float2 uv = p / res.y;
  float2 q = uv * 1.6 + tilt * 0.12;
  float w = fbm(q + fbm(q * 1.4 + t * 0.03) * 1.3);
  float3 c = mix(float3(0.10, 0.02, 0.15), float3(0.42, 0.06, 0.40), smoothstep(0.2, 0.8, w));
  c = mix(c, float3(0.30, 0.10, 0.55), smoothstep(0.55, 0.95, fbm(q * 0.8 + 4.0)) * 0.6);
  float seda = sin((uv.x * 0.8 + uv.y + w * 0.9) * 9.0 + tilt.x * 2.0) * 0.5 + 0.5;
  c += float3(0.95, 0.45, 0.85) * pow(seda, 8.0) * 0.18;
  float2 L = luz(a); c += float3(0.95, 0.40, 0.80) * exp(-dot(uv - L, uv - L) * 3.0) * 0.30;
  c += float3(0.45, 0.70, 0.08) * smoothstep(0.55, 1.4, uv.x / a + uv.y) * 0.35;
  return half4(c, 1.0);
}`,
  bronce: `
half4 main(float2 p) {
  float a = res.x / res.y; float2 uv = p / res.y;
  // Bronce cepillado: cobre cálido con una banda de luz y un velo de pátina.
  float cep = noise(float2(uv.x * 1.2, uv.y * 230.0)) * 0.6 + noise(float2(uv.x * 3.0, uv.y * 80.0)) * 0.4;
  float3 c = mix(float3(0.22, 0.10, 0.04), float3(0.56, 0.31, 0.14), uv.y * 0.3 + cep * 0.55);
  float banda = exp(-sq((uv.x - a * (0.5 + tilt.x * 0.55)) * 2.3));
  c += float3(0.95, 0.62, 0.38) * banda * (0.30 + cep * 0.35);
  float patina = smoothstep(0.55, 0.85, fbm(uv * 2.2 + 5.0));
  c = mix(c, float3(0.20, 0.32, 0.27), patina * 0.10);
  float2 L = luz(a); c += float3(1.0, 0.70, 0.45) * exp(-dot(uv - L, uv - L) * 4.0) * 0.18;
  return half4(c, 1.0);
}`,
  plata: `
half4 main(float2 p) {
  float a = res.x / res.y; float2 uv = p / res.y;
  float cep = noise(float2(uv.x * 1.2, uv.y * 260.0)) * 0.6 + noise(float2(uv.x * 3.0, uv.y * 90.0)) * 0.4;
  float3 c = mix(float3(0.24, 0.27, 0.31), float3(0.50, 0.54, 0.60), uv.y * 0.4 + cep * 0.5);
  float banda = exp(-sq((uv.x - a * (0.5 + tilt.x * 0.55)) * 2.4));
  c += float3(0.55, 0.58, 0.62) * banda * (0.35 + cep * 0.35);
  float banda2 = exp(-sq((uv.x - a * (0.15 - tilt.x * 0.3)) * 5.0));
  c += float3(0.4) * banda2 * 0.18;
  c += float3(1.0) * destellos(p, 0.03, 1.6) * 0.5;
  return half4(c, 1.0);
}`,
  oro: `
half4 main(float2 p) {
  float a = res.x / res.y; float2 uv = p / res.y;
  float cep = noise(float2(uv.x * 1.2, uv.y * 240.0)) * 0.6 + noise(float2(uv.x * 3.0, uv.y * 80.0)) * 0.4;
  float3 c = mix(float3(0.30, 0.17, 0.01), float3(0.70, 0.46, 0.10), uv.y * 0.3 + cep * 0.55);
  float banda = exp(-sq((uv.x - a * (0.5 + tilt.x * 0.55)) * 2.2));
  c += float3(0.95, 0.75, 0.35) * banda * (0.35 + cep * 0.4);
  float2 L = luz(a); c += float3(1.0, 0.85, 0.45) * exp(-dot(uv - L, uv - L) * 4.0) * 0.25;
  c += float3(1.0, 0.95, 0.75) * destellos(p, 0.06, 2.0) * 0.9;
  return half4(c, 1.0);
}`,
  platino: `
half4 main(float2 p) {
  float a = res.x / res.y; float2 uv = p / res.y;
  float grano = noise(uv * 180.0) * 0.04;
  float3 c = float3(0.035, 0.038, 0.048) + grano;
  float fase = (uv.x * 0.5 + uv.y) * 0.9 + tilt.x * 0.9 - tilt.y * 0.6 + fbm(uv * 1.5) * 0.6;
  float3 iris = 0.5 + 0.5 * cos(6.2831 * (fase + float3(0.0, 0.33, 0.67)));
  float banda = exp(-sq((uv.x / a + uv.y * 0.5 - (0.75 + tilt.x * 0.6)) * 3.2));
  c += iris * banda * 0.26;
  float2 L = luz(a); c += float3(0.75, 0.80, 0.90) * exp(-dot(uv - L, uv - L) * 7.0) * 0.12;
  c += float3(0.9, 0.95, 1.0) * destellos(p, 0.04, 1.4) * 0.7;
  return half4(c, 1.0);
}`,
  // La tarjeta del EQUIPO (empleados, precio Mayoreo Plus por política):
  // fibra de carbono tejida con la franja de la marca, magenta a verde.
  empleado: `
half4 main(float2 p) {
  float a = res.x / res.y; float2 uv = p / res.y;
  // Grafito profundo con un tejido de carbono apenas visible.
  float2 q = float2(uv.x + uv.y, uv.x - uv.y) * 30.0;
  float2 f = fract(q); float par = mod(floor(q.x) + floor(q.y), 2.0);
  float hilo = par > 0.5 ? sin(f.x * 3.1416) : sin(f.y * 3.1416);
  float3 c = float3(0.035, 0.037, 0.045) + float3(0.045, 0.046, 0.055) * hilo * (0.6 + 0.4 * (par > 0.5 ? tilt.x : -tilt.x));
  // Guilloché: ondas finas concéntricas, como el fondo de seguridad de un billete.
  float2 cg = uv - float2(a * 0.18, 0.95);
  float ondas = sin(length(cg) * 140.0 + sin(atan(cg.y, cg.x) * 9.0) * 2.2);
  c += float3(0.55, 0.58, 0.66) * smoothstep(0.92, 1.0, ondas) * 0.05;
  // Banda de titanio satinado que sigue la inclinación.
  float banda = exp(-sq((uv.x / a + uv.y * 0.35 - (0.62 + tilt.x * 0.55)) * 3.2));
  c += float3(0.42, 0.44, 0.50) * banda * 0.22;
  // Las franjas de la marca: finas, metálicas, con un destello que las recorre.
  float d = (uv.x / a) - uv.y * 0.55 - (0.33 + tilt.x * 0.03);
  float magenta = smoothstep(0.0, 0.006, d) * (1.0 - smoothstep(0.034, 0.040, d));
  float verde = smoothstep(0.052, 0.058, d) * (1.0 - smoothstep(0.086, 0.092, d));
  float largo = uv.y * 1.2 + uv.x * 0.25;
  float brillo = exp(-sq((fract(t * 0.12) * 2.4 - 0.6) - largo) * 18.0);
  float3 metalM = float3(0.66, 0.11, 0.52) * (0.85 + 0.35 * banda) + float3(1.0, 0.75, 0.9) * brillo * 0.55;
  float3 metalV = float3(0.50, 0.70, 0.08) * (0.85 + 0.35 * banda) + float3(0.92, 1.0, 0.7) * brillo * 0.55;
  c = mix(c, metalM, magenta);
  c = mix(c, metalV, verde);
  // Filos de luz a los lados de las franjas.
  float filo = (1.0 - smoothstep(0.0, 0.0025, abs(d + 0.012))) + (1.0 - smoothstep(0.0, 0.0025, abs(d - 0.104)));
  c += float3(0.80, 0.82, 0.88) * filo * (0.18 + 0.5 * brillo);
  // Viñeta: más oscuro en los bordes, como una tarjeta metálica.
  c *= 0.78 + 0.22 * smoothstep(1.25, 0.25, length(uv - float2(a * 0.5, 0.5)));
  c += float3(1.0) * destellos(p, 0.015, 1.2) * 0.35;
  // El canto: un filo de luz fino en el borde, más brillante del lado de la luz.
  float borde = min(min(p.x, p.y), min(res.x - p.x, res.y - p.y));
  float canto = 1.0 - smoothstep(0.0, 2.2, borde);
  c += float3(0.75, 0.78, 0.86) * canto * (0.25 + 0.35 * banda);
  return half4(c, 1.0);
}`,
  jade: `
half4 main(float2 p) {
  float a = res.x / res.y; float2 uv = p / res.y;
  float2 q = uv * 1.7 + tilt * 0.08;
  // Profundidad: tres capas de nube a distinta escala, la de atrás más oscura.
  float fondo = fbm(q * 0.9 + 11.0);
  float w = fbm(q * 1.4 + fbm(q * 1.8 + t * 0.015) * 1.4);
  float3 c = mix(float3(0.01, 0.10, 0.07), float3(0.04, 0.33, 0.22), smoothstep(0.2, 0.8, fondo));
  c = mix(c, float3(0.16, 0.58, 0.40), smoothstep(0.45, 0.85, w) * 0.75);
  c = mix(c, float3(0.62, 0.90, 0.74), smoothstep(0.72, 0.95, w) * 0.35);
  // Vetas suaves, como hilos dentro de la piedra.
  float vena = 1.0 - smoothstep(0.0, 0.16, abs(fbm(q * 1.3 + 3.0) - 0.5));
  c = mix(c, float3(0.70, 0.92, 0.80), vena * vena * 0.14);
  // Motas finas, como los cristales dentro del jade.
  c += float3(0.5, 0.9, 0.7) * smoothstep(0.82, 0.95, noise(uv * 60.0)) * 0.05;
  // Luz que atraviesa: la piedra es translúcida.
  float2 L = luz(a); float d = length(uv - L);
  c += float3(0.30, 0.90, 0.62) * exp(-d * d * 2.2) * 0.30;
  // Brillo de pulido, ancho y suave.
  float cera = exp(-sq((uv.x * 0.55 + uv.y - (0.95 + tilt.x * 0.55)) * 2.2));
  c += float3(0.85, 1.0, 0.92) * cera * 0.10;
  c *= 0.82 + 0.18 * smoothstep(1.3, 0.2, length(uv - float2(a * 0.5, 0.5)));
  return half4(c, 1.0);
}`,
  zafiro: `
half4 main(float2 p) {
  float a = res.x / res.y; float2 uv = p / res.y;
  float3 c = gema(uv, 2.6, float3(0.0, 0.02, 0.10), float3(0.04, 0.16, 0.55), float3(0.45, 0.65, 1.0), 1.3);
  // Asterismo: la estrella de seis puntas del zafiro estrella, que corre con la luz.
  float2 c0 = float2(a * (0.66 + tilt.x * 0.28), 0.42 - tilt.y * 0.28);
  float2 r = uv - c0; float est = 0.0;
  for (int k = 0; k < 3; k++) {
    float ang = float(k) * 1.0472; float2 dir = float2(cos(ang), sin(ang));
    float dd = abs(dot(r, float2(-dir.y, dir.x)));
    est += exp(-dd * 70.0) * exp(-length(r) * 2.6);
  }
  c += float3(0.80, 0.88, 1.0) * est * 0.45 + float3(0.40, 0.58, 1.0) * exp(-dot(r, r) * 14.0) * 0.30;
  c += float3(0.85, 0.92, 1.0) * destellos(p, 0.02, 1.8) * 0.5;
  return half4(c, 1.0);
}`,
  rubi: `
half4 main(float2 p) {
  float a = res.x / res.y; float2 uv = p / res.y;
  float3 c = gema(uv, 2.8, float3(0.08, 0.0, 0.02), float3(0.55, 0.02, 0.10), float3(1.0, 0.36, 0.45), 4.2);
  // Fuego interior: un rojo encendido que sigue la luz.
  float2 L = luz(a); c += float3(0.90, 0.08, 0.18) * exp(-dot(uv - L, uv - L) * 2.6) * 0.30;
  c += float3(1.0, 0.85, 0.88) * destellos(p, 0.03, 2.2) * 0.6;
  return half4(c, 1.0);
}`,
  diamante: `
half4 main(float2 p) {
  float a = res.x / res.y; float2 uv = p / res.y;
  // Un brillante visto de frente: mesa octogonal al centro y anillos de
  // facetas TRIANGULARES (estrella, cometas, faja), con aristas rectas.
  float2 c0 = float2(a * (0.70 + tilt.x * 0.04), 0.50 - tilt.y * 0.04);
  float2 r = uv - c0; float ang = atan(r.y, r.x) + 0.3927;
  float paso = 6.2831853 / 8.0;
  // Distancia «octogonal»: con ella los anillos son octágonos, no círculos.
  float oct = length(r) * cos(mod(ang, paso) - paso * 0.5) / cos(paso * 0.5);
  // Anillos que crecen 1.6× cada uno: cerca de la mesa, facetas chicas; afuera,
  // más facetas por anillo para que no queden planchas grandes.
  float anillo = oct < 0.17 ? 0.0 : floor(log(oct / 0.17) / log(1.6)) + 1.0;
  float r0 = 0.17 * pow(1.6, anillo - 1.0);
  float r1 = r0 * 1.6;
  float N = anillo < 1.5 ? 8.0 : anillo < 3.5 ? 16.0 : 32.0;
  float fa = (ang / 6.2831853 + 0.5) * N; float sec = floor(fa); float fs = fract(fa);
  float fr = clamp((oct - r0) / (r1 - r0), 0.0, 1.0);
  // Cada sector se parte en un triángulo central y dos medios triángulos; en
  // los anillos impares, al revés: así encajan como en la talla real.
  float frP = mod(anillo, 2.0) == 1.0 ? fr : 1.0 - fr;
  float lado = abs(fs - 0.5) * 2.0;
  float tri = step(lado, frP);
  float id = hash(float2(sec * 2.0 + tri + (fs > 0.5 ? 0.0 : 0.5) * (1.0 - tri), anillo + 2.0));
  float2 n = hash2(float2(id * 91.0, id * 13.0)) * 2.0 - 1.0;
  float k = clamp(0.5 + 0.5 * (dot(n, tilt) * 1.4 + (id - 0.5) * 1.3) + (fs - 0.5) * 0.3 * n.x + (fr - 0.5) * 0.25 * n.y, 0.0, 1.0);
  float3 c = mix(float3(0.10, 0.12, 0.16), float3(0.88, 0.92, 0.99), k * k);
  // La mesa: plana, con un reflejo que se mueve.
  float mesa = 1.0 - step(0.17, oct);
  float3 cm = mix(float3(0.26, 0.30, 0.38), float3(0.80, 0.86, 0.95), 0.5 + 0.5 * sin(tilt.x * 3.0 + (uv.x + uv.y) * 7.0));
  c = mix(c, cm, mesa * 0.9);
  // Aristas finas y brillantes: entre sectores, entre anillos y la diagonal.
  float esc = length(r) * 6.2831853 / N;
  float dSec = min(fs, 1.0 - fs) * esc;
  float dAni = min(oct - r0, r1 - oct);
  float dTri = abs(lado - frP) * min(esc, (r1 - r0)) * 0.5;
  float d = anillo < 0.5 ? abs(oct - 0.17) : min(min(dSec, dAni), dTri);
  float arista = 1.0 - smoothstep(0.0, 0.0045, d);
  c += float3(0.92, 0.96, 1.0) * arista * 0.40;
  // Fuego: el arcoíris del diamante en las facetas que la luz toca.
  float tono = fract(id * 3.7 + tilt.x * 0.8 - tilt.y * 0.6 + t * 0.012);
  float3 arco = 0.5 + 0.5 * cos(6.2831 * (tono + float3(0.0, 0.33, 0.67)));
  c = mix(c, c * 0.5 + arco * 0.6, smoothstep(0.75, 1.0, k) * 0.40 * (1.0 - mesa));
  c += float3(1.0) * destellos(p, 0.07, 2.4) * 0.9;
  c *= 0.62 + 0.38 * smoothstep(0.0, 1.0, uv.x / a + (1.0 - uv.y) * 0.4);
  return half4(c, 1.0);
}`,
};
