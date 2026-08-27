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

const ENCABEZADOS = [
    'Código', 'Nombre Completo', 'Sucursal', 'Cargo Principal', 'Cargo Secundario',
    'Estado operativo', 'Teléfono', 'DUI', 'Fecha Ingreso', 'Fecha Nacimiento',
];

/**
 * Baja el directorio. `nombreDeSucursal` es un `Map(id → nombre)`.
 *
 * `exportCsv` exige el módulo: sin él el archivo baja igual pero el egreso
 * queda como `sin-declarar`, que es un hallazgo visible en vez de un hueco.
 */
export function exportarDirectorio(personas, nombreDeSucursal) {
    const filas = soloPersonalEnPlanilla(personas).map(emp => ([
        emp.code,
        emp.name,
        nombreDeSucursal?.get(Number(emp.branchId || emp.branch_id)) || SIN_ASIGNAR,
        emp.role,
        emp.secondary_role,
        getEffectiveStatus(emp),
        emp.phone,
        emp.dui,
        emp.hire_date,
        emp.birth_date,
    ]));

    const hoy = new Date().toISOString().split('T')[0];
    exportCsv(ENCABEZADOS, filas, `Directorio_Personal_${hoy}.csv`, 'personal');
}
