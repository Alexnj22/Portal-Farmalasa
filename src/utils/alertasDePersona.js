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

export function alertasDePersona(emp, ahora = new Date()) {
    const salida = [];
    const faltan = [];
    const menor = (calcAge(emp.birth_date) ?? 99) < MINOR_AGE;
    if (!emp.birth_date) faltan.push('fecha de nacimiento');
    if (emp.identidad_conocida) {
        if (menor) {
            if (!emp.alt_identity_document) faltan.push('número de documento de identidad');
        } else if (!emp.dui) {
            faltan.push('DUI');
        }
        if (!emp.isss_number && !emp.afp_number) faltan.push('ISSS / AFP');
    }
    const docs = emp.employee_documents || [];
    const tieneIdentidad = menor
        ? docs.some(d => d.category === 'DOCUMENTO_IDENTIDAD' && d.url)
        : docs.some(d => d.category === 'DUI_FRENTE' && d.url) && docs.some(d => d.category === 'DUI_REVERSO' && d.url);
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
        const b = new Date(`${emp.birth_date}T12:00:00`);
        const hoy = new Date(ahora); hoy.setHours(12, 0, 0, 0);
        if (b.getMonth() === hoy.getMonth()) {
            const esteAnio = new Date(hoy.getFullYear(), b.getMonth(), b.getDate(), 12, 0, 0, 0);
            const dias = Math.round((esteAnio.getTime() - hoy.getTime()) / 86400000);
            if (dias >= 0) {
                const cumple = hoy.getFullYear() - b.getFullYear();
                salida.push({
                    key: 'cumple', icono: 'Cake', variante: 'chart-6',
                    texto: dias === 0 ? `¡Hoy cumple ${cumple}!` : dias === 1 ? 'Cumple mañana' : `Cumple en ${dias} días`,
                    title: `Cumple ${cumple} años el día ${b.getDate()}`,
                });
            }
        }
    }

    if (emp.hire_date) {
        const h = new Date(`${emp.hire_date}T12:00:00`);
        const hoy = new Date(ahora);
        if (h.getMonth() === hoy.getMonth() && h.getFullYear() < hoy.getFullYear()) {
            const anios = hoy.getFullYear() - h.getFullYear();
            salida.push({
                key: 'aniversario', icono: 'Medal', variante: 'success',
                texto: `${anios} año${anios === 1 ? '' : 's'} en la empresa`,
                title: `Aniversario laboral el día ${h.getDate()} de este mes`,
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
