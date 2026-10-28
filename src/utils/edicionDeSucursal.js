// Editar la ficha de una sucursal — horarios, legal, inmueble y servicios —:
// las reglas que comparten el formulario del portal (`FormSucursal` y sus
// pestañas) y la pantalla de la app (`sucursal/editar`).
//
// El guardado es UNO: `updateBranch` del store, que fusiona `settings` con lo
// que ya había (legal, renta, servicios y ubicación por separado) y escribe la
// fila entera. Por eso quien guarda le pasa la sucursal COMPLETA con sus
// cambios encima (`sucursalConCambios`): con sólo los cambios, `updateBranch`
// escribiría el nombre, la dirección y los teléfonos en blanco.
import { WEEK_DAYS } from '../data/constants';
import { correrMes, ultimoDiaDelMes } from './fecha';

/* `settings` y `weekly_hours` llegan a veces como texto JSON —una o varias
   veces serializado, herencia de guardados viejos—. Se desenvuelven hasta tres
   capas y se devuelve una copia que se puede cambiar sin tocar el original. */
const desenvolver = (raw) => {
    let v = raw;
    for (let i = 0; i < 3; i++) {
        if (typeof v === 'string') {
            try { v = JSON.parse(v); } catch { break; }
        }
    }
    if (!v || typeof v !== 'object') v = {};
    return JSON.parse(JSON.stringify(v));
};

export const limpiarAjustes = (raw) => desenvolver(raw);

/** El horario semanal; vacío, los siete días cerrados. */
export function limpiarHorario(raw) {
    const h = desenvolver(raw);
    if (Object.keys(h).length === 0) {
        WEEK_DAYS.forEach((d) => { h[d.id] = { isOpen: false, start: '', end: '' }; });
    }
    return h;
}

/** Un día del horario con la forma que espera la pantalla. */
export function diaDelHorario(horario, diaId) {
    const v = (horario || {})[diaId] || {};
    return {
        isOpen: v.isOpen === true,
        start: typeof v.start === 'string' ? v.start : '',
        end: typeof v.end === 'string' ? v.end : '',
    };
}

/** Cambia un día; cerrarlo borra sus horas. */
export function cambiarDiaDelHorario(horario, diaId, cambio) {
    const h = limpiarHorario(horario);
    const dia = { ...(h[diaId] || {}), ...cambio };
    if (dia.isOpen === false) { dia.start = ''; dia.end = ''; }
    h[diaId] = dia;
    return h;
}

/** Copia al día `indice` (de `WEEK_DAYS`) el horario del anterior, si estaba abierto. */
export function copiarDiaAnterior(horario, indice) {
    if (indice <= 0) return limpiarHorario(horario);
    const anterior = diaDelHorario(horario, WEEK_DAYS[indice - 1].id);
    if (!anterior.isOpen) return limpiarHorario(horario);
    return cambiarDiaDelHorario(horario, WEEK_DAYS[indice].id, { isOpen: true, start: anterior.start, end: anterior.end });
}

/** ¿Hay algún día abierto sin hora de apertura o de cierre? Así no se guarda. */
export const horarioIncompleto = (horario) =>
    Object.values(limpiarHorario(horario)).some((d) => d && d.isOpen && (!d.start || !d.end));

/**
 * Cuándo vence un contrato que empieza `inicio` (`AAAA-MM-DD`) y dura
 * `meses`. El mismo día del mes, o el último si ese mes es más corto.
 */
export function finDeContrato(inicio, meses) {
    const n = parseInt(meses, 10);
    if (!inicio || !n) return null;
    const mes = correrMes(String(inicio).slice(0, 7), n);
    const dia = String(inicio).slice(8, 10);
    const ultimo = ultimoDiaDelMes(mes);
    return dia > ultimo.slice(8, 10) ? ultimo : `${mes}-${dia}`;
}

export const OPCIONES_DE_EXTINTOR = [
    { value: 'ABC', label: 'Polvo químico seco (ABC)' },
    { value: 'CO2', label: 'Dióxido de carbono (CO2)' },
    { value: 'AGUA', label: 'Agua presurizada' },
    { value: 'ESPUMA', label: 'Espuma (AFFF)' },
    { value: 'K', label: 'Acetato de potasio (clase K)' },
    { value: 'MIXTO', label: 'Múltiples tipos' },
];

/**
 * Categoría del establecimiento ante la SRS (`settings.legal.srsCategoria`).
 * Se guarda el código ('1'|'2'|'3'); el rótulo es libre de cambiar.
 */
export const OPCIONES_CATEGORIA_SRS = [
    { value: '1', label: 'Categoría 1' },
    { value: '2', label: 'Categoría 2' },
    { value: '3', label: 'Categoría 3' },
];

/** El rótulo de la categoría SRS guardada, o null si no hay (o no se reconoce). */
export const rotuloCategoriaSrs = (valor) =>
    OPCIONES_CATEGORIA_SRS.find((o) => o.value === String(valor ?? ''))?.label ?? null;

/**
 * Los ids del personal de enfermería de una sala. La lista que manda es
 * `legal.nursingRegents` (filas con `employeeId`, documentos y anualidad: la
 * escriben el formulario de enfermería, la pestaña legal y la app). `legal.nurses`
 * —un arreglo de ids— lo escribía sólo la pestaña legal del portal y divergía:
 * se lee únicamente cuando la fila no tiene `nursingRegents` (filas viejas).
 */
export function idsDeEnfermeria(legal) {
    const l = legal || {};
    if (Array.isArray(l.nursingRegents)) {
        return l.nursingRegents.map((n) => n?.employeeId).filter((v) => v !== undefined && v !== null && v !== '');
    }
    return Array.isArray(l.nurses) ? l.nurses.filter((v) => v !== undefined && v !== null && v !== '') : [];
}

/**
 * Pone o quita a alguien del equipo de enfermería, sobre `nursingRegents`.
 * Si la sala sólo tenía la lista vieja (`nurses`), se parte de ella para no
 * perder a nadie. Quitar conserva las demás filas con sus documentos.
 */
export function alternarEnfermera(legal, empleadoId, ahora = Date.now()) {
    const l = legal || {};
    let lista = Array.isArray(l.nursingRegents)
        ? l.nursingRegents
        : idsDeEnfermeria(l).map((empId, i) => ({ id: ahora + i + 1, employeeId: empId, anualidadExp: '' }));
    const ya = lista.some((n) => String(n?.employeeId) === String(empleadoId));
    lista = ya
        ? lista.filter((n) => String(n?.employeeId) !== String(empleadoId))
        : [...lista, { id: ahora, employeeId: empleadoId, anualidadExp: '' }];
    return lista;
}

/** Los servicios básicos de una sala: la clave en `settings.services` y cómo se rotula. */
export const SERVICIOS_BASICOS = [
    { id: 'light', label: 'Energía eléctrica', placeholder: 'Ej. CAESS', accountLabel: 'Nº de NIC / NPE' },
    { id: 'water', label: 'Agua potable', placeholder: 'Ej. ANDA', accountLabel: 'Nº de Cuenta' },
    { id: 'internet', label: 'Internet fijo', placeholder: 'Ej. Tigo / Claro', accountLabel: 'Nº de Contrato / Teléfono' },
    { id: 'mobile', label: 'Telefonía móvil (flota)', placeholder: 'Ej. Claro', accountLabel: 'Nº de Teléfono' },
];

/** El día de pago de un servicio: entero entre 1 y 31, o vacío. */
export function diaDePago(valor) {
    const n = parseInt(valor, 10);
    if (!Number.isFinite(n)) return '';
    return Math.min(31, Math.max(1, n));
}

/** ¿El inmueble es alquilado? Lo dice la fila o sus ajustes. */
export const esAlquilada = (branch, ajustes) =>
    (branch?.propertyType || ajustes?.propertyType) === 'RENTED';

/**
 * La sucursal completa con los cambios encima, lista para `updateBranch`.
 * `ajustes` y `horario` reemplazan a los de la fila; lo demás se conserva.
 *
 * @param {any} branch
 * @param {{ ajustes?: any, horario?: any, tipoDeInmueble?: string, general?: any }} [cambios]
 */
export function sucursalConCambios(branch, { ajustes, horario, tipoDeInmueble, general } = {}) {
    const base = { ...(branch || {}) };
    const out = {
        ...base,
        name: base.name || base.branchName || '',
        settings: ajustes ? limpiarAjustes(ajustes) : limpiarAjustes(base.settings),
    };
    // Lo general (nombre, dirección, teléfonos, apertura): las mismas claves
    // que escribe `BranchTabGeneral` del portal.
    if (general) {
        out.name = String(general.name ?? out.name).trim();
        out.branchName = out.name;
        out.address = general.address ?? out.address ?? null;
        out.phone = general.phone ?? out.phone ?? null;
        out.cell = general.cell ?? out.cell ?? null;
        out.openingDate = general.openingDate ?? out.openingDate ?? out.opening_date ?? null;
        out.opening_date = out.openingDate;
    }
    if (horario) { out.weeklyHours = limpiarHorario(horario); out.weekly_hours = out.weeklyHours; }
    if (tipoDeInmueble) {
        out.propertyType = tipoDeInmueble;
        out.settings.propertyType = tipoDeInmueble;
        out.settings.rent = tipoDeInmueble === 'RENTED' ? (out.settings.rent || { contract: {} }) : null;
    }
    return out;
}

/**
 * Quién puede figurar en el legal de una sala, por su cargo: regentes (sin los
 * de enfermería), farmacovigilancia y enfermería. Por el texto del cargo, igual
 * que siempre lo hizo el formulario del portal.
 */
export function candidatosLegales(empleados) {
    const conCargo = (empleados || []).filter((e) => e.role);
    const cargo = (e) => String(e.role).toUpperCase();
    return {
        regentes: conCargo.filter((e) => cargo(e).includes('REGENTE') && !cargo(e).includes('ENFERMER')),
        farmacovigilancia: conCargo.filter((e) => cargo(e).includes('FARMACOVIGILANCIA')),
        enfermeria: conCargo.filter((e) => cargo(e).includes('ENFERMER')),
    };
}

/** Por qué no se puede guardar lo general, o null. Misma regla que el portal. */
export const problemaDeLoGeneral = (general) => (!String(general?.name || '').trim() ? 'Falta el Nombre Comercial.' : null);

/** Lo general de una sala tal como lo edita el formulario. */
export const generalDeSucursal = (b) => ({
    name: b?.name || b?.branchName || '',
    address: b?.address || '',
    phone: b?.phone || '',
    cell: b?.cell || '',
    openingDate: b?.openingDate || b?.opening_date || '',
});

/** El equipo de enfermería: agregar una fila vacía (con su id), quitarla o cambiarla, por POSICIÓN. */
export const conEnfermeraNueva = (lista, ahora = Date.now()) => [...(lista || []), { id: ahora, employeeId: '', anualidadExp: '' }];
export const sinEnfermera = (lista, indice) => (lista || []).filter((_, i) => i !== indice);
export const conEnfermeraCambiada = (lista, indice, campo, valor) => (lista || []).map((n, i) => (i === indice ? { ...n, [campo]: valor } : n));

/**
 * Qué movimiento es poner a alguien en la jefatura de una sala: ascenso (misma
 * sala, otro cargo), traslado (otra sala, mismo cargo), las dos cosas, o
 * lateral. Es el `moveType` que queda en la bitácora.
 */
export function tipoDeMovimiento(empleado, sala, cargo) {
    if (!empleado || !sala) return 'NONE';
    const mismaSala = String(empleado.branchId) === String(sala.id);
    const mismoCargo = empleado.role === cargo;
    if (mismaSala && !mismoCargo) return 'PROMOTION';
    if (!mismaSala && mismoCargo) return 'TRANSFER';
    if (!mismaSala && !mismoCargo) return 'TRANSFER_PROMOTION';
    return 'LATERAL';
}
export const TEXTO_DEL_MOVIMIENTO = { PROMOTION: 'Ascenso interno.', TRANSFER: 'Traslado operativo.', TRANSFER_PROMOTION: 'Traslado y ascenso.', LATERAL: 'Movimiento lateral.' };

/** Jefe y subjefe de una sala, como los detecta la ficha del portal (por el texto del cargo). */
export function jefaturaDeSucursal(gente, tipo) {
    const cargo = (e) => String(e.role || '').toLowerCase();
    if (tipo === 'ADMINISTRATIVA') {
        return {
            jefe: gente.find(e => cargo(e).includes('gerente')) || null,
            subjefe: gente.find(e => cargo(e).includes('administrador') || cargo(e).includes('admin')) || null,
        };
    }
    return {
        jefe: gente.find(e => cargo(e).includes('jefe') && !cargo(e).includes('subjefe')) || null,
        subjefe: gente.find(e => cargo(e).includes('subjefe')) || null,
    };
}

// ── Qué cambió al guardar la ficha (para la bitácora) ──
// `updateBranch` ya deja entradas propias para el regente, el referente y el
// tamaño del equipo de enfermería. Esto cubre todo lo demás —lo general, el
// legal, el horario, el inmueble y los servicios— para que una edición nunca
// quede sin rastro. Devuelve las secciones con los campos que cambiaron.

const ROTULO_DE_CAMPO = {
    name: 'nombre', address: 'dirección', phone: 'teléfono', cell: 'celular', opening_date: 'fecha de apertura',
    department: 'departamento', municipality: 'municipio', lat: 'ubicación', lng: 'ubicación', mapsUrl: 'enlace del mapa',
    srsPermit: 'resolución de la licencia', srsExpiration: 'vencimiento de la licencia', srsPermitUrl: 'documento de la licencia',
    srsCategoria: 'categoría SRS', srsInscripcion: 'inscripción SRS',
    regentCredentialExp: 'vencimiento credencial regente', regentCredentialUrl: 'contrato de regencia', regentInscriptionUrl: 'inscripción del regente',
    pharmacovigilanceExp: 'vencimiento credencial referente', farmacovigilanciaAuthUrl: 'designación de farmacovigilancia',
    injections: 'área de inyectables', nursingServicePermitUrl: 'permiso del área de inyectables', nursingServicePermitExp: 'vencimiento permiso de inyectables',
    nursingRegents: 'equipo de enfermería', nurses: 'equipo de enfermería',
    controlledBooks: 'libros controlados', controlledBooksRes: 'resolución de libros', controlledBooksExp: 'vencimiento de libros', controlledBooksUrl: 'documento de libros',
    municipalAccount: 'cuenta municipal', municipalExpiration: 'vencimiento solvencia municipal', municipalUrl: 'solvencia municipal',
    extinguisherCount: 'extintores', extinguisherType: 'tipo de extintor', extinguisherExpiration: 'recarga de extintores',
    pestControlCompany: 'empresa de fumigación', lastFumigationDate: 'última fumigación', fumigationUrl: 'certificado de fumigación',
    wasteManagement: 'manejo de desechos', wasteExpiration: 'vencimiento contrato de desechos', wasteUrl: 'contrato de desechos',
    propertyType: 'tipo de inmueble', amount: 'monto', landlordName: 'arrendante', landlordPhone: 'teléfono del arrendante', contract: 'contrato',
    light: 'energía eléctrica', water: 'agua potable', internet: 'internet', mobile: 'telefonía móvil',
    customDocs: 'documentos propios',
};

// Claves del legal que se editan en la pestaña de inmueble.
const LEGAL_DEL_INMUEBLE = new Set([
    'extinguisherCount', 'extinguisherType', 'extinguisherExpiration', 'pestControlCompany', 'lastFumigationDate',
    'fumigationUrl', 'wasteManagement', 'wasteExpiration', 'wasteUrl', 'municipalAccount', 'municipalExpiration', 'municipalUrl',
]);
// Ya tienen su entrada propia en `updateBranch`.
const LEGAL_CON_ENTRADA_PROPIA = new Set(['regentEmployeeId', 'pharmacovigilanceEmployeeId', 'farmacovigilanciaId']);

const ordenado = (v) => {
    if (Array.isArray(v)) return v.map(ordenado);
    if (v && typeof v === 'object') {
        return Object.keys(v).sort().reduce((o, k) => { if (v[k] !== undefined) o[k] = ordenado(v[k]); return o; }, {});
    }
    return v;
};
const vacio = (v) => v === undefined || v === null || v === ''
    || (Array.isArray(v) && v.length === 0)
    || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
const igual = (a, b) => (vacio(a) && vacio(b)) || JSON.stringify(ordenado(a)) === JSON.stringify(ordenado(b));
const clavesDistintas = (a, b) => {
    const x = a && typeof a === 'object' ? a : {};
    const y = b && typeof b === 'object' ? b : {};
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => !/File$/.test(k) && !igual(x[k], y[k]));
};
const fechaCorta = (v) => (v ? String(v).slice(0, 10) : v);

/**
 * Las secciones de la ficha que cambiaron entre `antes` y `despues` (filas con
 * `name`, `address`, `phone`, `cell`, `opening_date`, `weekly_hours` y
 * `settings`). Devuelve `{ seccion, campos }[]` en orden fijo; vacío si nada cambió.
 */
export function cambiosDeSucursal(antes, despues) {
    const a = antes || {};
    const d = despues || {};
    const sa = limpiarAjustes(a.settings);
    const sd = limpiarAjustes(d.settings);
    const secciones = { general: new Set(), legal: new Set(), horarios: new Set(), inmueble: new Set(), servicios: new Set(), documentos: new Set() };

    for (const k of ['name', 'address', 'phone', 'cell']) {
        if (!igual(a[k], d[k])) secciones.general.add(k);
    }
    if (!igual(fechaCorta(a.opening_date ?? a.openingDate), fechaCorta(d.opening_date ?? d.openingDate))) secciones.general.add('opening_date');
    clavesDistintas(sa.location, sd.location).forEach((k) => secciones.general.add(k));

    for (const k of clavesDistintas(sa.legal, sd.legal)) {
        if (LEGAL_CON_ENTRADA_PROPIA.has(k)) continue;
        (LEGAL_DEL_INMUEBLE.has(k) ? secciones.inmueble : secciones.legal).add(k);
    }

    if (!igual(limpiarHorario(a.weekly_hours ?? a.weeklyHours), limpiarHorario(d.weekly_hours ?? d.weeklyHours))) {
        secciones.horarios.add('weekly_hours');
    }

    if (!igual(sa.propertyType, sd.propertyType)) secciones.inmueble.add('propertyType');
    clavesDistintas(sa.rent, sd.rent).forEach((k) => secciones.inmueble.add(k));
    clavesDistintas(sa.services, sd.services).forEach((k) => secciones.servicios.add(k));
    if (!igual(sa.customDocs, sd.customDocs)) secciones.documentos.add('customDocs');

    return Object.entries(secciones)
        .filter(([, s]) => s.size > 0)
        .map(([seccion, s]) => ({ seccion, campos: [...s] }));
}

const ROTULO_DE_SECCION = { general: 'General', legal: 'Legal', horarios: 'Horarios', inmueble: 'Inmueble', servicios: 'Servicios', documentos: 'Documentos' };

/** El resumen legible de `cambiosDeSucursal`: «Legal: categoría SRS, inscripción SRS · Horarios». */
export function resumenDeCambios(cambios) {
    return (cambios || []).map(({ seccion, campos }) => {
        if (seccion === 'horarios') return ROTULO_DE_SECCION.horarios;
        const rotulos = [...new Set(campos.map((c) => ROTULO_DE_CAMPO[c] || c))];
        return `${ROTULO_DE_SECCION[seccion] || seccion}: ${rotulos.join(', ')}`;
    }).join(' · ');
}
