// ── El directorio de personal que sale del portal ──────────────────────────
//
// Vive acá y no dentro de una vista porque desde el 2026-08-26 lo ofrecen DOS
// pantallas —el equipo por sucursal y el listado— y un CSV duplicado se separa
// solo: basta que alguien agregue una columna en una y no en la otra para que
// el mismo archivo, bajado desde dos botones, traiga datos distintos. Y este
// archivo sale del portal, queda anotado en `export_log` y termina en el correo
// de alguien.
//
// `soloPersonalEnPlanilla` otra vez aunque la vista ya filtre, y no es de más:
// el archivo se llama «Directorio_Personal» y su contenido no puede depender de
// qué pestaña estaba abierta. Acá el filtro no es de pantalla, es del documento
// — que es cómo una cuenta de pruebas se cuela en un papel de personal.

import { exportCsv } from './csvExport';
import { soloPersonalEnPlanilla } from './tipoDeFicha';
import { getEffectiveStatus } from './helpers';
import { SIN_ASIGNAR } from '../data/constants';

// ── Las columnas, y cuáles pueden no estar ─────────────────────────────────
//
// Dos de estas diez NO viven en `employees_safe` y llegan por una función que
// contesta según quien pregunta: el DUI por `get_employee_identidad` (llave
// `staff_detail`) y el código de carné por `get_vendedores` (llave `ventas`).
// Sin la llave llegan `undefined`, y una columna de 48 celdas vacías en un
// archivo que se llama «Directorio_Personal» no se lee como «no me dejaron
// verlo»: se lee como «acá nadie tiene DUI». Es el mismo defecto que el
// listado tenía en la píldora de pendientes, con el agravante de que un CSV
// sale del portal y se comparte por correo.
//
// Por eso la columna que no se puede llenar NO VA. Un archivo con nueve
// columnas dice la verdad sobre sí mismo; uno con diez y una vacía, no.
const COLUMNAS = [
    { titulo: 'Código',            llave: 'credenciales', valor: (e) => e.code },
    { titulo: 'Nombre Completo',   valor: (e) => e.name },
    { titulo: 'Sucursal',          valor: (e, ctx) => ctx.nombreDeSucursal?.get(Number(e.branchId || e.branch_id)) || SIN_ASIGNAR },
    { titulo: 'Cargo Principal',   valor: (e) => e.role },
    { titulo: 'Cargo Secundario',  valor: (e) => e.secondary_role },
    { titulo: 'Estado operativo',  valor: (e) => getEffectiveStatus(e) },
    { titulo: 'Teléfono',          valor: (e) => e.phone },
    { titulo: 'DUI',               llave: 'identidad', valor: (e) => e.dui },
    { titulo: 'Fecha Ingreso',     valor: (e) => e.hire_date },
    { titulo: 'Fecha Nacimiento',  valor: (e) => e.birth_date },
];

/**
 * Baja el directorio. `nombreDeSucursal` es un `Map(id → nombre)`.
 *
 * `llaves` dice qué pudo leer quien descarga: `{ identidad, credenciales }`.
 * Se pasa desde la vista —que es la que conoce los permisos— y no se adivina
 * mirando si las celdas vinieron vacías: un directorio de gente a la que
 * genuinamente le falta el DUI se vería igual, y ahí la columna SÍ tiene que
 * salir, vacía, porque eso es justamente lo que hay que ver.
 *
 * `exportCsv` exige el módulo: sin él el archivo baja igual pero el egreso
 * queda como `sin-declarar`, que es un hallazgo visible en vez de un hueco.
 */
export function exportarDirectorio(personas, nombreDeSucursal, llaves = {}) {
    const columnas = COLUMNAS.filter(c => !c.llave || llaves[c.llave]);
    const ctx = { nombreDeSucursal };
    const filas = soloPersonalEnPlanilla(personas)
        .map(emp => columnas.map(c => c.valor(emp, ctx)));

    const hoy = new Date().toISOString().split('T')[0];
    exportCsv(columnas.map(c => c.titulo), filas, `Directorio_Personal_${hoy}.csv`, 'personal');
}
