import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
    TIPOS, requeridosDe, faltantes, puntuarLista, AUTOINSPECCION, semestreAReportar, semestreDe,
    semestresRecientes, diasHasta, estadoDelPlazo, calendarioDeVencimientos, tonoDeVencimiento,
} from '@nucleo/utils/cumplimiento';

// La gemela de la base: `cumplimiento_requeridos` en la migración.
const sql = readdirSync('supabase/migrations')
    .filter((f) => f.includes('cumplimiento_sanitario_registros'))
    .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');

describe('cumplimiento: gemela de la base', () => {
    it('cada tipo exige en la pantalla exactamente lo que exige la base', () => {
        for (const tipo of Object.keys(TIPOS)) {
            const m = sql.match(new RegExp(`WHEN '${tipo}'\\s+THEN ARRAY\\[([^\\]]*)\\]`));
            expect(m, tipo).toBeTruthy();
            const base = m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort();
            const pantalla = [...requeridosDe(tipo), ...TIPOS[tipo].campos.filter((c) => c.tipo === 'fijo').map((c) => c.key)];
            expect([...new Set(pantalla)].sort(), tipo).toEqual(base);
        }
    });
});

describe('cumplimiento: reglas', () => {
    it('faltantes nombra lo vacío', () => {
        expect(faltantes('retiro', { alerta: 'A', fuente: 'SRS', producto: 'P' })).toEqual(['Lote']);
    });
    it('un crítico que no cumple reprueba', () => {
        const todas = Object.fromEntries(AUTOINSPECCION.flatMap((s) => s.items).map((i) => [i.id, 'si']));
        expect(puntuarLista(AUTOINSPECCION, todas).aprueba).toBe(true);
        expect(puntuarLista(AUTOINSPECCION, { ...todas, a3: 'no' }).aprueba).toBe(false);
        expect(puntuarLista(AUTOINSPECCION, { ...todas, p5: 'no' }).aprueba).toBe(true);
    });
    it('semestres', () => {
        expect(semestreDe('2026-03-01')).toBe('2026-S1');
        expect(semestreAReportar('2026-11-11')).toBe('2026-S1');
        expect(semestreAReportar('2026-02-01')).toBe('2025-S2');
        expect(semestresRecientes('2026-11-11', 3)).toEqual(['2026-S1', '2025-S2', '2025-S1']);
    });
    it('plazos', () => {
        expect(diasHasta('2026-11-25', '2026-11-11')).toBe(14);
        expect(estadoDelPlazo({ tipo: 'farmacovigilancia', estado: 'abierto', vence_el: '2026-11-10' }, '2026-11-11').tono).toBe('danger');
        expect(estadoDelPlazo({ tipo: 'farmacovigilancia', estado: 'cerrado' }, '2026-11-11').texto).toBe('Notificada');
        expect(tonoDeVencimiento(45)).toBe('info');
        expect(tonoDeVencimiento(-1)).toBe('danger');
    });
    it('calendario: sólo farmacias y bodega, ordenado', () => {
        const docs = (b) => ({ permisos: b.docs, personal: [], infra: [], propios: [] });
        const filas = calendarioDeVencimientos([
            { id: 1, name: 'A', type: 'FARMACIA', docs: [{ id: 'srs', title: 'SRS', expDate: '2027-01-01', url: 'x' }] },
            { id: 2, name: 'B', type: 'ADMINISTRATIVA', docs: [{ id: 'srs', title: 'SRS', expDate: '2026-12-01' }] },
            { id: 3, name: 'C', type: 'BODEGA', docs: [{ id: 'm', title: 'M', expDate: '2026-12-15' }], settings: { legal: { extinguisherExpiration: '2026-11-20' } } },
        ], docs, '2026-11-11');
        expect(filas.map((f) => `${f.sala}:${f.docId}`)).toEqual(['C:extintores', 'C:m', 'A:srs']);
    });
});
