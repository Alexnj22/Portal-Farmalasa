import { describe, expect, it } from 'vitest';
import { hojaDeConteoHtml } from '@nucleo/utils/conteoPapelHtml';

// La hoja compacta: dos productos por renglón, apaisada, sin «Nota», y los
// pares nunca cruzan un laboratorio.
describe('hojaDeConteoHtml compacta', () => {
    const items = [
        { product_nombre: 'A', laboratorio_nombre: 'L1', lote: 'x', sistema_cantidad: 3 },
        { product_nombre: 'B', laboratorio_nombre: 'L1', lote: 'y', sistema_cantidad: 1 },
        { product_nombre: 'C', laboratorio_nombre: 'L2', lote: 'z', sistema_cantidad: 0 },
    ];

    it('gira la página y no lleva columna de notas', () => {
        const h = hojaDeConteoHtml({ scope_type: 'TOTAL' }, items, { compacta: true });
        expect(h).toContain('landscape');
        expect(h).not.toContain('<th>Nota</th>');
    });

    it('arma los pares dentro de cada laboratorio', () => {
        const h = hojaDeConteoHtml({ scope_type: 'TOTAL' }, items, { compacta: true });
        // 2 bandas + 1 fila con A y B + 1 fila con C sola + la cabecera.
        expect((h.match(/<tr>/g) || []).length).toBe(5);
    });

    it('sin `compacta` sigue siendo la hoja de siempre', () => {
        const h = hojaDeConteoHtml({ scope_type: 'TOTAL' }, items);
        expect(h).toContain('<th>Nota</th>');
        expect(h).not.toContain('landscape');
    });
});
