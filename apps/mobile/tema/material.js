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
import { Appearance, useColorScheme } from 'react-native';
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

// La lupa y la ✕ del buscador de la barra son piezas nativas que toman su
// color del tema con que ARRANCÓ la actividad: al pasar de oscuro a claro con
// la app abierta quedaban blancas sobre la barra clara. Las 77 pantallas con
// buscador ponen sus opciones con `setOptions`; en vez de tocarlas una por
// una, se intercepta acá el `setOptions` de cada pantalla y se le agrega el
// color (`headerIconColor`), salvo que la pantalla ya traiga uno.
//
// Al cambiar de claro a oscuro NO se vuelve a montar la pantalla: la lupa
// nativa es la misma de antes y un buscador montado de nuevo no se la vuelve a
// pintar (react-native-screens sólo la colorea al crearla o al actualizar el
// MISMO buscador). Se le reenvían sus últimas opciones con el color nuevo.
const conBuscador = new Set();
function conColorDeIconos(opciones) {
  const busca = opciones?.headerSearchBarOptions;
  if (!busca) return opciones;
  if (busca.__colorPropio) { const { __colorPropio, ...propio } = busca; return { ...opciones, headerSearchBarOptions: propio }; }
  const color = paletaDe(Appearance.getColorScheme() === 'dark')?.onSurface;
  return color ? { ...opciones, headerSearchBarOptions: { ...busca, headerIconColor: color } } : opciones;
}
function interceptarOpciones(navigation) {
  if (!navigation || navigation.__conColorDeIconos) return;
  const original = navigation.setOptions;
  navigation.setOptions = (opciones) => {
    if (opciones?.headerSearchBarOptions) {
      // La pantalla que trae su propio color lo conserva.
      if (opciones.headerSearchBarOptions.headerIconColor) opciones = { ...opciones, headerSearchBarOptions: { ...opciones.headerSearchBarOptions, __colorPropio: true } };
      navigation.__ultimas = opciones;
      conBuscador.add(navigation);
    }
    return original(conColorDeIconos(opciones));
  };
  navigation.__reenviar = () => { if (navigation.__ultimas) original(conColorDeIconos(navigation.__ultimas)); };
  navigation.__conColorDeIconos = true;
}
Appearance.addChangeListener(() => {
  for (const nav of conBuscador) {
    try { nav.__reenviar(); } catch { conBuscador.delete(nav); }
  }
});

export function useRedibujarConPaleta(excepto = []) {
  const v = useVersionDePaleta((s) => s.v);
  return ({ route, navigation, children }) => {
    interceptarOpciones(navigation);
    return excepto.includes(route?.name) ? children : <Redibujo v={v}>{children}</Redibujo>;
  };
}

// Sólo iOS lleva el buscador abajo (ver material.ios.js); en Android va arriba.
export const useBuscadorAbajo = create(() => ({ claves: {} }));
