import { describe, it, expect } from 'vitest';
import { accionesDeMayorista, filasDeMayoristas, solicitudesPendientes, textoDeAccion } from '@nucleo/utils/mayoristas';
import { empiezaTanda, estadoDeConversacion, nombreDeCliente, tipoDeCliente } from '@nucleo/utils/chatClientes';

const FILAS = [
    { customer_id: 1, nombre: 'ANA', estado: 'solicitado', prom_3m: 50, a_mayoreo: 10, cumple: false },
    { customer_id: 2, nombre: 'BETO', estado: 'aprobado', prom_3m: 300, a_mayoreo: 900, cumple: true, precio: 'mayoreo' },
    { customer_id: 3, nombre: 'CARLA', estado: null, prom_3m: 120, a_mayoreo: 500, cumple: true, ultima_compra: '2026-10-01' },
    { customer_id: 4, nombre: 'DIEGO', estado: 'rechazado', prom_3m: 90, a_mayoreo: 700, cumple: false, ultima_compra: '2026-10-05' },
];

describe('Clientes Mayoristas — reglas compartidas', () => {
    it('reparte las filas en sus pestañas', () => {
        expect(filasDeMayoristas(FILAS, { tab: 'solicitudes' }).map((f) => f.customer_id)).toEqual([1]);
        expect(filasDeMayoristas(FILAS, { tab: 'mayoristas' }).map((f) => f.customer_id)).toEqual([2]);
        expect(filasDeMayoristas(FILAS, { tab: 'candidatos' }).map((f) => f.customer_id)).toEqual([3]);
        expect(filasDeMayoristas(FILAS, { tab: 'candidatos', soloCumplen: false }).map((f) => f.customer_id)).toEqual([4, 3]);
        expect(solicitudesPendientes(FILAS)).toHaveLength(1);
    });
    it('ordena y busca', () => {
        expect(filasDeMayoristas(FILAS, { tab: 'candidatos', soloCumplen: false, orden: 'promedio' }).map((f) => f.customer_id)).toEqual([3, 4]);
        expect(filasDeMayoristas(FILAS, { tab: 'candidatos', soloCumplen: false, orden: 'reciente' }).map((f) => f.customer_id)).toEqual([4, 3]);
        expect(filasDeMayoristas(FILAS, { tab: 'candidatos', soloCumplen: false, busqueda: 'carla' }).map((f) => f.customer_id)).toEqual([3]);
    });
    it('quien pidió la solicitud no la resuelve', () => {
        const sol = { estado: 'solicitado', solicitado_por_id: 'u1' };
        expect(accionesDeMayorista(sol, { puedeAprobar: true, userId: 'u1' })).toMatchObject({ resolver: false, esSolicitante: true });
        expect(accionesDeMayorista(sol, { puedeAprobar: true, userId: 'u2' }).resolver).toBe(true);
        expect(accionesDeMayorista({ estado: 'aprobado' }, { puedeAprobar: true }).gestionar).toBe(true);
        expect(accionesDeMayorista({ estado: 'aprobado', retiro_programado: '2026-11-01' }, { puedeAprobar: true }).gestionar).toBe(false);
        expect(accionesDeMayorista({ estado: 'rechazado' }, { puedeProponer: true }).proponer).toBe(true);
    });
    it('quien aprueba decide a un candidato sin solicitud, y cancela lo avisado (2026-10-19)', () => {
        expect(accionesDeMayorista({}, { puedeAprobar: true }).decidir).toBe(true);
        expect(accionesDeMayorista({ estado: 'descartado' }, { puedeAprobar: true }).decidir).toBe(true);
        expect(accionesDeMayorista({ estado: 'solicitado' }, { puedeAprobar: true }).decidir).toBe(false);
        expect(accionesDeMayorista({}, { puedeProponer: true }).decidir).toBe(false);
        expect(accionesDeMayorista({ estado: 'aprobado', precio_programado: 'mayoreo' }, { puedeAprobar: true }).cancelar).toBe(true);
        expect(accionesDeMayorista({ estado: 'aprobado' }, { puedeAprobar: true }).cancelar).toBe(false);
    });
    it('los candidatos esconden a los no aprobados y filtran por «(4)/(5)» en el nombre', () => {
        const filas = [{ customer_id: 7, estado: 'descartado', cumple: true, a_mayoreo: 1 },
            { customer_id: 8, cumple: false, precio_en_nombre: 'mayoreo', a_mayoreo: 2 }, { customer_id: 9, cumple: true, a_mayoreo: 3 }];
        expect(filasDeMayoristas(filas, { tab: 'candidatos', soloCumplen: false }).map((f) => f.customer_id)).toEqual([9, 8]);
        expect(filasDeMayoristas(filas, { tab: 'candidatos', soloCumplen: false, verDescartados: true }).map((f) => f.customer_id)).toEqual([9, 8, 7]);
        expect(filasDeMayoristas(filas, { tab: 'candidatos', soloCumplen: false, soloConNombre: true }).map((f) => f.customer_id)).toEqual([8]);
    });
    it('lee el historial en palabras', () => {
        expect(textoDeAccion({ accion: 'aprobado', precio: 'mayoreo_plus' })).toBe('Aprobado con Mayoreo Plus');
        expect(textoDeAccion({ accion: 'retiro_avisado' })).toBe('Retiro avisado');
        expect(textoDeAccion({ accion: 'baja_avisada' })).toBe('Bajada a Mayoreo avisada');
    });
});

describe('Chat con clientes — reglas compartidas', () => {
    it('deriva el estado de la conversación', () => {
        expect(estadoDeConversacion({ estado: 'resuelta' })).toBe('resuelta');
        expect(estadoDeConversacion({ ultimo_de: 'equipo', tomada_vigente: true })).toBe('esperando');
        expect(estadoDeConversacion({ ultimo_de: 'cliente', tomada_vigente: true })).toBe('atencion');
        expect(estadoDeConversacion({ ultimo_de: 'cliente' })).toBe('nuevo');
    });
    it('abre una tanda nueva al cambiar de autor o pasados 15 minutos', () => {
        const a = { autor: 'cliente', created_at: '2026-10-12T10:00:00Z' };
        expect(empiezaTanda(a, null)).toBe(true);
        expect(empiezaTanda({ autor: 'cliente', created_at: '2026-10-12T10:05:00Z' }, a)).toBe(false);
        expect(empiezaTanda({ autor: 'cliente', created_at: '2026-10-12T10:20:00Z' }, a)).toBe(true);
        expect(empiezaTanda({ autor: 'equipo', employee_id: 'e1', created_at: '2026-10-12T10:01:00Z' }, a)).toBe(true);
    });
    it('rotula al cliente', () => {
        expect(nombreDeCliente('MARIA LOPEZ')).toBe('Maria Lopez');
        expect(tipoDeCliente({ es_mayoreo: true, rango: 'Zafiro' }).label).toBe('Mayoreo Zafiro');
    });
});
