// El tema de la app sale de `src/constants/tokens.json`, que a su vez sale de
// `src/index.css` (F6). No se escribe un color a mano acá: si el portal cambia
// un tono, la app lo recibe al recompilar.
//
// La app usa los temas SÓLIDOS (`solid` / `solid-dark`): el vidrio del portal
// depende de `backdrop-filter`, que en el teléfono cuesta batería y no aporta
// información.
import { useColorScheme } from 'react-native';
import tokens from '@nucleo/constants/tokens.json';

const REM = 16;

/** '0.75rem' → 12 · '24px' → 24 · lo demás, tal cual. */
export function medida(valor) {
  if (typeof valor !== 'string') return valor;
  const m = valor.trim().match(/^(-?[\d.]+)(px|rem)$/);
  if (!m) return valor;
  return m[2] === 'rem' ? Number(m[1]) * REM : Number(m[1]);
}

function armar(nombre) {
  const t = tokens.temas[nombre];
  const tactil = tokens.variantes.tactil;
  return {
    nombre,
    color: {
      marca: t.brand,
      marcaTexto: t['brand-text'],
      fondo: t['bg-page'],
      tarjeta: t['surface-card'],
      borde: t['border-card'],
      texto: t['text-primary'],
      texto2: t['text-secondary'],
      texto3: t['text-tertiary'],
      peligro: t.danger,
      peligroTexto: t['danger-text'],
      exito: t.success,
      exitoTexto: t['success-text'],
      aviso: t.warning,
      avisoTexto: t['warning-text'],
    },
    radio: {
      tarjeta: medida(t['card-radius']),
      control: medida(t['input-radius']),
      boton: medida(t['btn-radius']),
    },
    // El teléfono usa la densidad TÁCTIL del portal: blanco de dedo de 44.
    tam: {
      toque: medida(tactil['tap-min']),
      control: medida(tactil['control-h']),
      fila: medida(tactil['row-h']),
      relleno: medida(tactil['space-card-padding']),
    },
    texto: {
      caption: medida(t['text-caption']),
      cuerpo: medida(t['text-body']),
      titulo: medida(t['text-title']),
    },
  };
}

const CLARO = armar('solid');
const OSCURO = armar('solid-dark');

/** Un color de la paleta con transparencia, para el fondo de un tono. */
export function suave(hex, alfa = 0.12) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return hex + Math.round(alfa * 255).toString(16).padStart(2, '0');
}

export function useTema() {
  return useColorScheme() === 'dark' ? OSCURO : CLARO;
}
