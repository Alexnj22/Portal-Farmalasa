// Los colores salen de `src/constants/tokens.json` (que sale de `src/index.css`):
// no se escribe un color a mano. A diferencia de la app del personal, ésta SÍ
// habla con los colores del logo: es la cara de la marca para el cliente
// (DESIGN.md §6 los reserva para donde «la app habla de sí misma», y acá es
// toda la app). El reparto es el del afiche de la vitrina y el de /mis-puntos:
// verde lo que se GANA, magenta lo que se USA.
import { useColorScheme } from 'react-native';
import tokens from '@nucleo/constants/tokens.json';

const REM = 16;
function medida(v) {
  if (typeof v !== 'string') return v;
  const m = v.trim().match(/^(-?[\d.]+)(px|rem)$/);
  if (!m) return v;
  return m[2] === 'rem' ? Number(m[1]) * REM : Number(m[1]);
}

function armar(nombre) {
  const t = tokens.temas[nombre];
  const tactil = tokens.variantes.tactil;
  return {
    oscuro: nombre.endsWith('dark'),
    color: {
      verde: t['logo-green'],
      verdeTexto: t['logo-green-text'],
      magenta: t['logo-magenta'],
      magentaTexto: t['logo-magenta-text'],
      marca: t.brand,
      fondo: t['bg-page'],
      tarjeta: t['surface-card'],
      borde: t['border-card'],
      texto: t['text-primary'],
      texto2: t['text-secondary'],
      texto3: t['text-tertiary'],
      peligro: t.danger,
      peligroTexto: t['danger-text'],
      exitoTexto: t['success-text'],
      aviso: t.warning,
      avisoTexto: t['warning-text'],
    },
    radio: { tarjeta: medida(t['card-radius']) * 1.5, control: medida(t['input-radius']) * 1.5 },
    tam: { toque: medida(tactil['tap-min']), control: medida(tactil['control-h']) },
  };
}

const CLARO = armar('solid');
const OSCURO = armar('solid-dark');

export function suave(hex, alfa = 0.14) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return hex + Math.round(alfa * 255).toString(16).padStart(2, '0');
}

export function useTema() {
  return useColorScheme() === 'dark' ? OSCURO : CLARO;
}
