// Ofertas exclusivas por nivel y atención preferente (2026-10-14).
//
// `ofertas_clientes.nivel_minimo`: null (todos) | plata | oro | platino |
// mayoreo. Todos VEN la oferta —es la invitación—; reservarla, sólo quien llega
// al nivel. Eso lo decide el servidor (`disponible_para_ti` y el freno de
// `reservar`); acá sólo se muestra.
//
// El modo de prueba (lib/prueba.js) también cuenta: la cuenta de prueba manda
// su nivel elegido y el servidor la deja mirar «como» ese nivel.
import { useCuenta } from './cuenta';
import { nivelDePrueba, useModoPrueba } from './prueba';
import { dolares } from './formato';

// El rótulo del badge, cómo se dice el botón apagado y el color (las claves de
// COLORES_NIVEL de la tarjeta de socio).
export const EXCLUSIVAS = {
  plata: { rotulo: 'Plata o más', boton: 'Disponible desde Plata', paleta: 'plata', nombre: 'Plata' },
  oro: { rotulo: 'Oro o más', boton: 'Disponible desde Oro', paleta: 'oro', nombre: 'Oro' },
  platino: { rotulo: 'Solo Platino', boton: 'Disponible desde Platino', paleta: 'platino', nombre: 'Platino' },
  mayoreo: { rotulo: 'Clientes Mayoristas', boton: 'Solo Clientes Mayoristas', paleta: 'jade', nombre: 'Cliente Mayorista' },
};

/** Lo que el modo de prueba agrega a un pedido (`ofertas`, `reservar`), o nada. */
export function datosDePrueba() {
  const p = useModoPrueba.getState();
  const r = useCuenta.getState().resumen;
  if (!r?.prueba || !p.activo) return {};
  return { prueba_nivel: p.nivel, prueba_mayorista: !!p.mayorista };
}

/**
 * Cómo ve la app a esta persona: su nivel (el objeto `nivel` del resumen, con
 * `siguiente`) y si es Cliente Mayorista aprobado. En prueba, los elegidos.
 */
export function useMiNivel() {
  const real = useCuenta((s) => s.resumen);
  const prueba = useModoPrueba();
  if (real?.prueba && prueba.activo) {
    return { nivel: nivelDePrueba(prueba.nivel), mayorista: !!prueba.mayorista };
  }
  return { nivel: real?.nivel ?? null, mayorista: real?.mayorista?.estado === 'aprobado' };
}

/** Atención preferente en el chat: Platino o Cliente Mayorista aprobado. */
export function usePreferente() {
  const { nivel, mayorista } = useMiNivel();
  return mayorista || nivel?.clave === 'platino';
}

/**
 * La línea corta de cómo llegar al nivel que pide la oferta. Usa lo que dice
 * el panel de Nivel: cuánto falta para el siguiente.
 */
export function comoLlegar(requerido, nivel) {
  if (requerido === 'mayoreo') return 'Es para Clientes Mayoristas aprobados. Pregunta en tu sucursal cómo serlo.';
  const ex = EXCLUSIVAS[requerido];
  if (!ex) return null;
  if (nivel?.activos === false) return `Los niveles de Puntos Salud llegan pronto: con tus compras subirás a ${ex.nombre}.`;
  const sig = nivel?.siguiente;
  if (sig && sig.falta > 0) {
    const dinero = dolares(sig.falta);
    return sig.clave === requerido
      ? `Te faltan ${dinero} en compras para llegar a ${ex.nombre}.`
      : `Te faltan ${dinero} en compras para subir a ${sig.nombre}; ${ex.nombre} viene después.`;
  }
  return `Sube a ${ex.nombre} con tus compras de los últimos 12 meses.`;
}
