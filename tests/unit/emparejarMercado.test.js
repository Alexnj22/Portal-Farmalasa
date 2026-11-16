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
    it('el fabricante del genérico decide entre presentaciones iguales', () => {
        const r = decidir({ product_id: 1, nombre: 'CARBAMAZEPINA 200MG X 100 SAIMED', laboratorio: 'SAIMED' }, [
            fila('18259-1', 'CARBAMAZEPINA 200MG TABLETAS ECOMED', 'CAJA X 10 BLISTER X 10 TABLETA (PRESENTACIÓN COMERCIAL)', 'LABORATORIOS PHARMEDIC'),
            fila('F021818042013-1', 'CARBAMAZEPINA 200 MG BIOGALENIC TABLETAS', 'CAJA X 100 TABLETAS (PRESENTACIÓN COMERCIAL)', 'M/S. BAROQUE PHARMACEUTICALS PVT. LTD.'),
            fila('F035203092008-1', 'CARBAMAZEPINA 200 mg SAIMED TABLETA', 'CAJA X 100 TABLETAS (PRESENTACIÓN COMERCIAL)', 'M/S CAPLIN POINT LABORATORIES LTD'),
        ]);
        expect(r.crp).toBe('F035203092008-1');
        // Sin el fabricante en el nombre, decide el laboratorio del producto.
        const sinNombre = decidir({ product_id: 2, nombre: 'CARBAMAZEPINA 200MG X 100', laboratorio: 'SAIMED' }, [
            fila('18259-1', 'CARBAMAZEPINA 200MG TABLETAS ECOMED', 'CAJA X 10 BLISTER X 10 TABLETA (PRESENTACIÓN COMERCIAL)', 'LABORATORIOS PHARMEDIC'),
            fila('F035203092008-1', 'CARBAMAZEPINA 200 mg SAIMED TABLETA', 'CAJA X 100 TABLETAS (PRESENTACIÓN COMERCIAL)', 'M/S CAPLIN POINT LABORATORIES LTD'),
        ]);
        expect(sinNombre.crp).toBe('F035203092008-1');
    });

    it('no es alta si falta lo que el portal dice en el nombre o cambia la forma tópica', () => {
        const mk = decidir({ product_id: 1, nombre: 'DICLOFENAC SODICO 50MG X 20 TAB. MK', laboratorio: 'TECNOQUIMICAS' }, [
            fila('A-1', 'DICLOFENACO SODICO 50 mg TABLETAS RECUBIERTAS', 'CAJA X 20 TABLETAS RECUBIERTAS (PRESENTACIÓN COMERCIAL)', 'M/S BAL PHARMA LIMITED'),
        ]);
        expect(mk.confianza).not.toBe('alta');
        const ung = decidir({ product_id: 2, nombre: 'FUCIDIN UNGUENTO 2% X 15G' }, [
            fila('B-1', 'FUCIDIN LEO 2% CREMA', '1 TUBO X 15 G (PRESENTACIÓN COMERCIAL)', 'LEO PHARMA'),
        ]);
        expect(ung.confianza).not.toBe('alta');
    });

    it('una presentación institucional u hospitalaria nunca gana ni va de alternativa', () => {
        const r = decidir({ product_id: 1, nombre: 'XUMER 60MG X 14 TAB' }, [
            fila('F03-10', 'XUMER (ETORICOXIB) 60 mg COMPRIMIDOS RECUBIERTOS', 'CAJA X 2 BLISTER X 7 COMPRIMIDOS RECUBIERTOS (PRESENTACIÓN INSTITUCIONAL)'),
            fila('F03-7', 'XUMER (ETORICOXIB) 60 mg COMPRIMIDOS RECUBIERTOS', 'CAJA X 2 BLISTER X 7 COMPRIMIDOS RECUBIERTOS (PRESENTACIÓN HOSPITALARIA)'),
            fila('F03-4', 'XUMER (ETORICOXIB) 60 mg COMPRIMIDOS RECUBIERTOS', 'CAJA X 2 BLISTER X 7 COMPRIMIDOS RECUBIERTOS (PRESENTACIÓN COMERCIAL)'),
        ]);
        expect(r.crp).toBe('F03-4');
        expect(r.alternativas.map(a => a.crp)).not.toContain('F03-10');
        expect(r.alternativas.map(a => a.crp)).not.toContain('F03-7');
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
    it('las dudosas no son «alta»: sin empaque, sin concentración en la SRS, variante sólo en la SRS', () => {
        expect(decidir({ product_id: 1, nombre: 'HELIOCARE 360 OIL FREE BEIGE' }, [
            fila('H-1', 'HELIOCARE CAPSULAS ORAL', 'CAJA X 1 BOTE X 60 CAPSULAS'),
        ]).confianza).toBe('media');
        expect(decidir({ product_id: 1, nombre: 'FARCOLIT 40 MG. X 100 TAB.' }, [
            fila('F-1', 'FARCOLIT COMPRIMIDOS', 'CAJA DISPENSADORA X 10 BLISTERES X 10 COMPRIMIDOS'),
        ]).confianza).toBe('media');
        expect(decidir({ product_id: 1, nombre: 'DICLO K 12.5 MG X 5 SUPOSITORIOS' }, [
            fila('D-1', 'DICLO K SUPOSITORIOS PEDIATRICOS', 'CAJA X 5 SUPOSITORIO'),
        ]).confianza).toBe('media');
    });

    it('el genérico entre paréntesis o escrito en el nombre no es una variante', () => {
        const r = decidir({ product_id: 1, nombre: 'XUMER 90MG X 14 TAB.', principio_activo: 'ETORICOXIB' }, [
            fila('X-1', 'XUMER (ETORICOXIB) 90 mg COMPRIMIDOS RECUBIERTOS', 'CAJA X 2 BLISTER X 7 COMPRIMIDOS RECUBIERTOS'),
        ]);
        expect(r.crp).toBe('X-1');
        expect(r.confianza).toBe('alta');
        expect(decidir({ product_id: 2, nombre: 'QUETIDIN 25MG X 30 TAB', principio_activo: 'QUETIAPINA' }, [
            fila('Q-1', 'QUETIDIN QUETIAPINA 25 mg TABLETAS RECUBIERTAS', 'CAJA X 2 BLISTER X 15 TABLETAS RECUBIERTAS'),
        ]).confianza).toBe('alta');
    });

    it('el mismo producto en dos materiales de empaque no es un empate', () => {
        const r = decidir({ product_id: 1, nombre: 'ODICA 75MG X 28 CAPS' }, [
            fila('O-1', 'ODICA 75 MG CAPSULA DURA', 'CAJA X 2 BLISTERES DE ALUMINIO X 14 CAPSULAS'),
            fila('O-2', 'ODICA 75 MG CAPSULA DURA', 'CAJA X 2 BLISTERES DE PVC X 14 CAPSULAS'),
        ]);
        expect(r.confianza).toBe('alta');
        // Crema contra ungüento con el mismo puntaje sí es un empate.
        expect(decidir({ product_id: 2, nombre: 'DERMOVATE 0.05% X 30 GR' }, [
            fila('D-1', 'DERMOVATE 0.05% CREMA', 'TUBO X 30 G'),
            fila('D-2', 'DERMOVATE 0.05% UNGUENTO TOPICO', 'CAJA X 1 TUBO X 30 G'),
        ]).confianza).toBe('media');
    });
});
