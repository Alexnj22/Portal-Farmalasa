/**
 * Lo que hay que saber HOY de una persona del equipo: datos que faltan en su
 * expediente, un documento que vence, su cumpleaños y su aniversario. Vivía en
 * `views/personal/EquiposView.jsx`; se mudó el 2026-10-01 para que el
 * directorio del teléfono diga exactamente lo mismo.
 *
 * Devuelve datos: el ícono va por NOMBRE (regla del núcleo portable) y cada
 * pantalla le pega el suyo. `variante`: warning | danger | chart-6 | success.
 */
import { calcAge, MINOR_AGE } from './ageUtils';
import { getExpiringDocuments } from './documentExpiry';
import { hoySV, diaSV } from './fecha';

// «Hoy» es el de la sala, no el del reloj del equipo (`utils/fecha`): con
// `new Date()` el «¡Hoy cumple!» y el aniversario saltaban de día según la
// zona de la computadora. Se acepta un `Date` por compatibilidad con quien
// todavía lo pase, y se lee como día de El Salvador.
const diaDe = (hoy) => (hoy instanceof Date ? diaSV(hoy.getTime()) : String(hoy).slice(0, 10));
const partes = (dia) => String(dia).slice(0, 10).split('-').map(Number);

export function alertasDePersona(emp, hoy = hoySV()) {
    const salida = [];
    const faltan = [];
    const dia = diaDe(hoy);
    const [ty, tm, td] = partes(dia);
    const menor = (calcAge(emp.birth_date, dia) ?? 99) < MINOR_AGE;
    if (!emp.birth_date) faltan.push('fecha de nacimiento');
    if (emp.identidad_conocida) {
        if (menor) {
            if (!emp.alt_identity_document) faltan.push('número de documento de identidad');
        } else if (!emp.dui) {
            faltan.push('DUI');
        }
        if (!emp.isss_number && !emp.afp_number) faltan.push('ISSS / AFP');
        // Con ISSS cargado la línea de arriba calla, y así pasaron 7 fichas que
        // dicen «tiene AFP» sin el NUP (2026-10-14).
        else if (emp.afp_estado === 'TIENE' && !emp.afp_number) faltan.push('NUP de la AFP');
    }
    const docs = emp.employee_documents || [];
    const tiene = (cat) => docs.some(d => d.category === cat && d.url);
    // La misma regla que `faltantesDelExpediente` (utils/expediente.js): el
    // DUI vale como las dos caras sueltas O como un solo archivo que las trae.
    // Exigiendo siempre dos, la tarjeta decía «Falta 1 dato» sobre un
    // expediente que la ficha daba por completo.
    const tieneIdentidad = menor
        ? tiene('DOCUMENTO_IDENTIDAD')
        : tiene('DUI_COMPLETO') || (tiene('DUI_FRENTE') && tiene('DUI_REVERSO'));
    if (!tieneIdentidad) faltan.push('documento de identidad');
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
