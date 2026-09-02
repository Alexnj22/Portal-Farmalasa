// El aviso de lo que la caja todavía cuenta: qué dice, y de qué sala.
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
// Y una segunda pregunta del mismo reporte destapó algo peor: *«pero no
// entiendo, ese vale se genera al realizar el corte»*. Tenía razón —
// `hacer-corte-caja` escribe el vale como paso 1, antes de mandar el corte— así
// que el aviso exigía («faltan anotarle… sin anotarlo, el próximo corte marca
// un faltante») una acción que el camino normal ya hace. Era un resto del
// 28-ago, cuando el botón era el único camino; el corte desde el portal es del
// 29 y nadie volvió a mirar el texto.
//
// Se prueba el TEXTO, que es lo que falló las dos veces: la lógica no cambió y
// seguía devolviendo exactamente las mismas dos filas.

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
    await screen.findByText(/la caja todavía cuenta/i);
    return r;
};

describe('el aviso nombra la sala', () => {
    it('con una sola: «Salud 3 · $127.00 de 2 salidas…»', async () => {
        const { container } = await pintar([
            vale(),
            vale({ movimiento_id: 2, operacion_id: 2, folio: 'GAS-1063', monto: 2 }),
        ]);
        expect(container.textContent).toContain('Salud 3 · $127.00 de 2 salidas de bolsas de hoy que la caja todavía cuenta como suyas.');
    });

    it('con dos, las nombra a las dos: no «2 salas»', async () => {
        const { container } = await pintar([
            vale(),
            vale({ branch_id: 7, sala: 'La Popular', movimiento_id: 2, operacion_id: 2, folio: 'GAS-9', monto: 2 }),
        ]);
        expect(container.textContent).toContain('Salud 3 y La Popular ·');
    });

    it('con una sola salida, la frase queda en singular', async () => {
        const { container } = await pintar([vale()]);
        expect(container.textContent).toContain('Salud 3 · $125.00 de una salida de bolsa de hoy que la caja todavía cuenta como suya.');
    });

    it('sin nombre de sala el aviso igual sale, sin un hueco en la frase', async () => {
        // El nombre viene de la fila. Si alguna vez no viniera, lo que NO puede
        // pasar es que el aviso deje de salir o diga «de undefined»: es dinero
        // que la caja sigue esperando.
        const { container } = await pintar([vale({ sala: null })]);
        expect(container.textContent).toContain('$125.00 de una salida de bolsa de hoy que la caja todavía cuenta');
        expect(container.textContent).not.toContain('undefined');
        expect(container.textContent).not.toContain('null');
    });
});

/* ── El aviso NO puede pedir lo que el corte ya hace ─────────────────────────
 *
 * Es la mitad que hizo preguntar dos veces. `hacer-corte-caja` escribe el vale
 * con todas las salidas del día como paso 1, antes de mandar el corte: por el
 * camino normal acá no hay nada que hacer y la lista se vacía sola. El texto
 * viejo decía lo contrario —«faltan anotarle… sin anotarlo, el próximo corte
 * marca un faltante que no existe»— y era falso justo en el caso de todos los
 * días.
 *
 * Lo que sí sigue siendo cierto: la sala todavía puede cortar en la pantalla de
 * la caja, y ESE corte no pasa por el portal. */
describe('no se presenta como un problema', () => {
    /* La tercera pregunta del usuario, el mismo día: «no es la lógica ya del
     * portal, registrar los vales / ingresos en el portal y al hacer el corte
     * reflejarlos todos? ¿por qué salen aquí como error o faltante?». Las dos
     * correcciones anteriores fueron a las palabras; lo que se leía como un
     * problema era la FORMA. */
    it('dice que se anota al hacer el corte, y ahí termina', async () => {
        const { container } = await pintar([vale()]);
        expect(container.textContent).toContain('Se le anota al hacer el corte.');
    });

    it('no exige nada ni nombra un faltante', async () => {
        const { container } = await pintar([vale()]);
        expect(container.textContent).not.toMatch(/falta[n]? anotarle/i);
        // «faltante» sólo tiene sentido si NO se anota, y acá se anota solo.
        // En el cuerpo del aviso se leía como si estuviera pasando.
        expect(container.textContent).not.toMatch(/faltante/i);
    });
});
