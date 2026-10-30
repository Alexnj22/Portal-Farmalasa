import { describe, it, expect } from 'vitest';
import { dteDeManual, validarManual } from '../../supabase/functions/_shared/compraManual.ts';
import { totalDelDocumento, tipoDocDe } from '../../supabase/functions/_shared/compraSobre.ts';

/* La factura en papel se viste de DTE para que la carga sea la MISMA. */
const PAPEL = {
    id: 7, proveedor_nit: '06142510021011', proveedor_nombre: 'LA CONSTANCIA LTDA. DE C.V.', erp_supplier_id: 49,
    tipo_doc: 'CCF', numero: '005342', serie: '21DS011U', fecha_emision: '2026-10-29', total: 80.21, percepcion: 0,
    renglones: [
        { codigo: null, descripcion: 'AGUA CRISTAL 600 ML', cantidad: 24, importe: 6.48, exento: false },
        { codigo: 'X1', descripcion: 'PILSENER LATA', cantidad: 3, importe: 64.5, exento: false },
    ],
};

describe('dteDeManual', () => {
    const { d, dte } = dteDeManual(PAPEL);
    it('tiene la forma del documento y del DTE', () => {
        expect(d.manual_id).toBe(7);
        expect(d.codigo_generacion).toBe('005342');
        expect(tipoDocDe(d.tipo_dte)).toBe('CCF');
        expect(dte.cuerpoDocumento).toHaveLength(2);
        expect(totalDelDocumento(dte.resumen)).toBe(80.21);
    });
    it('el unitario se despeja del importe, y el importe se respeta al centavo', () => {
        const [a, b] = dte.cuerpoDocumento;
        expect(a.precioUni).toBe(0.27);
        expect(a.ventaGravada).toBe(6.48);
        expect(b.precioUni).toBe(21.5);
        expect(dte.resumen.totalGravada).toBe(70.98);
    });
    it('un exento va a la columna exenta', () => {
        const { dte: e } = dteDeManual({ ...PAPEL, renglones: [{ descripcion: 'X', cantidad: 3, importe: 1, exento: true }] });
        expect(e.cuerpoDocumento[0]).toMatchObject({ ventaGravada: 0, ventaExenta: 1, precioUni: 0.333333 });
    });
});

describe('validarManual', () => {
    const base = { tipo_doc: 'CCF', numero: ' 005 342 ', fecha: '2026-10-29', total: '80.21', renglones: [{ descripcion: 'agua', cantidad: '24', importe: '6.48' }] };
    it('limpia el número y la descripción', () => {
        const v = validarManual(base);
        expect(v.ok).toBe(true);
        expect(v.fila.numero).toBe('005342');
        expect(v.fila.renglones[0]).toMatchObject({ descripcion: 'AGUA', cantidad: 24, importe: 6.48 });
    });
    it('frena lo que falta o no cuadra', () => {
        expect(validarManual({ ...base, tipo_doc: 'X' }).ok).toBe(false);
        expect(validarManual({ ...base, numero: '' }).ok).toBe(false);
        expect(validarManual({ ...base, numero: '12%' }).ok).toBe(false);
        expect(validarManual({ ...base, fecha: '2999-01-01' }).ok).toBe(false);
        expect(validarManual({ ...base, total: '0' }).ok).toBe(false);
        expect(validarManual({ ...base, renglones: [] }).ok).toBe(false);
        expect(validarManual({ ...base, renglones: [{ descripcion: 'agua', cantidad: '0', importe: '1' }] }).ok).toBe(false);
    });
    it('una fila en blanco no cuenta', () => {
        const v = validarManual({ ...base, renglones: [...base.renglones, { descripcion: '', cantidad: '', importe: '' }] });
        expect(v.ok && v.fila.renglones).toHaveLength(1);
    });
});
