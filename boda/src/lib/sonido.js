import { useSyncExternalStore } from 'react';
import { boda } from '../config';

/*
 * La música del sitio: UN solo <audio> para todo (sobre, portada,
 * presentación). Vive en este módulo, fuera de cualquier pantalla: abrir el
 * sobre o cambiar de pestaña no la reinicia. `alternar()` llama a play()
 * dentro del mismo toque (en el iPhone, un await antes lo bloquea en silencio).
 */
let audio = null;
let estado = { sonando: false, iniciada: false };
const oyentes = new Set();
const fijar = (cambios) => { estado = { ...estado, ...cambios }; oyentes.forEach((f) => f()); };

function elAudio() {
  if (!audio && boda.musica) {
    audio = new Audio(boda.musica);
    audio.loop = true;
    audio.preload = 'auto';
    audio.addEventListener('pause', () => fijar({ sonando: false }));
    audio.addEventListener('playing', () => fijar({ sonando: true, iniciada: true }));
  }
  return audio;
}

export const hayMusica = () => !!boda.musica;

export function alternarMusica() {
  const a = elAudio();
  if (!a) return;
  if (!a.paused) { a.pause(); return; }
  const p = a.play();
  p?.catch((e) => { console.warn('La música no pudo empezar', e); fijar({ sonando: false }); });
}
export function callarMusica() { audio?.pause(); }

export function useMusica() {
  return useSyncExternalStore((f) => { oyentes.add(f); return () => oyentes.delete(f); }, () => estado);
}
