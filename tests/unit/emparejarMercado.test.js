// Emparejador de Datos de Mercado de la SRS: los casos que el primer
// emparejador daba como «alta» y estaban mal (2026-11-14).
import { describe, it, expect } from 'vitest';
import { analizarPortal, analizarSrs, decidir } from '../../scripts/srs/emparejarMercado.mjs';

const fila = (crp, nombre_comercial, presentacion, laboratorio = 'LAB') =>
    ({ crp, n_registro: crp.split('-')[0], nombre_comercial, presentacion, laboratorio });

describe('analizar', () => {
    it('lee marca, fuerza, unidades y forma del portal', () => {
        const p = analizarPortal({ nombre: 'COLBER AMLO 5/5MG X 30 TAB' });
        expect(p.marca).toEqual(['COLBER', 'AMLO']);
        expect([...p.fuerzas]).toEqual([5]);
        expect(p.unidades).toBe(30);
        expect(p.forma).toBe('tab');
    });
    it('lee volumen y no lo confunde con fuerza', () => {
        const p = analizarPortal({ nombre: 'DENVAR 100 MG X 50 ML' });
        expect([...p.fuerzas]).toEqual([100]);
        expect(p.volumen).toEqual({ n: 50, u: 'ML' });
    });
    it('multiplica los «X n» de la presentación de la SRS', () => {
        expect(analizarSrs(fila('1-1', 'X', 'CAJA X 3 BLISTER X 10 TABLETAS (PRESENTACIÓN COMERCIAL)')).unidades).toBe(30);
        expect(analizarSrs(fila('1-1', 'X', 'CAJA X 15 SOBRE X 5.8 g (PRESENTACIÓN COMERCIAL)')).unidades).toBe(15);
        const v = analizarSrs(fila('1-1', 'X', 'CAJA X 1 FRASCO X 120 mL'));
        expect(v.volumen).toEqual({ n: 120, u: 'ML' });
    });
});

describe('decidir', () => {
    it('COLBER AMLO no es COLBER a secas', () => {
        const r = decidir({ product_id: 1, nombre: 'COLBER AMLO 5/5MG X 30 TAB' }, [
            fila('RG3444060214-12', 'COLBER 5mg TABLETAS RECUBIERTAS', 'CAJA X 3 BLISTERES X 10 TABLETAS RECUBIERTAS (PRESENTACIÓN COMERCIAL)'),
            fila('RG9-2', 'COLBER AMLO 5 mg / 5 mg Tabletas Recubiertas', 'CAJA X 3 BLISTER X 10 TABLETAS (PRESENTACIÓN COMERCIAL)'),
            fila('RG9-1', 'COLBER AMLO 5 mg / 5 mg Tabletas Recubiertas', 'CAJA X 1 BLISTER X 10 TABLETAS (PRESENTACIÓN COMERCIAL)'),
        ]);
        expect(r.crp).toBe('RG9-2');
        expect(r.confianza).toBe('alta');
    });
    it('el empaque decide entre presentaciones del mismo registro', () => {
        const r = decidir({ product_id: 1, nombre: 'RINOKEM PLUS  X 100 CAPSULAS' }, [
            fila('R-1', 'RINOKEM PLUS CAPSULAS', 'CAJA X 3 BLISTER X 10 CAPSULAS (PRESENTACIÓN COMERCIAL)'),
            fila('R-2', 'RINOKEM PLUS CAPSULAS', 'CAJA X 10 BLISTER X 10 CAPSULAS (PRESENTACIÓN COMERCIAL)'),
            fila('R-3', 'RINOKEM 10 mg TABLETAS', 'CAJA X 10 BLISTER X 10 TABLETAS'),
        ]);
        expect(r.crp).toBe('R-2');
        expect(r.confianza).toBe('alta');
    });
    it('sin el empaque correcto, la pareja es «baja»', () => {
        const r = decidir({ product_id: 1, nombre: 'COLVASTEN 40 MG X 30 TABLETAS' }, [
            fila('C-1', 'COLVASTEN 40 mg TABLETAS RECUBIERTAS', 'CAJA X 2 BLISTERES X 10 TABLETAS RECUBIERTAS (PRESENTACIÓN COMERCIAL)'),
        ]);
        expect(r.confianza).toBe('baja');
    });
    it('la concentración distinta no gana a la igual', () => {
        const r = decidir({ product_id: 1, nombre: 'EXFORGE 10/320 MG X 14 TAB' }, [
            fila('E-1', 'EXFORGE 5/320 mg COMPRIMIDOS CON CUBIERTA PELICULAR', 'CAJA X 2 BLISTER X 7 COMPRIMIDOS'),
            fila('E-2', 'EXFORGE 10/320 mg COMPRIMIDOS CON CUBIERTA PELICULAR', 'CAJA X 2 BLISTER X 7 COMPRIMIDOS'),
            fila('E-3', 'EXFORGE HCT 10/320/25 mg COMPRIMIDOS CON CUBIERTA PELICULAR', 'CAJA X 2 BLISTER X 7 COMPRIMIDOS'),
        ]);
        expect(r.crp).toBe('E-2');
        expect(r.confianza).toBe('alta');
    });
    it('una muestra médica nunca gana', () => {
        const r = decidir({ product_id: 1, nombre: 'AVELOX 400MG X 5 COMP.' }, [
            fila('F05-1', 'AVELOX 400 mg COMPRIMIDOS RECUBIERTOS', 'CAJA X 1 BLISTER X 5 COMPRIMIDOS RECUBIERTOS (MUESTRA MÉDICA)'),
            fila('F05-2', 'AVELOX 400 mg COMPRIMIDOS RECUBIERTOS', 'CAJA X 1 BLISTER X 5 COMPRIMIDOS RECUBIERTOS (PRESENTACIÓN COMERCIAL)'),
        ]);
        expect(r.crp).toBe('F05-2');
        expect(r.alternativas.map(a => a.crp)).not.toContain('F05-1');
    });
    it('el laboratorio en el nombre de la SRS no es una variante', () => {
        const r = decidir({ product_id: 1, nombre: 'ALOPURINOL 300MG X 100 TAB SAIMED' }, [
            fila('F07-1', 'ALOPURINOL SAIMED 300 mg TABLETAS', 'CAJA X 100 TABLETAS (PRESENTACIÓN COMERCIAL)'),
        ]);
        expect(r.confianza).toBe('alta');
    });
    it('sin marca en el catálogo: sin pareja', () => {
        const r = decidir({ product_id: 1, nombre: 'MICROPORE 1X5 YDAS 3M/CUREBAND' }, [
            fila('M-1', 'MICONAZOL CREMA', 'TUBO X 30 G'),
        ]);
        expect(r.confianza).toBe('sin_pareja');
        expect(r.crp).toBeNull();
    });
});
