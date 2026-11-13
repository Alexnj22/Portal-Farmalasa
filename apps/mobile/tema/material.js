// La paleta de Material 3 de la app en Android: la del SISTEMA (Material You,
// Android 12+), que sale del fondo de pantalla de cada teléfono — lo nativo de
// Android (decisión del usuario, 2026-11-12: «que el tono principal lo tome del
// color del SO»). En Android 11 o anterior, Material da su paleta base.
//
// Todo <Host> de Compose sin `seedColor` ya toma esa paleta; las piezas de
// React Native (tarjetas, barras, acento de botones y enlaces) la leen de acá
// para verse igual que las de Compose.
//
// La paleta se guarda en memoria, pero se VUELVE A LEER al volver a la app
// (`refrescarPaleta`, desde app/_layout.js): si la persona cambió el fondo de
// pantalla o los colores del sistema, la app los toma sin cerrarla (usuario,
// 2026-11-12: «si cambio el tema en android, al volver a la app no se cambia»).
//
// `SEMILLA` queda en undefined a propósito: si algún día se quiere la paleta
// fija de la marca, se pone aquí un color y todos los Host y piezas la siguen.
import { Fragment, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { create } from 'zustand';
import { getMaterialColors } from '@expo/ui/jetpack-compose';
import { paletaDelSistema } from '../modules/colores-sistema';

export const SEMILLA = undefined;

let cache = {};
// Cuántas veces cambió la paleta: los componentes que la usan se vuelven a
// dibujar cuando sube.
export const useVersionDePaleta = create(() => ({ v: 0 }));

// Sin hook, para los colores que se leen fuera de un componente (colorSistema).
export function paletaDe(oscuro) {
  const k = oscuro ? 'dark' : 'light';
  if (!cache[k]) {
    // Sin semilla: la del sistema VIGENTE, leída en el proceso aparte del
    // módulo `colores-sistema` (la de @expo/ui se queda con la del arranque:
    // ver ese módulo). En un binario sin el módulo, la de @expo/ui.
    const delSistema = SEMILLA ? null : paletaDelSistema(oscuro);
    if (delSistema) cache[k] = delSistema;
    else { try { cache[k] = getMaterialColors({ scheme: k, ...(SEMILLA ? { seedColor: SEMILLA } : {}) }); } catch { cache[k] = null; } }
  }
  return cache[k];
}

// Relee la paleta del sistema. Devuelve true si cambió.
export function refrescarPaleta() {
  const antes = JSON.stringify([cache.light?.primary, cache.dark?.primary, cache.light?.surface, cache.dark?.surface]);
  cache = {};
  paletaDe(false); paletaDe(true);
  const ahora = JSON.stringify([cache.light?.primary, cache.dark?.primary, cache.light?.surface, cache.dark?.surface]);
  if (antes === ahora) return false;
  useVersionDePaleta.setState((s) => ({ v: s.v + 1 }));
  return true;
}

export function usePaleta() {
  useVersionDePaleta((s) => s.v);
  return paletaDe(useColorScheme() === 'dark');
}

// Para el `screenLayout` de una pila: cuando la paleta cambia, cada pantalla
// abierta se vuelve a montar y toma los colores nuevos. Hace falta porque
// `colorSistema` se lee al dibujar y una pantalla que no se vuelve a dibujar
// se queda con los del arranque (enlaces, textos). Se monta de nuevo la
// PANTALLA, no la pila: el historial y la pantalla en la que se estaba se
// conservan. `excepto`: rutas que son otra pila (las pestañas), que se
// redibujan por su cuenta.
//
// La pantalla vieja se quita UN cuadro antes de poner la nueva: React
// Navigation borra las opciones de la barra (título, botones) al desmontar la
// vieja, y si las dos pasan en el mismo cambio, el borrado llega DESPUÉS de
// que la nueva puso las suyas (medido: «Personal» quedaba sin título ni
// botones). Se devuelve siempre (también antes del primer cambio), para que la
// envoltura ya esté puesta y el primer cambio pase por el mismo camino.
function Redibujo({ v, children }) {
  const [montada, setMontada] = useState(v);
  useEffect(() => {
    if (montada === v) return undefined;
    const t = requestAnimationFrame(() => setMontada(v));
    return () => cancelAnimationFrame(t);
  }, [v, montada]);
  return montada === v ? <Fragment key={montada}>{children}</Fragment> : null;
}

export function useRedibujarConPaleta(excepto = []) {
  const v = useVersionDePaleta((s) => s.v);
  return ({ route, children }) => (excepto.includes(route?.name) ? children : <Redibujo v={v}>{children}</Redibujo>);
}
