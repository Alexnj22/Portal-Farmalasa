import { describe, it, expect } from 'vitest';
import { ajustesConArchivo, problemaDelArchivo, seQuitaDesdeLaApp, seSubeDesdeLaApp } from '@nucleo/utils/expedienteDeSucursal';
import { esArchivoPorSubir } from '@nucleo/store/slices/branchSlice';

const archivo = { name: 'x.pdf', body: new ArrayBuffer(4), contentType: 'application/pdf' };

describe('subir un documento del expediente desde la app', () => {
    it('pone el archivo donde updateBranch lo busca', () => {
        const s = ajustesConArchivo({ legal: { srsPermit: '12' } }, 'srs', archivo);
        expect(s.legal.srsPermitFile).toBe(archivo);
        expect(s.legal.srsPermit).toBe('12');
        expect(ajustesConArchivo({}, 'arrendamiento', archivo).rent.contract.documentFile).toBe(archivo);
    });
    it('quitar deja la URL en null sólo en los legales', () => {
        expect(ajustesConArchivo({ legal: { municipalUrl: 'u' } }, 'alcaldia', null).legal.municipalUrl).toBeNull();
        expect(ajustesConArchivo({}, 'arrendamiento', null)).toBeNull();
        expect(seQuitaDesdeLaApp('arrendamiento')).toBe(false);
    });
    it('enfermería y documentos propios siguen en el portal', () => {
        expect(seSubeDesdeLaApp('nurse_carne_0')).toBe(false);
        expect(ajustesConArchivo({}, 'abc-propio', archivo)).toBeNull();
    });
    it('respeta lo que acepta el bucket', () => {
        expect(problemaDelArchivo({ tipo: 'application/pdf', tamano: 1000 })).toBeNull();
        expect(problemaDelArchivo({ tipo: 'application/zip', tamano: 1000 })).toMatch(/PDF/);
        expect(problemaDelArchivo({ tipo: 'image/jpeg', tamano: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    });
    it('el store reconoce el archivo de la app', () => {
        expect(esArchivoPorSubir(archivo)).toBe(true);
        expect(esArchivoPorSubir({ name: 'x' })).toBe(false);
        expect(esArchivoPorSubir(null)).toBe(false);
    });
});
