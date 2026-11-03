#!/usr/bin/env node
// Los sonidos de la zona anti estrés de la app de clientes (2026-11-03),
// SINTETIZADOS acá: ninguno sale de una biblioteca de terceros, así que no hay
// licencia que cuidar, y se pueden regenerar o afinar cambiando un número.
//
//   node scripts/app-clientes-sonidos.mjs   → apps/clientes/assets/sonidos/*.wav
//
// 22.050 Hz, mono, 16 bits: alcanza para efectos cortos y pesa poco en la
// actualización por aire. Todo pasa por `suavizar` (un ataque de 4 ms y una
// caída al final) para que ningún sonido «chasquee» al empezar o terminar.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SR = 22050;
const DESTINO = resolve('apps/clientes/assets/sonidos');
mkdirSync(DESTINO, { recursive: true });

// Ruido determinista: el mismo archivo cada vez que se regenera.
let semilla = 20261103;
const azar = () => { semilla = (semilla * 1664525 + 1013904223) >>> 0; return semilla / 2 ** 32; };
const ruido = () => azar() * 2 - 1;

const muestras = (seg) => new Float32Array(Math.round(seg * SR));
const nota = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI → Hz

function suavizar(x, ataque = 0.004, caida = 0.02) {
  const a = Math.round(ataque * SR); const c = Math.round(caida * SR);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < c && i < x.length; i++) x[x.length - 1 - i] *= i / c;
  return x;
}
function normalizar(x, pico = 0.8) {
  let m = 0; for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= pico / m;
  return x;
}
function pasaBajos(x, corte) {
  const rc = 1 / (2 * Math.PI * corte); const dt = 1 / SR; const k = dt / (rc + dt);
  let y = 0; for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] = y; }
  return x;
}
function mezclar(...pistas) {
  const n = Math.max(...pistas.map((p) => p.length));
  const out = new Float32Array(n);
  for (const p of pistas) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}
function retrasar(x, seg) {
  const d = Math.round(seg * SR); const out = new Float32Array(x.length + d);
  out.set(x, d); return out;
}

// Una campanita: parciales inarmónicos, cada uno con su caída.
function campanita(f, dur, { parciales = [[1, 1, 1], [2.0, 0.35, 1.6], [3.01, 0.18, 2.4], [4.2, 0.08, 3.5]], tau = 0.35 } = {}) {
  const x = muestras(dur);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR; let v = 0;
    for (const [m, a, rapidez] of parciales) v += a * Math.sin(2 * Math.PI * f * m * t) * Math.exp(-t * rapidez / tau);
    x[i] = v;
  }
  return suavizar(x, 0.003, 0.05);
}
// Marimba: fundamental + el 4º parcial, caída rápida.
const marimba = (f, dur = 0.45) => campanita(f, dur, { parciales: [[1, 1, 1], [3.93, 0.25, 3.2], [9.2, 0.05, 7]], tau: 0.18 });

function pop(f0, f1, dur) {
  const x = muestras(dur); let fase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR; const f = f1 + (f0 - f1) * Math.exp(-t * 45);
    fase += (2 * Math.PI * f) / SR;
    x[i] = Math.sin(fase) * Math.exp(-t * 38) + ruido() * 0.35 * Math.exp(-t * 160);
  }
  return suavizar(x, 0.001, 0.01);
}

function cuencoTibetano(f, dur) {
  // Dos fundamentales apenas desafinadas: el «batido» lento que lo hace cantar.
  const x = muestras(dur);
  const parciales = [[1, 1, 0.55], [1.004, 0.6, 0.55], [2.76, 0.32, 0.9], [5.4, 0.12, 1.6], [8.9, 0.05, 2.6]];
  for (let i = 0; i < x.length; i++) {
    const t = i / SR; let v = 0;
    for (const [m, a, r] of parciales) v += a * Math.sin(2 * Math.PI * f * m * t) * Math.exp(-t * r);
    x[i] = v * (1 - Math.exp(-t * 60));
  }
  return suavizar(x, 0.002, 0.3);
}

// Un acorde suave que crece (inhalar) o se apaga (exhalar), para la guía.
function colchon(notas, dur, sube) {
  const x = muestras(dur);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR; const p = t / dur;
    const env = sube ? Math.sin((p * Math.PI) / 2) ** 2 * (1 - p ** 8) : Math.cos((p * Math.PI) / 2) ** 2;
    let v = 0;
    notas.forEach((n, k) => {
      const f = nota(n) * (sube ? 1 + 0.003 * p : 1 - 0.004 * p);
      v += Math.sin(2 * Math.PI * f * t + k) * (1 / (k + 1.4)) + 0.15 * Math.sin(2 * Math.PI * f * 2 * t);
    });
    x[i] = v * env * (0.85 + 0.15 * Math.sin(2 * Math.PI * 0.5 * t));
  }
  return suavizar(pasaBajos(x, 1800), 0.05, 0.25);
}

// Un bloque de madera que se apoya: golpe corto que baja de tono, con chasquido.
function bloque() {
  const x = muestras(0.2); let fase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR; const f = 210 + 260 * Math.exp(-t * 55);
    fase += (2 * Math.PI * f) / SR;
    x[i] = Math.sin(fase) * Math.exp(-t * 26) + ruido() * Math.exp(-t * 240) * 0.55;
  }
  return mezclar(suavizar(pasaBajos(x, 4200), 0.001, 0.02), marimba(nota(64), 0.25).map((v) => v * 0.3));
}

// La torre que se cae: golpes que bajan y un retumbo.
function derrumbe() {
  const golpe = (f0, dur) => {
    const x = muestras(dur); let fase = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / SR; const f = f0 * (0.6 + 0.4 * Math.exp(-t * 18));
      fase += (2 * Math.PI * f) / SR;
      x[i] = Math.sin(fase) * Math.exp(-t * 14) + ruido() * Math.exp(-t * 60) * 0.5;
    }
    return suavizar(pasaBajos(x, 1800), 0.001, 0.05);
  };
  const retumbo = muestras(0.9);
  let b = 0;
  for (let i = 0; i < retumbo.length; i++) { b = (b + 0.03 * ruido()) / 1.03; retumbo[i] = b * 4 * Math.exp(-(i / SR) * 4); }
  return mezclar(golpe(180, 0.4), retrasar(golpe(140, 0.4).map((v) => v * 0.8), 0.11),
    retrasar(golpe(110, 0.45).map((v) => v * 0.7), 0.24), retrasar(golpe(85, 0.5).map((v) => v * 0.6), 0.4),
    suavizar(pasaBajos(retumbo, 500), 0.01, 0.2));
}

function gota() {
  const x = muestras(0.32); let fase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR; const f = 700 + 900 * (1 - Math.exp(-t * 30));
    fase += (2 * Math.PI * f) / SR;
    x[i] = Math.sin(fase) * Math.exp(-t * 14) * (1 - Math.exp(-t * 400));
  }
  return mezclar(suavizar(x, 0.002, 0.04), retrasar(campanita(nota(91), 0.25, { tau: 0.1 }).map((v) => v * 0.15), 0.02));
}

function voltear() {
  const x = muestras(0.09);
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = ruido() * Math.exp(-t * 55) * (1 - Math.exp(-t * 900)); }
  pasaBajos(x, 3200);
  return mezclar(suavizar(x, 0.001, 0.01), marimba(nota(84), 0.09).map((v) => v * 0.25));
}

const PENTA = [72, 74, 76, 79, 81, 84]; // do pentatónica: nada suena «mal» con nada

const SONIDOS = {
  'pop-1': () => pop(1100, 380, 0.11),
  'pop-2': () => pop(950, 330, 0.11),
  'pop-3': () => pop(1250, 430, 0.1),
  voltear,
  par: () => mezclar(marimba(nota(81), 0.5), retrasar(marimba(nota(88), 0.6), 0.09)),
  fallo: () => mezclar(marimba(nota(67), 0.3).map((v) => v * 0.7), retrasar(marimba(nota(62), 0.35).map((v) => v * 0.6), 0.1)),
  ganar: () => mezclar(...[72, 76, 79, 84, 88].map((n, i) => retrasar(marimba(nota(n), 0.9), i * 0.11)),
    retrasar(campanita(nota(96), 1.2, { tau: 0.5 }).map((v) => v * 0.3), 0.55)),
  campana: () => cuencoTibetano(nota(57), 4.5),
  inhalar: () => colchon([57, 64, 69, 76], 4, true),
  exhalar: () => colchon([57, 64, 69, 72], 6, false),
  ...Object.fromEntries(PENTA.map((n, i) => [`toque-${i + 1}`, () => marimba(nota(n), 0.6)])),
  bloque,
  derrumbe,
  gota,
};

function escribirWav(nombre, x, pico) {
  normalizar(x, pico);
  const datos = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) datos.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0); cab.writeUInt32LE(36 + datos.length, 4); cab.write('WAVE', 8);
  cab.write('fmt ', 12); cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22);
  cab.writeUInt32LE(SR, 24); cab.writeUInt32LE(SR * 2, 28); cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34);
  cab.write('data', 36); cab.writeUInt32LE(datos.length, 40);
  writeFileSync(join(DESTINO, `${nombre}.wav`), Buffer.concat([cab, datos]));
  return datos.length + 44;
}

// Los fondos más bajos que los efectos: acompañan, no tapan.
const PICOS = { inhalar: 0.45, exhalar: 0.45, campana: 0.6 };
let total = 0;
for (const [nombre, hacer] of Object.entries(SONIDOS)) total += escribirWav(nombre, hacer(), PICOS[nombre] ?? 0.8);
console.log(`✓ ${Object.keys(SONIDOS).length} sonidos en ${DESTINO} (${Math.round(total / 1024)} KB)`);
