// En iOS no hay paleta de Material: las piezas usan los colores del sistema.
import { Fragment, useEffect, useState } from 'react';
import { Appearance, AppState } from 'react-native';
import { create } from 'zustand';
export const SEMILLA = undefined;
export const useVersionDePaleta = create(() => ({ v: 0 }));
export function paletaDe() { return null; }
export function refrescarPaleta() { return false; }
export function usePaleta() { return null; }

// iOS 26 pone el buscador de la barra (`headerSearchBarOptions`) ABAJO, en la
// barra de herramientas. La burbuja del chat flotaba en el mismo rincón y lo
// tapaba (usuario, 2026-11-13). Cada pantalla avisa aquí si tiene buscador
// mientras está enfocada; la burbuja se pone encima.
export const useBuscadorAbajo = create(() => ({ claves: {} }));
function marcar(clave, si) {
  useBuscadorAbajo.setState((s) => {
    if (!!s.claves[clave] === si) return s;
    const claves = { ...s.claves };
    if (si) claves[clave] = true; else delete claves[clave];
    return { claves };
  });
}
function vigilar(navigation, route) {
  if (navigation.__buscador !== undefined) return;
  navigation.__buscador = false;
  const clave = route?.key ?? String(Math.random());
  const original = navigation.setOptions.bind(navigation);
  const actualizar = () => marcar(clave, !!navigation.__buscador && navigation.isFocused());
  navigation.setOptions = (opciones) => {
    if (opciones && 'headerSearchBarOptions' in opciones) { navigation.__buscador = !!opciones.headerSearchBarOptions; actualizar(); }
    return original(opciones);
  };
  navigation.addListener('focus', actualizar);
  navigation.addListener('blur', () => marcar(clave, false));
  navigation.addListener('beforeRemove', () => marcar(clave, false));
}
// La línea Mostrador (tema/papel.js) lee la marca como hex del modo ACTUAL
// (`MARCA.azul`, `MARCA.azulClaro`, `useTema`): al pasar de claro a oscuro con
// la app abierta, una pantalla que no se vuelve a dibujar se quedaría con los
// del modo anterior. Como en Android con la paleta del sistema, cada pantalla
// se vuelve a montar cuando cambia el modo (el historial y la pantalla en la
// que se estaba se conservan). Sólo con la app al frente: iOS saca la foto del
// selector de apps en los DOS modos y avisa el cambio estando en segundo
// plano; montar todo por eso perdería lo escrito sin que nadie cambiara nada.
// Al volver al frente se compara con el modo vigente.
function useModoAlFrente() {
  const [modo, setModo] = useState(() => Appearance.getColorScheme());
  useEffect(() => {
    const revisar = () => { if (AppState.currentState === 'active') setModo(Appearance.getColorScheme()); };
    const a = Appearance.addChangeListener(revisar);
    const b = AppState.addEventListener('change', revisar);
    return () => { a.remove(); b.remove(); };
  }, []);
  return modo;
}
// La pantalla vieja se quita UN cuadro antes de poner la nueva (lo mismo que
// `Redibujo` en material.js): si no, React Navigation borra las opciones de la
// barra de la vieja DESPUÉS de que la nueva puso las suyas.
function PorModo({ children }) {
  const modo = useModoAlFrente() || 'sistema';
  const [montado, setMontado] = useState(modo);
  useEffect(() => {
    if (montado === modo) return undefined;
    const t = requestAnimationFrame(() => setMontado(modo));
    return () => cancelAnimationFrame(t);
  }, [modo, montado]);
  return montado === modo ? <Fragment key={montado}>{children}</Fragment> : null;
}
// Una sola función por lista de excepciones (identidad fija): si cambiara en
// cada render, React Navigation volvería a montar cada pantalla. `excepto`:
// rutas que son otra pila (las pestañas), que se redibujan por su cuenta.
const CAPAS = new Map();
export function useRedibujarConPaleta(excepto = []) {
  const clave = excepto.join('|');
  if (!CAPAS.has(clave)) {
    CAPAS.set(clave, ({ route, navigation, children }) => {
      vigilar(navigation, route);
      return excepto.includes(route?.name) ? children : <PorModo>{children}</PorModo>;
    });
  }
  return CAPAS.get(clave);
}
