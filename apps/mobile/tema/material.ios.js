// En iOS no hay paleta de Material: las piezas usan los colores del sistema.
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
// Una sola función (identidad fija): si cambiara en cada render, React
// Navigation volvería a montar cada pantalla.
const CAPA = ({ route, navigation, children }) => { vigilar(navigation, route); return children; };
export function useRedibujarConPaleta() { return CAPA; }
