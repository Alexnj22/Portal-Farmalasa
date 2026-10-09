// Lo que necesita «Hacer corte» y qué acción ofrece la caja, para el portal
// (`MiCajaView`) y la app (`hacer-corte`, `efectivo`). Vivía dentro de la vista.
import { saldoDeBolsa } from './bolsasReparto';

/** Las bolsas de la sala que nacieron el día de caja abierto. */
export const bolsasDelDia = (bolsas, dia) => (bolsas || []).filter((b) => b.fecha && dia && b.fecha === dia);

/**
 * Lo que ya está embolsado de hoy. El sistema de la caja acumula el día entero,
 * así que el corte de la tarde espera también lo que se embolsó en la mañana.
 * Es el SALDO (a una bolsa se le pudo sacar una remesa), y las entregadas
 * cuentan: entregar no es un vale. Ver el porqué completo en `MiCajaView`.
 */
export const embolsadoDelDia = (bolsasDeHoy) => (bolsasDeHoy || []).reduce((t, b) => t + saldoDeBolsa(b), 0);

/** La sala cuenta SÓLO el cajón; lo declarado suma lo ya embolsado. */
export const declaradoDelCorte = (efectivoEnCajon, embolsado) => (Number(efectivoEnCajon) || 0) + (Number(embolsado) || 0);

/** Los vales de salida que se anotan antes del corte, sólo los de esta sala. */
export const valesDeLaSala = (filas, sala) => (filas || []).filter((p) => String(p.branch_id) === String(sala));

/**
 * Qué se puede hacer con la caja ahora, en el orden del portal:
 *   null            — sin permiso, sin sala, o no se pudo leer (no se ofrece NADA:
 *                      abrir una caja que ya está abierta la deja partida en dos)
 *   'cerrada-dia'   — ya salió el Z
 *   'abrir'         — cerrada
 *   'iniciar-turno' — abierta con el turno parado (`=== false`: sin observar,
 *                      el estado contesta `true`)
 *   'operar'        — corte, entrada, salida y cerrar el día
 */
export function accionDeLaCaja({ puedeOperar, sala, noSePudo, estado }) {
    if (!puedeOperar || !sala || noSePudo || !estado) return null;
    const diaCerrado = (estado.cortes || []).some((c) => c.tipo === 'Z');
    if (!estado.abierta) return diaCerrado ? 'cerrada-dia' : 'abrir';
    if (estado.turno_corriendo === false) return 'iniciar-turno';
    return 'operar';
}
