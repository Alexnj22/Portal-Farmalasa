// El tema de la app sale de `src/constants/tokens.json`, que a su vez sale de
// `src/index.css` (F6). No se escribe un color a mano acá: si el portal cambia
// un tono, la app lo recibe al recompilar.
//
// La app usa los temas SÓLIDOS (`solid` / `solid-dark`): el vidrio del portal
// depende de `backdrop-filter`, que en el teléfono cuesta batería y no aporta
// información.
//
// Línea Mostrador (2026-11-19, docs/DISENO-MOSTRADOR.md §0): los COLORES son los
// doce de Papel (tema/papel.js) y las formas, las de Relieve — tarjeta 28 y
// todo control en píldora. Las medidas táctiles siguen saliendo de tokens.json.
// En Android la marca es el color del SISTEMA (`MARCA.azul`, Material You).
import { Platform, useColorScheme } from 'react-native';
import tokens from '@nucleo/constants/tokens.json';
import { papel, RADIO } from './papel';
import { MARCA } from '../componentes/inicio/marca';

const REM = 16;

/** '0.75rem' → 12 · '24px' → 24 · lo demás, tal cual. */
export function medida(valor) {
  if (typeof valor !== 'string') return valor;
  const m = valor.trim().match(/^(-?[\d.]+)(px|rem)$/);
  if (!m) return valor;
  return m[2] === 'rem' ? Number(m[1]) * REM : Number(m[1]);
}

function armar(nombre, oscuro) {
  const t = tokens.temas[nombre];
  const tactil = tokens.variantes.tactil;
  const p = papel(oscuro);
  return {
    nombre,
    color: {
      get marca() { return Platform.OS === 'android' ? MARCA.azul : p.marca; },
      get marcaTexto() { return Platform.OS === 'android' ? MARCA.azulClaro : p.marcaTexto; },
      marcaSuave: p.marcaSuave,
      fondo: p.fondo,
      tarjeta: p.superficie,
      hundida: p.hundida,
      borde: p.linea,
      texto: p.tinta,
      texto2: p.tinta2,
      texto3: p.tinta3,
      peligro: p.error,
      peligroTexto: p.error,
      exito: p.exito,
      exitoTexto: p.exito,
      aviso: p.aviso,
      avisoTexto: p.aviso,
    },
    radio: {
      tarjeta: RADIO.tarjeta,
      control: RADIO.pildora,
      boton: RADIO.pildora,
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

const CLARO = armar('solid', false);
const OSCURO = armar('solid-dark', true);

/** Un color de la paleta con transparencia, para el fondo de un tono. */
export function suave(hex, alfa = 0.12) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return hex + Math.round(alfa * 255).toString(16).padStart(2, '0');
}

export function useTema() {
  return useColorScheme() === 'dark' ? OSCURO : CLARO;
}
