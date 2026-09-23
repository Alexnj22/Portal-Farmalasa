/* La hora del portal, en formato de 12 horas SIEMPRE.
 *
 * Regla del usuario (23-sep): «necesito que las horas sean 12 horas siempre.
 * No en un lado 12 y en otras 24». Hasta ese día convivían cuatro formas: las
 * 24 horas de los avisos («corte de las 13:06»), «1:06 p.m.» de `helpers`,
 * «1:06 pm» de `scheduleHelpers`, «1:00 PM» de `formatHourAMPM`, y la de la
 * campana, que sale del navegador: «1:06 p. m.».
 *
 * Gana la de la campana —la del idioma, con el espacio de «p. m.»— porque es
 * la que ya se ve en cada aviso. Su gemela en la base es `public.hora_12(time)`,
 * que escribe los títulos de los avisos: las dos tienen que decir lo mismo.
 */

const ZONA = 'America/El_Salvador';
const NB = '\u00a0';

/**
 * «13:06», «13:06:00», un `Date` o un ISO → «1:06 p. m.».
 * Un texto «HH:MM» se toma como hora de reloj, sin zona. Un `Date` o un ISO
 * se lee en la hora de El Salvador. Devuelve '' si no entiende la entrada.
 */
export function hora12(valor) {
    if (valor == null || valor === '') return '';
    const reloj = typeof valor === 'string' ? /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(valor.trim()) : null;
    if (reloj) {
        const h = Number(reloj[1]);
        if (h > 23) return '';
        // Espacios que no se cortan: «1:06 p.» en un renglón y «m.» en el otro
        // se leía como un error.
        return `${h % 12 || 12}:${reloj[2]}${NB}${h < 12 ? `a.${NB}m.` : `p.${NB}m.`}`;
    }
    const d = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(d.getTime())) return '';
    const partes = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: false, timeZone: ZONA,
    }).formatToParts(d);
    const h = Number(partes.find((p) => p.type === 'hour')?.value) % 24;
    const m = partes.find((p) => p.type === 'minute')?.value ?? '00';
    return hora12(`${h}:${m}`);
}

/** Un rango de reloj: «14:00», «16:15» → «2:00 – 4:15 p. m.» (un solo sufijo
 *  si las dos caen en la misma mitad del día). */
export function rango12(desde, hasta) {
    const a = hora12(desde);
    const b = hora12(hasta);
    if (!a || !b) return a || b;
    const corte = (t) => t.indexOf(NB);
    return a.slice(corte(a)) === b.slice(corte(b)) ? `${a.slice(0, corte(a))} – ${b}` : `${a} – ${b}`;
}
