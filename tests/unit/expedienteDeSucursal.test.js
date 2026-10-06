import { describe, expect, it } from 'vitest';
import { documentosDeSucursal, estadoDeDocumento } from '@nucleo/utils/expedienteDeSucursal';

describe('expedienteDeSucursal', () => {
    const hoy = new Date('2026-10-06T12:00:00');
    it('estado de un documento', () => {
        expect(estadoDeDocumento(null, null, hoy).type).toBe('MISSING');
        expect(estadoDeDocumento('u', '2026-10-01', hoy).type).toBe('EXPIRED');
        expect(estadoDeDocumento('u', '2026-11-01', hoy).type).toBe('WARNING');
        expect(estadoDeDocumento('u', '2027-06-01', hoy).type).toBe('OK');
        expect(estadoDeDocumento('u', null, hoy).type).toBe('OK');
    });
    it('los documentos dependen de la sucursal y el avance cuenta los subidos', () => {
        const b = { settings: { propertyType: 'RENTED', legal: { injections: true, srsPermitUrl: 'x', nursingRegents: [{}] }, customDocs: [{ id: 'c', title: 'Otro', category: 'Permisos y licencias', url: 'y' }] } };
        const e = documentosDeSucursal(b);
        expect(e.permisos.map((d) => d.id)).toEqual(['srs', 'alcaldia', 'inyecciones']);
        expect(e.personal).toHaveLength(6);
        expect(e.infra.map((d) => d.id)).toEqual(['arrendamiento', 'desechos', 'fumigacion']);
        expect(e.propios[0].category).toBe('PERMISOS');
        expect(e.subidos).toBe(2);
        expect(e.total).toBe(13);
    });
});
