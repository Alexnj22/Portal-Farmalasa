// Quién ve la ayuda de Saly (docs/PLAN-SALY-AYUDA-EN-PANTALLA-2026-11-04.md).
//
// Vive aparte de `salyAyuda.js` porque el marco del portal (AppLayout) lo
// pregunta en CADA pantalla: importado desde allá, el chunk de arranque se
// llevaba también lo que Caja y Cortes usan de Saly (~16 kB de fuente), porque
// un módulo vive en un solo chunk con la unión de lo que se le pide. Medido el
// 2026-11-06 con sourcemaps. `salyAyuda.js` lo re-exporta.

/* EN PRUEBA (usuario, 2026-11-04: «que solo salga a Edwin ahorita, lo probaré
 * bien primero»). Las fichas (`employees.id`) que ven la ayuda; `null` = todos.
 * La función `saly-ayuda` tiene la MISMA lista: para abrirla a todos se cambian
 * las dos. */
export const SALY_AYUDA_SOLO_PARA = ['bbc796d7-7435-495b-9306-a2115f44a18f'];   // Edwin Núñez
export const salyAyudaParaMi = (employeeId) =>
    SALY_AYUDA_SOLO_PARA == null || SALY_AYUDA_SOLO_PARA.includes(String(employeeId ?? ''));
