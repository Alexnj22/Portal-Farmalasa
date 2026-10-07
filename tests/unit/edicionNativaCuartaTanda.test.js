// La lógica que el portal y la app comparten para editar sucursales, gastos
// de metas, encuestas (preguntas, a quién van, análisis) y solicitudes de datos.
import { describe, expect, it } from 'vitest';
import {
    cambiarDiaDelHorario, copiarDiaAnterior, finDeContrato, horarioIncompleto, sucursalConCambios,
} from '@nucleo/utils/edicionDeSucursal';
import { mesesParaArrancarGasto, resumenDeGastos, salasDelGasto } from '@nucleo/utils/metasUtils';
import {
    agregarPregunta, agregarSeccion, condicionSobre, duplicarPregunta, moverPregunta, quitarSeccion, valorInicialDeCondicion,
} from '@nucleo/utils/encuestasClientes';
import {
    autocalificacion, conteoDeOpciones, filasPorSucursal, idsDelAlcance, leerAutocalificacion, pendientesDelAlcance,
} from '@nucleo/utils/climaLaboral';
import {
    camposDeSolicitud, comoPersona, faltaParaRecibir, formularioDeSolicitud, llenarConPersona, terminoDeBusqueda,
} from '@nucleo/data/solicitudesDatos';

describe('sucursal', () => {
    it('cerrar un día borra sus horas y un día abierto sin horas no se guarda', () => {
        const h = cambiarDiaDelHorario({ 1: { isOpen: true, start: '08:00', end: '17:00' } }, 1, { isOpen: false });
        expect(h[1]).toEqual({ isOpen: false, start: '', end: '' });
        expect(horarioIncompleto({ 2: { isOpen: true, start: '08:00', end: '' } })).toBe(true);
        expect(horarioIncompleto({ 2: { isOpen: true, start: '08:00', end: '17:00' } })).toBe(false);
    });
    it('copia el día anterior sólo si estaba abierto', () => {
        const h = copiarDiaAnterior({ 1: { isOpen: true, start: '07:00', end: '19:00' } }, 1);
        expect(h[2]).toEqual({ isOpen: true, start: '07:00', end: '19:00' });
        expect(copiarDiaAnterior({ 1: { isOpen: false } }, 1)[2]).toBeUndefined();
    });
    it('el fin del contrato cae el último día cuando el mes es más corto', () => {
        expect(finDeContrato('2026-01-31', 1)).toBe('2026-02-28');
        expect(finDeContrato('2026-03-15', 12)).toBe('2027-03-15');
        expect(finDeContrato('', 12)).toBeNull();
    });
    it('el guardado lleva la sucursal entera, no sólo lo que cambió', () => {
        const b = { id: 3, name: 'Salud 3', address: 'Centro', phone: '2300', settings: { legal: { x: 1 } } };
        const r = sucursalConCambios(b, { horario: { 1: { isOpen: true, start: '08:00', end: '17:00' } } });
        expect(r.name).toBe('Salud 3');
        expect(r.address).toBe('Centro');
    });
});

describe('gastos de metas', () => {
    it('arranca siempre el mes siguiente y descarta salas sin monto', () => {
        expect(mesesParaArrancarGasto('2026-10')[0].value).toBe('2026-11');
        expect(salasDelGasto([{ branchId: '2', monto: '1,200.50' }, { branchId: '', monto: '5' }, { branchId: '4', monto: '0' }]))
            .toEqual([{ branch_id: 2, monto: 1200.5 }]);
    });
    it('el resumen sólo suma los activos', () => {
        const r = resumenDeGastos([{ estado: 'activo', monto_total: 100, venta_viva: 400, margen_pct: 25 }, { estado: 'anulado', monto_total: 50 }]);
        expect(r).toEqual({ cuantos: 1, porRecuperar: 100, agregaAMetas: 400, margen: 25 });
    });
});

describe('preguntas de la encuesta a clientes', () => {
    const base = { secciones: [{ id: 's1', titulo: 'A', preguntas: [{ id: 'p1', tipo: 'nps', texto: 'x' }] }, { id: 's2', titulo: 'B', preguntas: [] }] };
    it('agregar y duplicar devuelven el id nuevo sin tocar el original', () => {
        const r = agregarPregunta(base, 1, 'si_no');
        expect(r.cuestionario.secciones[1].preguntas[0].id).toBe(r.id);
        expect(base.secciones[1].preguntas).toHaveLength(0);
        const d = duplicarPregunta(base, 0, 0);
        expect(d.cuestionario.secciones[0].preguntas).toHaveLength(2);
        expect(d.id).not.toBe('p1');
        expect(agregarSeccion(base).secciones).toHaveLength(3);
    });
    it('bajar la última pregunta de una sección la pasa al principio de la siguiente', () => {
        const m = moverPregunta(base, 0, 0, 1);
        expect(m.secciones[0].preguntas).toHaveLength(0);
        expect(m.secciones[1].preguntas[0].id).toBe('p1');
        expect(moverPregunta(base, 0, 0, -1)).toBe(base);
    });
    it('quitar una sección quita sus preguntas', () => {
        expect(quitarSeccion(base, 0).secciones.map((s) => s.id)).toEqual(['s2']);
    });
    it('una condición nueva arranca con el valor del tipo', () => {
        expect(valorInicialDeCondicion({ tipo: 'nps' })).toBe(6);
        expect(valorInicialDeCondicion({ tipo: 'si_no' })).toBe(false);
        expect(valorInicialDeCondicion({ tipo: 'unica', opciones: [{ id: 'a' }] })).toBe('a');
        expect(condicionSobre({ id: 'p1', tipo: 'nps' })).toMatchObject({ pregunta: 'p1', valor: 6 });
    });
});

describe('a quién va una encuesta interna', () => {
    const empleados = [
        { id: 1, role_id: 5, branch: { id: 10 } }, { id: 2, role_id: 6, branch: { id: 10 } }, { id: 3, role_id: 5, branch: { id: 11 } },
    ];
    it('con todos o jefaturas no se guardan ids', () => {
        expect(idsDelAlcance('all', [1])).toEqual([]);
        expect(idsDelAlcance('roles', [1])).toEqual([]);
        expect(idsDelAlcance('employees', [1])).toEqual([1]);
    });
    it('los pendientes salen del alcance y descuentan a quien respondió', () => {
        expect(pendientesDelAlcance({ scope_tipo: 'branches', scope_ids: [10] }, empleados, new Set([2])).map((e) => e.id)).toEqual([1]);
        expect(pendientesDelAlcance({ scope_tipo: 'all', scope_ids: [] }, empleados, new Set())).toEqual([]);
    });
});

describe('análisis del clima', () => {
    const filas = [
        { sucursal: 'B', isJefe: false, r: { 2: 'A', 30: '9' } },
        { sucursal: 'A', isJefe: false, r: { 2: 'D', 30: 'C' } },
        { sucursal: 'B', isJefe: true, r: { 2: 'A', 30: '4' } },
    ];
    it('cuenta opciones y lee la autocalificación vieja y la nueva', () => {
        expect(conteoDeOpciones(filas, 2)).toEqual({ A: 2, B: 0, C: 0, D: 1 });
        expect(leerAutocalificacion('C')).toEqual({ rango: 'C', numero: 5.5 });
        expect(leerAutocalificacion('11')).toBeNull();
        const a = autocalificacion(filas, 30);
        expect(a.dist).toEqual({ A: 1, B: 0, C: 1, D: 1 });
        expect(a.promedio).toBeCloseTo((9 + 5.5 + 4) / 3);
    });
    it('agrupa por sucursal con los jefes primero', () => {
        const g = filasPorSucursal(filas);
        expect(g.map(([n]) => n)).toEqual(['A', 'B']);
        expect(g[1][1][0].isJefe).toBe(true);
    });
});

describe('solicitud de datos', () => {
    it('lo escrito decide qué se busca', () => {
        expect(terminoDeBusqueda('01234567-8')).toMatchObject({ numero: '01234567-8', nombre: '' });
        expect(terminoDeBusqueda('7777 8888')).toMatchObject({ telefono: '7777 8888', nombre: '' });
        expect(terminoDeBusqueda('Ana')).toMatchObject({ nombre: 'Ana', numero: '' });
    });
    it('elegir a alguien llena los campos y no pisa el documento cotejado', () => {
        const c = comoPersona('empleado', { name: 'Ana Pérez', dui: '012345678', phone: '77778888' });
        const f = llenarConPersona({ ...formularioDeSolicitud(null), identidad_numero: '999' }, c);
        expect(f.solicitante_nombre).toBe('Ana Pérez');
        expect(f.identidad_numero).toBe('999');
    });
    it('no se registra sin acuse, nombre, derechos y documento; resolver sella la hora', () => {
        expect(faltaParaRecibir(formularioDeSolicitud(null))).toEqual(
            ['la fecha del acuse', 'el nombre', 'qué solicita', 'el número del documento cotejado']);
        const f = { ...formularioDeSolicitud(null), recibida_at: '2026-10-01T15:00:00.000Z', solicitante_nombre: ' Ana ', resolucion: 'Se entregó' };
        const c = camposDeSolicitud(f, 'RESUELTA', new Date('2026-10-07T12:00:00Z'));
        expect(c).toMatchObject({ estado: 'RESUELTA', solicitante_nombre: 'Ana', resolucion: 'Se entregó', resuelta_at: '2026-10-07T12:00:00.000Z' });
        expect(camposDeSolicitud(f, 'RECIBIDA').resolucion).toBeUndefined();
    });
});
