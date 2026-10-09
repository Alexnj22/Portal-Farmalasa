import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { pinDeKiosco, sha256 } from '@nucleo/utils/pinDeKiosco';
import { validarNovedad, plazaOcupada, finPorLey, finPorDias, diasDelPeriodo, asuetoDelDia, avisoDeDiasDeLey, opcionesDeNovedad } from '@nucleo/utils/novedadDePersonal';

// El cálculo del portal (crypto.subtle), reproducido con node:crypto.
const pinDelPortal = (code) => createHash('sha256').update(code.trim().replace(/\s+/g, '').toUpperCase()).digest('base64')
    .replace(/[^A-Za-z0-9]/g, '').toUpperCase().substring(0, 8);

describe('pinDeKiosco', () => {
    it('da el mismo pin que el portal', () => {
        for (const c of ['1', '1024', '9999', ' 12 34 ', '000123', '777777777', 'abc', 'Ñandú']) {
            expect(pinDeKiosco(c)).toBe(pinDelPortal(c));
        }
    });
    it('sha256 de un texto largo coincide', () => {
        const t = 'x'.repeat(200);
        expect(Buffer.from(sha256(t)).toString('hex')).toBe(createHash('sha256').update(t).digest('hex'));
    });
    it('vacío da vacío', () => expect(pinDeKiosco('  ')).toBe(''));
});

describe('novedadDePersonal', () => {
    const emp = { id: 1, role: 'Dependiente', branchId: 3 };
    it('no ofrece cambio de turno ni sanciones', () => {
        const v = opcionesDeNovedad().map(o => o.value);
        expect(v).not.toContain('SHIFT_CHANGE');
        expect(v).not.toContain('SUSPENSION');
        expect(v).toContain('TRANSFER');
    });
    it('vacaciones: 15 días y no en asueto', () => {
        expect(finPorLey('VACATION', '2026-10-01')).toBe('2026-10-15');
        expect(diasDelPeriodo('2026-10-01', '2026-10-15')).toBe(15);
        expect(avisoDeDiasDeLey('VACATION', null, '2026-10-01', '2026-10-10')).toMatch(/15/);
        const r = validarNovedad({ formData: { type: 'VACATION', date: '2026-11-02', endDate: '2026-11-16', note: 'x' }, empleado: emp, asuetos: [{ holiday_date: '2020-11-02', is_recurring: true, name: 'Difuntos' }] });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/Difuntos/);
        expect(asuetoDelDia('2026-11-03', [{ holiday_date: '2020-11-02', is_recurring: true }])).toBeNull();
    });
    it('maternidad 112 días; incapacidad común por días', () => {
        expect(diasDelPeriodo('2026-01-01', finPorLey('DISABILITY', '2026-01-01', 'MATERNIDAD'))).toBe(112);
        expect(finPorDias('2026-01-30', 3)).toBe('2026-02-01');
    });
    it('pide la observación y los campos del tipo', () => {
        expect(validarNovedad({ formData: { type: 'TRANSFER', date: '2026-10-01', note: 'x' }, empleado: emp }).ok).toBe(false);
        expect(validarNovedad({ formData: { type: 'TRANSFER', date: '2026-10-01', targetBranchId: '4', note: '' }, empleado: emp }).ok).toBe(false);
        expect(validarNovedad({ formData: { type: 'TRANSFER', date: '2026-10-01', targetBranchId: '4', note: 'x' }, empleado: emp }).ok).toBe(true);
        expect(validarNovedad({ formData: { type: 'PERMIT', permissionDates: [], note: 'x' }, empleado: emp }).ok).toBe(false);
        expect(validarNovedad({ formData: { type: 'CODE_CHANGE', date: '2026-10-01', newCode: '5', hasConflict: true, note: 'x' }, empleado: emp }).motivo).toMatch(/en uso/);
    });
    it('frena una plaza llena', () => {
        const roles = [{ name: 'Jefe', max_limit: 1, scope: 'BRANCH' }];
        const empleados = [{ id: 9, role: 'Jefe', status: 'ACTIVO', branchId: 3 }];
        const p = plazaOcupada({ type: 'PROMOTION', formData: { newRole: 'Jefe' }, empleado: emp, empleados, roles });
        expect(p?.limit).toBe(1);
        expect(validarNovedad({ formData: { type: 'PROMOTION', date: '2026-10-01', newRole: 'Jefe', note: 'x' }, empleado: emp, empleados, roles }).motivo).toMatch(/Plaza/);
    });
});

import { historialDeFicha, eventoVigente, diasDeAusencia, ausenciasFiltradas } from '@nucleo/utils/historialDeFicha';
import { hastaDeLaSuspension, sancionCompleta, codigoDeSancion, diasAlElegir } from '@nucleo/utils/sancion';
import { vacacionEnCurso, recontratacionCompleta, horasAlCambiarContrato, datosDeRecontratacion } from '@nucleo/utils/reingresoYRecontratacion';
import { comunicadosDeLaPersona, comunicadosDeLaPestana, yaLoLeyo } from '@nucleo/utils/misComunicados';
import { pdfmakeAHtml } from '@nucleo/utils/pdfmakeAHtml';
import { htmlDeLaConstancia } from '@nucleo/utils/constanciaDeSancion';

describe('historialDeFicha', () => {
    const filas = [
        { event_type: 'PERMIT', event_date: '2026-10-02', created_at: '2026-10-01T10:00:00Z', metadata: { permissionDates: ['2026-10-02', '2026-10-05'] }, note: 'p' },
        { event_type: 'DISABILITY', event_date: '2026-10-10', created_at: '2026-10-09T10:00:00Z', metadata: { endDate: '2026-10-14', days: 5 }, note: 'i' },
        { event_type: 'HIRE', event_date: '2020-01-01', created_at: '2020-01-01', metadata: {} },
    ];
    const eventos = [{ id: 'e1', type: 'PERMIT', date: '2026-10-02', created_at: '2026-10-01T10:00:00+00:00' }, { id: 'e2', type: 'DISABILITY', date: '2026-10-10', created_at: '2026-10-09T10:00:00Z' }];
    it('amarra cada novedad con su id real', () => {
        const h = historialDeFicha(filas, eventos);
        expect(h[0].eventoId).toBe('e1');
        expect(h[1].eventoId).toBe('e2');
        expect(h[2].eventoId).toBeNull();
        expect(eventoVigente(h[0])).toBe(true);
        expect(eventoVigente(h[2])).toBe(false);
    });
    it('marca los días de seguro desde el cuarto', () => {
        const d = diasDeAusencia(historialDeFicha(filas, eventos), '2026-10-01');
        expect(d['2026-10-05'].permiso).toBe(true);
        expect(d['2026-10-12'].seguro).toBe(false);
        expect(d['2026-10-13'].seguro).toBe(true);
        expect(ausenciasFiltradas(historialDeFicha(filas, eventos), { dia: '2026-10-05' })).toHaveLength(1);
    });
});

describe('sanción, reingreso y comunicados', () => {
    it('sanción', () => {
        expect(diasAlElegir(3, '')).toBe('1');
        expect(diasAlElegir(4, '1')).toBe('2');
        expect(hastaDeLaSuspension(4, '2026-10-30', 3)).toBe('2026-11-01');
        expect(sancionCompleta({ falta: 'x', peldano: 4, fecha: '2026-10-01', dias: '2', autorizacion: '' })).toBe(false);
        expect(sancionCompleta({ falta: 'x', peldano: 1, fecha: '2026-10-01' })).toBe(true);
        expect(codigoDeSancion('ab-cd-ef12', '2026-10-01')).toBe('S-2026-ABCDEF');
    });
    it('constancia en HTML', () => {
        const html = htmlDeLaConstancia({ nombre: 'ANA PÉREZ', peldano: 2, fecha: '2026-10-01', falta: 'Llegar tarde' });
        expect(html).toContain('ANA PÉREZ');
        expect(html).toContain('AMONESTACIÓN ESCRITA');
        expect(pdfmakeAHtml({ content: [{ text: 'a<b' }] })).toContain('a&lt;b');
    });
    it('reingreso y recontratación', () => {
        const emp = { history: [{ type: 'VACATION', date: '2026-10-01', metadata: { endDate: '2026-10-15' } }] };
        expect(vacacionEnCurso(emp, '2026-10-05')).toBeTruthy();
        expect(vacacionEnCurso(emp, '2026-10-20')).toBeNull();
        expect(horasAlCambiarContrato('MEDIO_TIEMPO', '44')).toBe('22');
        expect(horasAlCambiarContrato('INDEFINIDO', '22')).toBe('44');
        expect(recontratacionCompleta({ rehire_hire_date: 'x', rehire_branch_id: 1 })).toBe(false);
        expect(datosDeRecontratacion({ rehire_hire_date: 'd' }).contract_type).toBe('INDEFINIDO');
    });
    it('comunicados', () => {
        const user = { id: 7, branchId: 1, role: 'X' };
        const anns = [
            { id: 1, targetType: 'GLOBAL', date: '2026-10-01', readBy: [] },
            { id: 2, targetType: 'GLOBAL', date: '2026-10-02', readBy: [{ employeeId: '7' }] },
            { id: 3, targetType: 'GLOBAL', date: '2026-10-03', isArchived: true, readBy: [] },
        ];
        const mios = comunicadosDeLaPersona(anns, user, []);
        expect(mios.map(a => a.id)).toEqual([1, 2]);
        expect(comunicadosDeLaPestana(mios, 'UNREAD', 7).map(a => a.id)).toEqual([1]);
        expect(yaLoLeyo(anns[1], 7)).toBe(true);
    });
});

import { filasDeSeccion, filasParaActivarTodo, filasParaDelegar, seccionEncendida, delegaDecisiones } from '@nucleo/utils/permisosDeCargo';
import { segmentosDeComentarios, seccionesDelResumen, tonoDeSeccion } from '@nucleo/utils/resumenDeComentarios';
import { presentacionDominante, equivalenteEnCajas } from '@nucleo/utils/minmaxSolicitud';
import { descansosCortos } from '@nucleo/utils/reparosDeLaSemana';

describe('tanda 2: permisos, clima, mín·máx, horarios', () => {
    it('permisos en bloque', () => {
        const grupos = [{ group: 'G', modules: [{ key: 'a', hasApprove: true, sub: [{ key: 'a_t' }] }, { key: 'b' }] }];
        const permisos = { '1:a': { can_view: true, scope: 'BRANCH' } };
        const todo = filasParaActivarTodo(permisos, 1, grupos, 'x');
        expect(todo.find(f => f.module_key === 'a')).toMatchObject({ can_edit: true, can_approve: true, scope: 'BRANCH' });
        expect(todo.find(f => f.module_key === 'a_t')).toMatchObject({ can_view: true, can_edit: false });
        expect(filasDeSeccion(permisos, 1, [{ key: 'b' }], false, 'x')[0]).toMatchObject({ can_view: false, can_approve: false });
        expect(seccionEncendida(permisos, 1, grupos[0])).toBe(false);
        const d = filasParaDelegar({}, 1, true, ['requests_caja'], 'x');
        expect(d.map(f => f.module_key)).toEqual(['requests_caja', 'requests']);
        expect(delegaDecisiones({ '1:requests': { delega_en_ausencia: true } }, 1)).toBe(true);
    });
    it('resumen de comentarios', () => {
        const s = segmentosDeComentarios([{ comentario: 'hola', isJefe: true }, { comentario: 'null' }, { comentario: 'x', isJefe: false }]);
        expect(s.map(x => x.comments.length)).toEqual([2, 1, 1]);
        const sec = seccionesDelResumen('**Temas recurrentes**: uno **Acciones:** dos');
        expect(sec.map(x => x.title)).toEqual(['Temas recurrentes', 'Acciones']);
        expect(tonoDeSeccion('Fricciones')).toBe('warning');
    });
    it('cajas del mín·máx', () => {
        const pres = [{ factor: 1 }, { factor: 12, tipo: 'CAJA ' }, { factor: 12 }];
        expect(presentacionDominante(pres).factor).toBe(12);
        expect(equivalenteEnCajas(25, pres)).toBe('≈ 3 caja');
        expect(equivalenteEnCajas(0, pres)).toBeNull();
    });
    it('descanso corto entre jornadas', () => {
        const turnos = [];
        const sch = { 1: { customStart: '14:00', customEnd: '22:00' }, 2: { customStart: '05:00', customEnd: '13:00' } };
        const r = descansosCortos({ personas: [{ id: 9, name: 'ANA PEREZ' }], rosters: { 9: sch }, turnos, fechas: ['2026-10-05', '2026-10-06'] });
        expect(r).toHaveLength(1);
        expect(r[0].horas).toBe(7);
    });
});
