// ─────────────────────────────────────────────────────────────────────────────
// Del punto en el mapa a la ficha de la sucursal (2026-10-29).
// ─────────────────────────────────────────────────────────────────────────────
//
// `maps-proxy` (acción `ubicar`) devuelve la dirección del punto tal como la
// escribe OpenStreetMap. Acá se traduce a los TRES campos de la ficha —y al
// catálogo del portal, nunca como texto suelto—, y se decide qué se escribe.
//
// Medido con La Popular (14.1862698, -89.2277867):
//   { road: '1a Avenida Norte', town: 'Agua Caliente',
//     municipality: 'Chalatenango Centro', state: 'Chalatenango' }
// O sea: `municipality` trae el municipio de la reforma de 2024 (uno de los 44
// del catálogo) y `town`/`village`/`city`, el distrito. Si el municipio no
// viene, se deduce del distrito —los 262 cuelgan de exactamente uno—.

import {
    EL_SALVADOR_GEO, EL_SALVADOR_DISTRITOS, departamentoDeMunicipio,
} from '../data/elSalvadorGeo';

const norm = (s) => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

const DEPARTAMENTOS = new Map(Object.keys(EL_SALVADOR_GEO).map(d => [norm(d), d]));
const MUNICIPIOS = new Map(Object.values(EL_SALVADOR_GEO).flat().map(m => [norm(m), m]));
// distrito → municipio. Hay nombres de distrito repetidos entre departamentos
// (p. ej. «San Antonio»): esos se guardan TODOS y se desempatan con el
// departamento; sin departamento, un nombre ambiguo no decide nada.
const MUNICIPIOS_DEL_DISTRITO = new Map();
for (const [mun, distritos] of Object.entries(EL_SALVADOR_DISTRITOS)) {
    for (const d of distritos) {
        const k = norm(d);
        MUNICIPIOS_DEL_DISTRITO.set(k, [...(MUNICIPIOS_DEL_DISTRITO.get(k) || []), mun]);
    }
}

const departamentoDe = (texto) =>
    DEPARTAMENTOS.get(norm(texto).replace(/^departamento de /, '')) || null;

/**
 * La dirección de OpenStreetMap → `{ departamento, municipio, distrito, direccion }`
 * del catálogo. Lo que no se reconoce queda en `null`: nunca se adivina.
 */
export function ubicacionDesdeDireccion(address) {
    if (!address || typeof address !== 'object') {
        return { departamento: null, municipio: null, distrito: null, direccion: null };
    }
    let departamento = departamentoDe(address.state) || departamentoDe(address.county);

    let municipio = null;
    for (const k of ['municipality', 'county', 'city', 'town']) {
        const m = MUNICIPIOS.get(norm(address[k]));
        if (m) { municipio = m; break; }
    }

    const nombreDistrito = address.town || address.village || address.city || address.city_district || address.hamlet || null;
    let distrito = null;
    if (nombreDistrito) {
        const candidatos = MUNICIPIOS_DEL_DISTRITO.get(norm(nombreDistrito)) || [];
        const posibles = candidatos.filter(m =>
            (!municipio || m === municipio) &&
            (!departamento || departamentoDeMunicipio(m) === departamento));
        if (posibles.length === 1) {
            municipio = municipio || posibles[0];
            distrito = EL_SALVADOR_DISTRITOS[posibles[0]].find(d => norm(d) === norm(nombreDistrito)) || null;
        }
    }
    // El municipio manda: sus 44 nombres son únicos en el país.
    if (municipio) departamento = departamentoDeMunicipio(municipio) || departamento;

    const calle = [address.road, address.house_number].filter(Boolean).join(' ');
    const barrio = address.neighbourhood || address.suburb || address.quarter || null;
    const partes = [calle, barrio, nombreDistrito].filter(Boolean);
    const direccion = partes.length ? [...new Set(partes)].join(', ') : null;

    return { departamento, municipio, distrito, direccion };
}

const vacio = (v) => v == null || String(v).trim() === '';

/**
 * Qué se escribe en la ficha. Decisión del usuario (2026-10-29): **sólo se
 * llena lo vacío**. Lo que la sucursal ya tiene y no coincide se informa, no se
 * pisa — la dirección que escribe la gente («frente al parque») suele ser mejor
 * que la del mapa.
 *
 * @param actual  `{ department, municipality, address }` de la ficha
 * @param hallado lo que devolvió `ubicacionDesdeDireccion`
 * @returns `{ cambios, distintos }` — `cambios` con las claves de la ficha;
 *          `distintos`, la lista `{ campo, actual, mapa }` para avisar.
 */
export function completarUbicacion(actual = {}, hallado = {}) {
    const cambios = {};
    const distintos = [];
    const dep = actual.department, mun = actual.municipality;

    if (hallado.departamento) {
        if (vacio(dep)) cambios.department = hallado.departamento;
        else if (norm(dep) !== norm(hallado.departamento)) {
            distintos.push({ campo: 'Departamento', actual: dep, mapa: hallado.departamento });
        }
    }
    // El municipio sólo se escribe si queda dentro del departamento que va a
    // tener la ficha: un municipio de otro departamento sería una ficha rota.
    const depFinal = cambios.department || dep;
    if (hallado.municipio) {
        const encaja = !depFinal || departamentoDeMunicipio(hallado.municipio) === depFinal ||
            norm(departamentoDeMunicipio(hallado.municipio)) === norm(depFinal);
        if (vacio(mun) && encaja) cambios.municipality = hallado.municipio;
        else if (!vacio(mun) && norm(mun) !== norm(hallado.municipio)) {
            distintos.push({ campo: 'Municipio', actual: mun, mapa: hallado.municipio });
        }
    }
    if (hallado.direccion && vacio(actual.address)) cambios.address = hallado.direccion;

    return { cambios, distintos };
}

/** El enlace que se guarda cuando el punto se eligió en el mapa (no vino de un enlace). */
export const enlaceDelPunto = (lat, lng) =>
    `https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(7)},${Number(lng).toFixed(7)}`;
