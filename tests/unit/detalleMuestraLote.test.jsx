import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LineasMovimiento } from '../../src/views/solicitudes/DetalleSolicitud';

// La solicitud de la captura (2026-11-05, FOLIMEN Bodega → Salud 3): el
// detalle no decía qué lote viajó, aunque estaba guardado en el despacho.
const meta = {
    items: [{
        erp_product_id: 2061, cantidad: 1, descripcion: 'FOLIMEN 5 MG X 100 COMPRIMIDOS', presentacion_tipo: 'CAJA',
        lotes: [{ lote: 'GENERICO', vence: '2028-10-01', unidades: 2 }],
    }],
    lotes_asignados: { 0: { lote: '25009', vence: '2028-10-01', paquetes: 1, id_lote_erp: '32912' } },
    erp_traslado: { detalle: [{ erp_product_id: 2061, cantidad: 1, numero_lote: '25009', id_lote_erp: '32912' }] },
};

describe('el detalle del traslado muestra el lote', () => {
    it('el que salió, con su vencimiento MM/AAAA', () => {
        const { container } = render(<LineasMovimiento meta={meta} />);
        const texto = container.textContent;
        expect(texto).toContain('Salió lote');
        expect(texto).toContain('25009');
        expect(texto).toContain('10/2028');
    });

    it('antes del despacho, lo que se pidió: un genérico se dice sin fecha', () => {
        const { container } = render(<LineasMovimiento meta={{ items: meta.items }} />);
        expect(container.textContent).toContain('Sin lote asignado');
        expect(container.textContent).not.toContain('10/2028');
    });
});
