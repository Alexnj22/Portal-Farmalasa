// Elige el backend: Supabase si hay variables de entorno, si no el modo demo
// (todo en el navegador). Ambos exponen exactamente la misma interfaz.
import * as local from './localApi';
import * as remoto from './supabaseApi';

export const modoDemo = !(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export const api = modoDemo ? local : remoto;

export const esVideo = (ruta = '') => /\.(mp4|mov|webm)$/i.test(ruta);
