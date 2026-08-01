// Reglas de validación de la ficha de cliente.
//
// Puras y sin React a propósito: el formulario las usa para pintar el campo en
// rojo mientras se escribe, pero son las mismas reglas que tiene que cumplir
// cualquier otro camino de escritura. El candado REAL sigue viviendo en el RPC
// `update_customer_fiscal` — esto es la capa que evita el viaje al servidor y,
// sobre todo, que evita descubrir el problema al momento de facturar.
//
// Dos orígenes distintos, y conviene no confundirlos:
//
//   FORMATO   espeja lo que el servidor ya rechaza (`es_dui_valido`,
//             `es_telefono_sv_valido`, el rango de retención). Si acá pasa y
//             allá no, es un bug de esta capa.
//   COMPLETO  lo que exige DTE 2.0 en el receptor y el servidor todavía NO
//             valida. Un dato faltante no rompe el guardado: rompe la factura,
//             semanas después y en la caja.
//
// LOS LARGOS SALEN DE LOS DATOS REALES, NO DE LA TEORÍA. Medido el 2026-08-01
// sobre las fichas ya portadas del ERP y sobre 60 DTE sellados por Hacienda:
//   · NIT  → 9 dígitos (30 fichas, es el DUI usado como NIT) o 14 (50 fichas)
//   · NRC  → 4 a 7 dígitos. En los DTE reales: 4→6 casos, 5→6, 6→33, 7→70.
// Exigir NRC de 7 —que es lo que uno escribiría de memoria— habría bloqueado 8
// fichas legítimas que hoy facturan sin problema. Mismo criterio que el
// teléfono: se cuentan DÍGITOS, no caracteres, así que el formato con o sin
// guiones da igual.
import { isValidDUIAlgorithm } from './duiUtils';

export const CONTRIBUYENTES = [
    'Contribuyente', 'Gran Contribuyente', 'Contribuyente Exento',
];

export const esContribuyente = (categoria) => CONTRIBUYENTES.includes(categoria);

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const vacio = (v) => !String(v ?? '').trim();

// ── Formato ──────────────────────────────────────────────────────────────────
// Todas devuelven `true` con el campo vacío: "vacío" es asunto de los
// requeridos, no del formato. Un campo opcional y vacío no está mal escrito.

// Prefijos del plan de numeración de El Salvador (SIGET): 2 para telefonía
// fija, y 5/6/7 para móvil. **El 5 es nuevo** — se habilitó el 29-oct-2025
// junto a los 6 y 7 que ya existían, así que una lista escrita de memoria hace
// un par de años lo dejaría afuera y rechazaría números legítimos.
const PREFIJOS_SV = /^[2567]/;

/**
 * Ocho dígitos con prefijo válido, o el código de país 503 delante.
 *
 * Se cuentan DÍGITOS, no caracteres: '7538-5899', '75385899' y '(503) 7538-5899'
 * son el mismo número y los tres valen.
 *
 * El prefijo es lo que separa un teléfono de un relleno: en las fichas ya
 * portadas hay 148 con '1111-1111' —que tiene 8 dígitos y pasaba la regla
 * vieja— y una con '9000-0144'. Como el formato solo se le exige a lo que se
 * toca, ninguna de esas queda congelada: se marcan cuando alguien las edita,
 * que es justo cuando hay una persona mirando para corregirlas.
 */
export const telefonoValido = (tel) => {
    let d = digitos(tel);
    if (d.length === 0) return true;
    if (d.startsWith('503') && d.length === 11) d = d.slice(3);
    return d.length === 8 && PREFIJOS_SV.test(d);
};

export const duiValido = (dui) => vacio(dui) || isValidDUIAlgorithm(dui);

/**
 * NIT: 14 dígitos, o 9 cuando la persona usa su DUI como NIT (permitido desde
 * 2018 para naturales).
 *
 * El de 9 se valida CONTRA EL DUI de la misma ficha, no con el dígito
 * verificador: si es el DUI, tiene que ser EL DUI. Comprobado sobre las fichas
 * ya portadas — de las 30 con NIT de 9 dígitos, 18 tienen DUI en la ficha y las
 * 18 coinciden exactamente, cero discrepancias. Así un dígito mal tecleado se
 * detecta aunque por casualidad pase el verificador.
 *
 * Si la ficha no trae DUI (12 de esas 30), no hay contra qué comparar y se cae
 * al verificador, que es lo mejor disponible sin inventar un rechazo.
 */
export const nitValido = (nit, dui) => {
    const d = digitos(nit);
    if (d.length === 0) return true;
    if (d.length === 14) return true;
    if (d.length !== 9) return false;
    const dd = digitos(dui);
    if (dd.length === 9) return d === dd;
    return isValidDUIAlgorithm(d);
};

/**
 * NRC: entre 4 y 8 dígitos.
 *
 * El rango sale de contar 115 NRC dentro de 60 DTE REALES sellados por
 * Hacienda (emisor y receptor): 4 dígitos en 6 casos, 5 en 6, 6 en 33 y 7 en
 * 70. Ni uno de 8. La documentación de terceros habla de un formato de 8
 * ("01234567"), probablemente rellenando con ceros a la izquierda, así que el
 * tope se deja en 8 para no rechazar algo legítimo que no vimos — el error caro
 * acá es el falso negativo. El piso de 4 sí es firme y es el que atrapa el
 * typo real: alguien escribiendo un DUI de 9 dígitos en el campo del NRC.
 */
export const nrcValido = (nrc) => {
    const d = digitos(nrc);
    return d.length === 0 || (d.length >= 4 && d.length <= 8);
};

// Deliberadamente permisiva. Un correo con un TLD raro es válido, y una regex
// estricta rechaza direcciones reales — el error caro acá es el falso negativo.
export const correoValido = (correo) =>
    vacio(correo) || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(correo).trim());

export const retencionValida = (pct) => {
    if (vacio(pct)) return true;
    const s = String(pct).trim();
    return /^\d{1,3}$/.test(s) && Number(s) <= 100;
};

// ── Completitud (DTE 2.0) ────────────────────────────────────────────────────
// El receptor de un DTE necesita estos campos. A un contribuyente se le exige
// más porque su documento es un CCF: acredita IVA y lleva los datos fiscales.
const REQUERIDOS_BASE = ['name', 'phone', 'departamento', 'municipio', 'distrito'];
const REQUERIDOS_FISCAL = [...REQUERIDOS_BASE, 'nit', 'nrc', 'giro', 'email', 'direccion'];

export const camposRequeridos = (categoria) =>
    esContribuyente(categoria) ? REQUERIDOS_FISCAL : REQUERIDOS_BASE;

export const ETIQUETA_CAMPO = {
    name: 'Nombre', categoria: 'Categoría', dui: 'DUI', nit: 'NIT', nrc: 'NRC',
    pasaporte: 'Pasaporte', giro: 'Giro', phone: 'Teléfono', telefono2: 'Teléfono 2',
    email: 'Correo', direccion: 'Dirección', departamento: 'Departamento',
    municipio: 'Municipio', distrito: 'Distrito', retencion_pct: 'Retención %',
    notes: 'Notas',
};

// ── El veredicto ─────────────────────────────────────────────────────────────

// [campo, de qué campos depende, prueba, mensaje]. Las dependencias existen
// porque el NIT se valida contra el DUI: cambiar el DUI tiene que volver a
// juzgar el NIT aunque el NIT no se haya tocado.
const FORMATO = [
    ['name',          ['name'],        (f) => !vacio(f.name),               'No puede quedar vacío'],
    ['dui',           ['dui'],         (f) => duiValido(f.dui),             'No pasa el dígito verificador'],
    ['nit',           ['nit', 'dui'],  (f) => nitValido(f.nit, f.dui),      '14 dígitos, o el DUI de esta ficha'],
    ['nrc',           ['nrc'],         (f) => nrcValido(f.nrc),             'Entre 4 y 8 dígitos'],
    ['phone',         ['phone'],       (f) => telefonoValido(f.phone),      '8 dígitos, empezando en 2, 5, 6 o 7'],
    ['telefono2',     ['telefono2'],   (f) => telefonoValido(f.telefono2),  '8 dígitos, empezando en 2, 5, 6 o 7'],
    ['email',         ['email'],       (f) => correoValido(f.email),        'No parece un correo válido'],
    ['retencion_pct', ['retencion_pct'], (f) => retencionValida(f.retencion_pct), 'Un entero de 0 a 100'],
];

/**
 * `{ errores, faltan, ok }` para una ficha.
 *
 * `errores` va por campo y es lo que pinta el input en rojo. `faltan` es la
 * lista de requeridos vacíos — se reporta aparte porque no es lo mismo "lo
 * escribiste mal" que "todavía no lo llenaste", y el aviso se lee distinto.
 *
 * EL FORMATO SOLO SE LE EXIGE A LO QUE LA PERSONA TOCÓ, y por eso hace falta
 * `original`. Es la misma decisión que ya tomó el servidor —"DUI y teléfonos se
 * validan SOLO si cambiaron"— y por la misma razón: el catálogo heredado del
 * ERP trae 2 DUI que no pasan el verificador, y exigirlos siempre dejaría esas
 * fichas congeladas. Nadie podría arreglarles el correo sin adivinar antes un
 * DUI que quizá nadie sabe. Sin `original` se valida todo, que es lo correcto
 * para una ficha nueva.
 *
 * Los REQUERIDOS sí se exigen siempre, y la diferencia no es caprichosa: un
 * campo vacío se puede llenar ahí mismo —el distrito es un desplegable— así que
 * bloquear es accionable. Un DUI heredado y malo no se puede deducir de nada:
 * bloquear ahí sería un callejón sin salida.
 *
 * La cascada geográfica NO se valida acá: `normalizarGeo` la mantiene coherente
 * por construcción (cambiar el departamento limpia municipio y distrito), así
 * que un estado incoherente no es alcanzable desde el formulario. El servidor
 * igual lo vuelve a chequear, que es donde corresponde.
 */
export function validarCliente(form, original) {
    const f = form || {};
    const cambio = (campo) => !original
        || String(original[campo] ?? '') !== String(f[campo] ?? '');

    const errores = {};
    for (const [campo, deps, prueba, mensaje] of FORMATO) {
        if (deps.some(cambio) && !prueba(f)) errores[campo] = mensaje;
    }
    const faltan = camposRequeridos(f.categoria)
        .filter(c => vacio(f[c]) && !errores[c]);

    return {
        errores,
        faltan,
        ok: Object.keys(errores).length === 0 && faltan.length === 0,
    };
}
