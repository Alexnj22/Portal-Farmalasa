// Abrir una pantalla UNA vez (2026-10-07). Dos toques rápidos sobre una oferta
// la abrían dos veces (salía doble). Mientras una navegación está en curso
// (~700 ms) se ignora la siguiente; lo usan todos los toques que abren algo.
import { router } from 'expo-router';

let ocupadoHasta = 0;

export function navegar(destino) {
  const ahora = Date.now();
  if (ahora < ocupadoHasta) return;
  ocupadoHasta = ahora + 700;
  router.push(destino);
}
