// ─────────────────────────────────────────────────────────────────────────────
// Las reglas del contrato — sobre todo cuándo NO aplican
// ─────────────────────────────────────────────────────────────────────────────
//
// La prueba que más importa acá es que un contrato de servicios profesionales
// NO tenga plazo con el Ministerio de Trabajo. Devolverle «te quedan 8 días»
// sería inventar una obligación que no existe: el Art. 18 es para contratos DE
// TRABAJO, y un contrato de servicios profesionales es civil.

import { describe, it, expect } from 'vitest';
import { estadoRemisionMtps, esContratoCivil, PLAZO_MTPS_DIAS, PLAZO_DE_PAGO } from '../../src/utils/contrato';

const HOY = new Date(2026, 7, 26);   // 26-ago-2026, hora local

describe('estadoRemisionMtps', () => {
    it('no aplica a servicios profesionales: es un contrato civil', () => {
        const r = estadoRemisionMtps(
            { contract_type: 'SERVICIOS', contrato_fecha_celebracion: '2026-08-20' }, HOY);
        expect(r.aplica).toBe(false);
        expect(r.motivo).toContain('civil');
        expect(r.diasRestantes).toBeUndefined();
    });

    it('no aplica sin fecha de firma: el plazo cuenta desde la celebración', () => {
        const r = estadoRemisionMtps({ contract_type: 'INDEFINIDO' }, HOY);
        expect(r.aplica).toBe(false);
    });

    it('cuenta ocho días desde la firma', () => {
        const r = estadoRemisionMtps(
            { contract_type: 'INDEFINIDO', contrato_fecha_celebracion: '2026-08-26' }, HOY);
        expect(r.aplica).toBe(true);
        expect(r.diasRestantes).toBe(PLAZO_MTPS_DIAS);
        expect(r.vencido).toBe(false);
        expect(r.limite).toBe('2026-09-03');
    });

    it('marca vencido cuando pasaron más de ocho días', () => {
        const r = estadoRemisionMtps(
            { contract_type: 'TEMPORAL', contrato_fecha_celebracion: '2026-08-10' }, HOY);
        expect(r.vencido).toBe(true);
        expect(r.diasRestantes).toBeLessThan(0);
    });

    it('si ya se remitió, no hay cuenta regresiva', () => {
        const r = estadoRemisionMtps({
            contract_type: 'INDEFINIDO',
            contrato_fecha_celebracion: '2026-08-10',
            mtps_remitido_fecha: '2026-08-12',
        }, HOY);
        expect(r.remitido).toBe(true);
        expect(r.vencido).toBeUndefined();
    });

    it('la fecha no retrocede un día por leerse como UTC', () => {
        // `new Date('2026-08-26')` cae el 25 por la tarde en El Salvador. Con el
        // constructor por partes, el límite es el 3 de septiembre y no el 2.
        const r = estadoRemisionMtps(
            { contract_type: 'INDEFINIDO', contrato_fecha_celebracion: '2026-08-26' }, HOY);
        expect(r.limite).toBe('2026-09-03');
    });
});

describe('esContratoCivil', () => {
    it('sólo servicios profesionales', () => {
        expect(esContratoCivil('SERVICIOS')).toBe(true);
        expect(esContratoCivil('INDEFINIDO')).toBe(false);
        expect(esContratoCivil('TEMPORAL')).toBe(false);
    });
});

describe('PLAZO_DE_PAGO', () => {
    it('cada forma de estipulación tiene su plazo del Art. 130', () => {
        // Es lo que vuelve la estipulación una decisión y no un desplegable más.
        expect(PLAZO_DE_PAGO.TIEMPO).toContain('período');
        expect(PLAZO_DE_PAGO.OBRA).toContain('dos días');
        expect(PLAZO_DE_PAGO.COMISION).toContain('quince días');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// El lugar de pago: lo que la ley espera ver
// ─────────────────────────────────────────────────────────────────────────────
//
// Art. 23 nº 9: el contrato escrito dice «Forma, período y LUGAR de pago» — las
// tres, y sin excepción por el medio. El portal lo escondía cuando se pagaba
// por transferencia, razonando que «a una cuenta no se va a ningún lado». El
// razonamiento es sensato y el texto no lo admite: un contrato sin el lugar es
// un contrato al que le falta un elemento exigido.
//
// Art. 128: el lugar sale del convenio o del REGLAMENTO INTERNO. El de esta
// empresa ya lo fijó en su Art. 40 —oficinas de la empresa o lugar de trabajo—,
// así que el campo es una elección entre esos dos y no un texto libre: un
// tercero contradiría el documento que la empresa tiene aprobado.

import { LUGAR_PAGO_OPTIONS, REGLAMENTO_LUGAR_PAGO, MEDIO_PAGO_OPTIONS } from '../../src/utils/contrato';

describe('el lugar de pago', () => {
    /* Eran dos —«oficinas de la empresa» y «lugar de trabajo»—, copiadas del
     * Art. 40 del reglamento interno. Las corrigió el usuario el 2026-08-28, y
     * tenía razón: ese mismo Art. 40 ya había elegido el MEDIO —transferencia o
     * cheque, sin efectivo—, así que nadie va a cobrar a una oficina. El lugar
     * real es el banco que se acuerda con cada persona, que además es el PRIMER
     * supuesto del Art. 128 (el lugar convenido, antes que el del reglamento).
     *
     * Se prueba que sea UNA sola: dos opciones donde el pago sólo ocurre en un
     * sitio es invitar a estipular en el contrato un lugar donde no se paga. */
    it('es uno solo: el banco acordado con el trabajador', () => {
        expect(LUGAR_PAGO_OPTIONS.map(o => o.value)).toEqual(['BANCO']);
        expect(LUGAR_PAGO_OPTIONS[0].label).toMatch(/banco acordado con el trabajador/i);
    });

    // Y NO puede seguir citando el Art. 40: decir «se paga en las oficinas o en
    // su lugar de trabajo» al lado de una opción que dice «en el banco» es
    // contradecirse en el mismo renglón.
    it('la pantalla dice de dónde sale, no lo hace adivinar', () => {
        expect(REGLAMENTO_LUGAR_PAGO).toMatch(/Art\. 128/);
        expect(REGLAMENTO_LUGAR_PAGO).toMatch(/convenido/i);
        expect(REGLAMENTO_LUGAR_PAGO).not.toMatch(/quince y último/i);
    });

    it('el medio de pago no incluye nada que la ley prohíba', () => {
        // Art. 120: moneda de curso legal. Un catálogo que incluya un vale o
        // una ficha invita a elegirlo.
        const valores = MEDIO_PAGO_OPTIONS.map(o => o.value);
        expect(valores).not.toContain('VALE');
        expect(valores).not.toContain('CUPON');
        expect(valores.length).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Los DOS plazos de ocho días, en cadena
// ─────────────────────────────────────────────────────────────────────────────
//
// El portal vigilaba uno —de la firma al Ministerio— y el reglamento interno
// abre otro ANTES: del día que la persona empieza a trabajar, ocho días para
// firmar (su Art. 11). Vigilar sólo el segundo deja pasar el caso peor, porque
// mientras no hay firma el aviso del Ministerio dice, con razón, que su plazo
// todavía no empezó — y alguien puede llevar un mes trabajando sin contrato.

import { estadoFirmaDelContrato } from '../../src/utils/contrato';

describe('el plazo para firmar el contrato', () => {
    const hoy = new Date(2026, 7, 27);   // 27-ago-2026

    it('sin fecha de inicio no hay plazo que contar', () => {
        const r = estadoFirmaDelContrato({ contract_type: 'INDEFINIDO' }, hoy);
        expect(r.aplica).toBe(false);
    });

    it('ya firmado no lleva cuenta regresiva', () => {
        const r = estadoFirmaDelContrato({
            contract_type: 'INDEFINIDO', hire_date: '2026-08-25',
            contrato_fecha_celebracion: '2026-08-26',
        }, hoy);
        expect(r.firmado).toBe(true);
    });

    it('cuenta desde que empezó a trabajar, no desde la firma', () => {
        const r = estadoFirmaDelContrato({ contract_type: 'INDEFINIDO', hire_date: '2026-08-25' }, hoy);
        expect(r.firmado).toBe(false);
        expect(r.diasRestantes).toBe(6);      // 25 + 8 = 2 de septiembre
        expect(r.vencido).toBe(false);
    });

    it('un mes trabajando sin firmar está VENCIDO — el caso que se escapaba', () => {
        const r = estadoFirmaDelContrato({ contract_type: 'INDEFINIDO', hire_date: '2026-07-25' }, hoy);
        expect(r.vencido).toBe(true);
        expect(r.diasRestantes).toBeLessThan(0);
    });

    it('a un contrato civil no lo alcanza', () => {
        const r = estadoFirmaDelContrato({ contract_type: 'SERVICIOS', hire_date: '2026-07-01' }, hoy);
        expect(r.aplica).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// El horario que va en el CONTRATO — que no es el catálogo de turnos
// ─────────────────────────────────────────────────────────────────────────────
//
// Art. 23 nº 7: el contrato debe decir «el horario de trabajo». Con turnos que
// rotan cada quince días, escribirlo fijo lo vuelve falso a los quince días y
// cambiarlo obligaría a modificar todos los contratos.
//
// El Art. 304 resuelve el problema poniendo el horario en el REGLAMENTO, así que
// el contrato lo cumple por remisión. Es la misma mecánica del lugar de pago.
//
// Lo que se prueba acá es que el texto REMITE y no INVENTA un horario — y que
// las áreas que no rotan sí lo dicen entero, porque ahí sí es verdad.

import { horarioParaElContrato } from '../../src/utils/contrato';

describe('el horario que va en el contrato', () => {
    it('una sala remite al reglamento, no fija horas', () => {
        const h = horarioParaElContrato('Salud 3');
        expect(h.fijo).toBe(false);
        expect(h.texto).toMatch(/rotativos cada quince días/i);
        expect(h.texto).toMatch(/Reglamento Interno/);
        expect(h.texto).toMatch(/Salud 3/);
        // Y NO inventa un horario que a los quince días sería mentira.
        expect(h.texto).not.toMatch(/\d{1,2}:\d{2}/);
    });

    it('administración no rota: dice el horario completo', () => {
        const h = horarioParaElContrato('Administracion');
        expect(h.fijo).toBe(true);
        expect(h.texto).toMatch(/lunes a viernes/i);
        expect(h.texto).toMatch(/pausa alimenticia/i);
    });

    it('bodega tampoco rota', () => {
        expect(horarioParaElContrato('Bodega').fijo).toBe(true);
    });

    it('sin área elegida no promete nada', () => {
        // Un texto inventado acá termina impreso en un contrato.
        const h = horarioParaElContrato('');
        expect(h.texto).toMatch(/Se define al elegir/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// El plazo del Ministerio cuenta desde el ÚLTIMO acto
// ─────────────────────────────────────────────────────────────────────────────
//
// Art. 18, textual: «dentro de los ocho días siguientes al de su celebración,
// MODIFICACIÓN O PRÓRROGA». El portal contaba sólo desde la firma, así que una
// ficha prorrogada mostraba «remitido» para siempre — la prórroga se quedaba sin
// remitir y nada lo decía. Ese es el modo de falla caro: no falla, dice que sí.

describe('el plazo para remitir el ejemplar al Ministerio', () => {
    const hoy = new Date(2026, 7, 27);

    it('cuenta desde la firma cuando no hay prórrogas', () => {
        const r = estadoRemisionMtps({ contract_type: 'TEMPORAL', contrato_fecha_celebracion: '2026-08-25' }, hoy);
        expect(r.remitido).toBe(false);
        expect(r.diasRestantes).toBe(6);
    });

    it('una prórroga REINICIA el plazo', () => {
        const r = estadoRemisionMtps({
            contract_type: 'TEMPORAL', contrato_fecha_celebracion: '2026-01-10',
            contrato_prorrogas: [{ desde: '2026-08-26', hasta: '2026-12-31' }],
        }, hoy);
        expect(r.remitido).toBe(false);
        expect(r.porProrroga).toBe(true);
        expect(r.diasRestantes).toBe(7);      // 26-ago + 8 = 3-sep
    });

    it('remitir el original NO cubre la prórroga posterior', () => {
        // Es el caso que se escapaba: decía «remitido» y la prórroga estaba sin
        // mandar.
        const r = estadoRemisionMtps({
            contract_type: 'TEMPORAL', contrato_fecha_celebracion: '2026-01-10',
            mtps_remitido_fecha: '2026-01-12',
            contrato_prorrogas: [{ desde: '2026-08-26', hasta: '2026-12-31' }],
        }, hoy);
        expect(r.remitido).toBe(false);
        expect(r.porProrroga).toBe(true);
    });

    it('remitir DESPUÉS de la prórroga sí la cubre', () => {
        const r = estadoRemisionMtps({
            contract_type: 'TEMPORAL', contrato_fecha_celebracion: '2026-01-10',
            mtps_remitido_fecha: '2026-08-27',
            contrato_prorrogas: [{ desde: '2026-08-26', hasta: '2026-12-31' }],
        }, hoy);
        expect(r.remitido).toBe(true);
    });

    it('una prórroga sin fecha no mueve nada', () => {
        const r = estadoRemisionMtps({
            contract_type: 'TEMPORAL', contrato_fecha_celebracion: '2026-08-25',
            contrato_prorrogas: [{ desde: null, hasta: null }],
        }, hoy);
        expect(r.diasRestantes).toBe(6);
    });
});
