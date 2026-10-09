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
    it('los tres archivos de cada enfermera van a SU fila, por posición', () => {
        expect(seSubeDesdeLaApp('nurse_carne_0')).toBe(true);
        expect(seSubeDesdeLaApp('nurse_lic_1')).toBe(true);
        const s = ajustesConArchivo({ legal: { nursingRegents: [{ id: 1 }, { id: 2 }] } }, 'nurse_lic_1', archivo);
        expect(s.legal.nursingRegents[1].licenciaFile).toBe(archivo);
        expect(s.legal.nursingRegents[0].licenciaFile).toBeUndefined();
        // Una enfermera que no existe no se inventa.
        expect(ajustesConArchivo({ legal: { nursingRegents: [] } }, 'nurse_carne_3', archivo)).toBeNull();
    });
    it('los documentos propios no se suben por la fila: tienen su pantalla', () => {
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

import { ajustesConDocumentoPropio, ajustesSinDocumentoPropio, documentoPropio, problemaDelDocumentoPropio, rutaDelDocumentoPropio } from '@nucleo/utils/expedienteDeSucursal';
import { mesSiguiente, problemaDelPago, registroDelPago, yaEstabaPagado } from '@nucleo/utils/pagoDeSucursal';
import { conEnfermeraCambiada, conEnfermeraNueva, jefaturaDeSucursal, sinEnfermera, tipoDeMovimiento } from '@nucleo/utils/edicionDeSucursal';

describe('documentos propios, pagos y jefatura de la sala', () => {
    it('arma el documento propio como el portal y lo agrega o reemplaza', () => {
        const d = documentoPropio({ id: 'x', datos: { title: ' Póliza ', category: 'nada', hasExpiration: true, expDate: '2027-01-01' }, url: 'u' });
        expect(d).toMatchObject({ title: 'Póliza', category: 'OTRO', expDate: '2027-01-01', issueDate: null, url: 'u' });
        const s1 = ajustesConDocumentoPropio({}, d);
        const s2 = ajustesConDocumentoPropio(s1, { ...d, title: 'Otra' });
        expect(s2.customDocs).toHaveLength(1);
        expect(ajustesSinDocumentoPropio(s2, 'x').customDocs).toHaveLength(0);
        expect(rutaDelDocumentoPropio(7, 'x', 'pdf', 1)).toBe('branches/7/customDocs/x_1.pdf');
        expect(problemaDelDocumentoPropio({ title: '' })).toMatch(/obligatorio/);
    });
    it('el pago: el mes que sigue, si ya estaba pagado y el vencimiento del día de pago', () => {
        expect(mesSiguiente('2026-12')).toBe('2027-01');
        expect(yaEstabaPagado('2026-09', '2026-08')).toBe(true);
        expect(yaEstabaPagado('2026-09', '2026-10')).toBe(false);
        expect(problemaDelPago({ amount: '', billing_month: '2026-10' })).toMatch(/obligatorios/);
        const r = registroDelPago({ services: { light: { dueDay: 5 } } }, 'light', { amount: '12.5', billing_month: '2026-10' });
        expect(r).toMatchObject({ amount: 12.5, due_date: '2026-10-05', receiptFile: null });
    });
    it('enfermería por posición y jefatura por el texto del cargo', () => {
        const l = conEnfermeraNueva([], 99);
        expect(conEnfermeraCambiada(l, 0, 'employeeId', 'e1')[0].employeeId).toBe('e1');
        expect(sinEnfermera(l, 0)).toHaveLength(0);
        const gente = [{ id: 1, role: 'Jefe/a de Sala' }, { id: 2, role: 'Subjefe/a de Sala' }];
        expect(jefaturaDeSucursal(gente, 'FARMACIA')).toMatchObject({ jefe: { id: 1 }, subjefe: { id: 2 } });
        expect(tipoDeMovimiento({ branchId: 3, role: 'Dependiente' }, { id: 3 }, 'Jefe/a de Sala')).toBe('PROMOTION');
        expect(tipoDeMovimiento({ branchId: 4, role: 'Jefe/a de Sala' }, { id: 3 }, 'Jefe/a de Sala')).toBe('TRANSFER');
    });
});
