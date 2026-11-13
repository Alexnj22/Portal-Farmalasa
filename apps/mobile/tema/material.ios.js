// En iOS no hay paleta de Material: las piezas usan los colores del sistema.
import { create } from 'zustand';
export const SEMILLA = undefined;
export const useVersionDePaleta = create(() => ({ v: 0 }));
export function paletaDe() { return null; }
export function refrescarPaleta() { return false; }
export function usePaleta() { return null; }
