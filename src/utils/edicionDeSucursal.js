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
 */
export function sucursalConCambios(branch, { ajustes, horario, tipoDeInmueble } = {}) {
    const base = { ...(branch || {}) };
    const out = {
        ...base,
        name: base.name || base.branchName || '',
        settings: ajustes ? limpiarAjustes(ajustes) : limpiarAjustes(base.settings),
    };
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
