import React from 'react';
import AvatarConEstado from '../common/AvatarConEstado';
import { shortEmployeeName } from '../../utils/nameUtils';

// ═══════════════════════════════════════════════════════════════════════════
// Quién anotó, con su cara.
//
// «SIEMPRE a la par del nombre la foto de quien lo hace, y siempre nombre y
// apellido» (usuario, 2026-08-25). Es el «atribuible» del RTS 6.1.14 dicho como
// se lee en una sala: una cara y dos palabras. Un nombre suelto en una grilla de
// seis celdas se lee como una etiqueta; una cara se reconoce sin leer.
//
// El nombre sale de `shortEmployeeName`, que arma «primer nombre + primer
// apellido» desde las columnas SEPARADAS. Partir `employees.name` —que es una
// columna generada— es adivinar dónde estaba la frontera: «DOLORES CONCEPCION
// TEJADA HERNANDEZ» cortado a dos palabras daba «DOLORES CONCEPCION», que son
// dos nombres y ningún apellido. Por eso el día trae `first_names` y
// `last_names` aparte.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {object} quien  `{ nombre, nombres, apellidos, foto }`
 * @param {string} hora   la hora en que quedó anotado
 * @param {boolean} tarde si entró fuera de su franja
 */
export default function Firma({ quien, hora, tarde }) {
    // `foto` va SIEMPRE: `AvatarConEstado` lee `photo`/`photo_url` y
    // `normalizarPersona` acepta `foto` — pero un objeto armado a mano que se
    // olvida la clave no falla, cae a las iniciales y se ve igual de bien. Es
    // por lo que la cara no salió desde que la RPC empezó a traerla.
    const emp = {
        first_names: quien?.nombres,
        last_names: quien?.apellidos,
        name: quien?.nombre,
        foto: quien?.foto,
    };
    return (
        <span className="flex items-center gap-1.5 min-w-0">
            <AvatarConEstado emp={emp} px={20} radio="rounded-full" />
            <span className="text-micro text-content-3 truncate">
                {shortEmployeeName(emp)}
                {hora && <> · <span className="tabular-nums">{hora}</span></>}
                {tarde && <span className="text-warning-text font-bold"> · tarde</span>}
            </span>
        </span>
    );
}
