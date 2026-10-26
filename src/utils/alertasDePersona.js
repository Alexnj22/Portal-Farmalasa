/**
 * Lo que hay que saber HOY de una persona del equipo: datos que faltan en su
 * expediente, un documento que vence, su cumpleaños y su aniversario. Vivía en
 * `views/personal/EquiposView.jsx`; se mudó el 2026-10-01 para que el
 * directorio del teléfono diga exactamente lo mismo.
 *
 * Devuelve datos: el ícono va por NOMBRE (regla del núcleo portable) y cada
 * pantalla le pega el suyo. `variante`: warning | danger | chart-6 | success.
 */
import { faltantesDelExpediente } from './expediente';
import { getExpiringDocuments } from './documentExpiry';
import { hoySV, diaSV } from './fecha';

// «Hoy» es el de la sala, no el del reloj del equipo (`utils/fecha`): con
// `new Date()` el «¡Hoy cumple!» y el aniversario saltaban de día según la
// zona de la computadora. Se acepta un `Date` por compatibilidad con quien
// todavía lo pase, y se lee como día de El Salvador.
const diaDe = (hoy) => (hoy instanceof Date ? diaSV(hoy.getTime()) : String(hoy).slice(0, 10));
const partes = (dia) => String(dia).slice(0, 10).split('-').map(Number);

/**
 * Los rótulos de lo que le falta al expediente de una persona, leídos de su
 * fila del store. Lo usan la píldora «Faltan N datos» de la tarjeta y la marca
 * del avatar (`AvatarConEstado`): una sola cuenta para las dos.
 */
export function datosPendientesDePersona(emp) {
    if (!emp) return [];
    const faltan = [];
    // La lista sale de `faltantesDelExpediente`, la MISMA que el banner del
    // formulario. Esta tarjeta tenía la suya —fecha de nacimiento, DUI, ISSS y
    // el documento— y el 2026-10-26 la ficha de un dependiente decía «1 dato
    // por completar: Profesión u oficio» mientras su tarjeta no decía nada.
    // Dos listas de lo mismo terminan diciendo cosas distintas de la misma
    // persona, que es exactamente lo que `utils/expediente.js` vino a evitar.
    for (const f of faltantesDelExpediente(emp, { soloLoConocido: true })) faltan.push(f.label);
    // Lo que el expediente no mira y la tarjeta sí: los NÚMEROS previsionales.
    // El expediente pregunta si TIENE ISSS/AFP; acá se acusa al que dice que
    // tiene y no trae el número (así pasaron 7 fichas con AFP sin NUP, 2026-10-14).
    if (emp.identidad_conocida) {
        if (emp.isss_estado === 'TIENE' && !emp.isss_number) faltan.push('Número de ISSS');
        if (emp.afp_estado === 'TIENE' && !emp.afp_number) faltan.push('NUP de la AFP');
    }
    return faltan;
}

export function alertasDePersona(emp, hoy = hoySV()) {
    const salida = [];
    const faltan = [];
    const dia = diaDe(hoy);
    const [ty, tm, td] = partes(dia);
    faltan.push(...datosPendientesDePersona(emp));
    const docs = emp.employee_documents || [];
    if (faltan.length) {
        salida.push({
            key: 'pendiente', icono: 'AlertCircle', variante: 'warning',
            texto: faltan.length === 1 ? 'Falta 1 dato' : `Faltan ${faltan.length} datos`,
            title: `Información pendiente: ${faltan.join(', ')}`,
        });
    }

    const doc = getExpiringDocuments(docs)[0];
    if (doc) {
        const vencido = doc.daysLeft < 0;
        salida.push({
            key: 'documento', icono: 'ShieldAlert', variante: vencido ? 'danger' : 'warning',
            texto: vencido ? 'Documento vencido' : `Vence en ${doc.daysLeft} d`,
            title: `${doc.title || doc.category}: ${vencido ? 'vencido' : `vence en ${doc.daysLeft} día${doc.daysLeft === 1 ? '' : 's'}`}`,
        });
    }

    if (emp.birth_date) {
        const [by, bm, bd] = partes(emp.birth_date);
        // Mismo mes: los días que faltan son la resta de los días del mes.
        if (bm === tm) {
            const dias = bd - td;
            if (dias >= 0) {
                const cumple = ty - by;
                salida.push({
                    key: 'cumple', icono: 'Cake', variante: 'chart-6',
                    texto: dias === 0 ? `¡Hoy cumple ${cumple}!` : dias === 1 ? 'Cumple mañana' : `Cumple en ${dias} días`,
                    title: `Cumple ${cumple} años el día ${bd}`,
                });
            }
        }
    }

    if (emp.hire_date) {
        const [hy, hm, hd] = partes(emp.hire_date);
        if (hm === tm && hy < ty) {
            const anios = ty - hy;
            salida.push({
                key: 'aniversario', icono: 'Medal', variante: 'success',
                texto: `${anios} año${anios === 1 ? '' : 's'} en la empresa`,
                title: `Aniversario laboral el día ${hd} de este mes`,
            });
        }
    }
    return salida;
}

/**
 * Cuántos años CUMPLIDOS lleva la persona en la empresa, y su tramo. Lo pinta
 * el listón del avatar en el directorio (2026-10-26). Es otra cosa que el
 * aviso de aniversario de arriba: aquél sale sólo el mes del aniversario para
 * felicitar; éste está todo el año. Sin fecha de ingreso, o con menos de un
 * año, devuelve null: no se inventa un tramo.
 *
 *   1–5 bronce · 6–10 plata · 11–15 oro · 16+ platino
 */
export function antiguedadDePersona(emp, hoy = hoySV()) {
    const ingreso = emp?.hire_date || emp?.hireDate;
    if (!ingreso) return null;
    const [ty, tm, td] = partes(diaDe(hoy));
    const [hy, hm, hd] = partes(ingreso);
    if (!hy) return null;
    const anios = ty - hy - ((tm < hm || (tm === hm && td < hd)) ? 1 : 0);
    if (anios < 1) return null;
    const tramo = anios >= 16 ? 'platino' : anios >= 11 ? 'oro' : anios >= 6 ? 'plata' : 'bronce';
    return { anios, tramo, desde: String(ingreso).slice(0, 10) };
}

/** El orden de los grupos del directorio: La Popular, las Salud, Bodega, el resto, Administración, externos. */
export const pesoDeSucursal = (nombre) => {
    const b = (nombre || '').toUpperCase();
    if (b.includes('POPULAR')) return 1;
    if (b.includes('SALUD')) return 2;
    if (b.includes('BODEGA')) return 3;
    if (b.includes('ADMIN')) return 5;
    if (b.includes('EXTERNO')) return 99;
    return 4;
};
