// El aviso de vales por anotar tiene que decir DE QUÉ SALA.
//
// Reportado por el usuario (2-sep) sobre Bolsas:
//
//     «Faltan anotarle a la caja 2 salidas por $127.00»
//     — «¿qué es eso? ¿de qué sucursal? no entiendo»
//
// Eran dos salidas de Salud 3 de hoy. Y no era un olvido de redacción: este
// aviso vive FUERA del filtro de sucursal a propósito —es trabajo pendiente y
// esconderlo detrás de un recorte sería no anunciarlo—, así que la sala tampoco
// se podía deducir de la pantalla. Un aviso que dice que hay algo que hacer y
// no dónde es lo mismo que no decir nada.
//
// Se prueba el TEXTO, que es lo que falló: la lógica no cambió y seguía
// devolviendo exactamente las mismas dos filas.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const filas = { valor: [] };

vi.mock('../../src/data/bolsas', () => ({
    fetchValesPendientes: async () => ({ filas: filas.valor, pude: true }),
    anotarValesEnCaja: async () => ({ ok: true, resultados: [] }),
}));
vi.mock('../../src/context/AuthContext', () => ({
    useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock('../../src/store/toastStore', () => ({
    useToastStore: (sel) => sel({ showToast: () => {} }),
}));

const { default: ValesDeCaja } = await import('../../src/components/bolsas/ValesDeCaja');

const vale = (o) => ({
    branch_id: 5, sala: 'Salud 3', dia_abierto: '2026-09-02',
    movimiento_id: 1, operacion_id: 1, folio: 'OTR-1062', monto: 125, ...o,
});

const pintar = async (lista) => {
    filas.valor = lista;
    const r = render(<ValesDeCaja />);
    // La carga es un efecto asíncrono: el aviso aparece después.
    await screen.findByText(/anotarle a la caja/i);
    return r;
};

describe('el aviso nombra la sala', () => {
    it('con una sola: «Salud 3 — faltan anotarle a la caja 2 salidas por $127.00»', async () => {
        const { container } = await pintar([
            vale(),
            vale({ movimiento_id: 2, operacion_id: 2, folio: 'GAS-1063', monto: 2 }),
        ]);
        expect(container.textContent).toContain('Salud 3 — faltan anotarle a la caja 2 salidas por $127.00');
    });

    it('con dos, las nombra a las dos: no «2 salas»', async () => {
        const { container } = await pintar([
            vale(),
            vale({ branch_id: 7, sala: 'La Popular', movimiento_id: 2, operacion_id: 2, folio: 'GAS-9', monto: 2 }),
        ]);
        expect(container.textContent).toContain('Salud 3 y La Popular —');
    });

    it('con una sola salida, la frase queda en singular', async () => {
        const { container } = await pintar([vale()]);
        expect(container.textContent).toContain('Salud 3 — falta anotarle a la caja una salida de $125.00');
    });

    it('sin nombre de sala el aviso igual sale, sin un hueco en la frase', async () => {
        // El nombre viene de la fila. Si alguna vez no viniera, lo que NO puede
        // pasar es que el aviso deje de salir o diga «de undefined»: es dinero
        // que la caja sigue esperando.
        const { container } = await pintar([vale({ sala: null })]);
        expect(container.textContent).toContain('Falta anotarle a la caja una salida de $125.00');
        expect(container.textContent).not.toContain('undefined');
        expect(container.textContent).not.toContain('null');
    });
});
