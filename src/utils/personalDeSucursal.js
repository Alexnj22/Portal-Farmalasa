/**
 * El personal de una sucursal visto como lo mira la pestaña Personal del
 * portal (`branch-tabs/TabStaff.jsx`) y la ficha de la app
 * (`apps/mobile/app/sucursal/[id].js`): la «Salud legal» (jefatura, regente,
 * referente de farmacovigilancia y, si la sala inyecta, enfermería con sus
 * documentos), el mínimo de personal (`calculateMinimumStaff`) contra la
 * cobertura real, y la foto que se le manda a la IA (`analizarSucursal`).
 *
 * Vivía dentro de la pestaña del portal; se movió acá para que la app no lo
 * copie. Pura: no lee la base ni el navegador.
 */
import { jefaturaDeSucursal } from './edicionDeSucursal';
import { personalNormativoDeSucursal } from './expedienteDeSucursal';
import { calculateMinimumStaff } from './staffHelpers';

/** Mínimo de personal en la sala a la vez (seguridad por turno). */
export const MIN_PERSONAL_SIMULTANEO = 2;

/**
 * @param {object} args
 * @param {object} args.sucursal  la sucursal (`type`, `settings.legal`, `weekly_hours`…)
 * @param {Array}  args.personal  el personal activo asignado a la sala
 * @param {Array}  args.empleados toda la planilla (para resolver regente/enfermería)
 * @param {Array}  [args.ventasPorHora] historial de ventas por hora (`fetchBranchHourlySalesAll`)
 */
export function analisisDePersonal({ sucursal, personal = [], empleados = [], ventasPorHora = [] }) {
    const tipo = sucursal?.type || 'FARMACIA';
    const esFarmacia = tipo === 'FARMACIA';
    const { jefe, subjefe } = jefaturaDeSucursal(personal, tipo);
    const legal = sucursal?.settings?.legal || {};
    const { regente, referente, enfermeria } = personalNormativoDeSucursal(legal, empleados);
    const inyecta = esFarmacia && legal.injections === true;

    const general = personal.filter((e) => {
        const esJefe = e.id === jefe?.id || e.id === subjefe?.id;
        const esRegente = e.id === regente?.id || e.id === referente?.id;
        const esEnfermeria = enfermeria.some((n) => String(n.empleado.id) === String(e.id));
        return !esJefe && !esRegente && !esEnfermeria;
    });

    const faltas = [];
    let requeridos = 0;
    let cumplidos = 0;
    const revisar = (cumple, texto, esDocumento = false) => {
        requeridos++;
        if (cumple) cumplidos++;
        else faltas.push({ isDoc: esDocumento, text: texto });
    };
    const docsFaltanRegente = [];
    const docsFaltanReferente = [];

    if (esFarmacia) {
        revisar(!!jefe, 'Jefe de Sucursal');
        revisar(!!subjefe, 'Subjefe de Sucursal');
        revisar(!!regente, 'Regente Farmacéutico');
        if (regente) {
            if (!legal.regentCredentialUrl) { docsFaltanRegente.push('Credencial'); revisar(false, 'Regente: Faltan Credenciales', true); } else { revisar(true, 'Credencial Regente'); }
            if (!legal.regentInscriptionUrl) { docsFaltanRegente.push('Inscripción'); revisar(false, 'Regente: Falta Inscripción', true); } else { revisar(true, 'Inscripción Regente'); }
        } else {
            revisar(false, 'Regente: Faltan Credenciales', true);
            revisar(false, 'Regente: Falta Inscripción', true);
        }
        revisar(!!referente, 'Farmacovigilancia');
        if (referente) {
            if (!legal.farmacovigilanciaAuthUrl) { docsFaltanReferente.push('Autorización'); revisar(false, 'Farmaco.: Falta Autorización', true); } else { revisar(true, 'Auth Farmacovigilancia'); }
        } else {
            revisar(false, 'Farmaco.: Falta Autorización', true);
        }
        if (inyecta) {
            revisar(enfermeria.length > 0, 'Regente Enfermería');
            revisar(!!legal.nursingServicePermitUrl, 'Permiso CSSP Inyecciones', true);
            revisar(enfermeria.some(({ fila }) => fila.carneUrl || fila.carneFile), 'Enfermero: Falta Carné', true);
            revisar(enfermeria.some(({ fila }) => fila.licenciaUrl || fila.licenciaFile), 'Enfermero: Falta Licencia', true);
        }
    }

    const saludLegal = requeridos > 0 ? Math.round((cumplidos / requeridos) * 100) : 100;
    const apertura = sucursal?.opening_date || sucursal?.created_at || null;
    const wfm = calculateMinimumStaff(sucursal?.weekly_hours || sucursal?.weeklyHours, ventasPorHora, MIN_PERSONAL_SIMULTANEO, 80, 0.15, apertura);
    const cobertura = (jefe ? 1 : 0) + (subjefe ? 1 : 0) + general.length + (inyecta ? enfermeria.length : 0);
    const deficit = Math.max(0, wfm.minStaff - cobertura);
    const avance = wfm.minStaff > 0 ? Math.min(100, Math.round((cobertura / wfm.minStaff) * 100)) : 0;

    // Lo que se le manda a la IA: el mismo resumen en los dos lados.
    const fotoParaIA = {
        personalActivo: personal.length,
        minimoRequerido: wfm.minStaff,
        deficitPersonal: deficit,
        jefatura: jefe ? 'Asignada' : 'Faltante',
        regenteFarmacia: regente ? 'Asignado' : 'Faltante',
        referenteFarmaco: referente ? 'Asignado' : 'Faltante',
        enfermeria: inyecta ? (enfermeria.length > 0 ? 'Asignada' : 'Faltante') : 'No aplica',
        cumplimientoLegal: `${saludLegal}%`,
    };

    return {
        esFarmacia, esAdministrativa: tipo === 'ADMINISTRATIVA', inyecta,
        jefe, subjefe, regente, referente, enfermeria, general,
        faltas, saludLegal, docsFaltanRegente, docsFaltanReferente,
        wfm, cobertura, deficit, hayDeficit: cobertura < wfm.minStaff, avance,
        fotoParaIA,
    };
}
