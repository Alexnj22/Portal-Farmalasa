import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// Un traslado tiene TRES actos y la pantalla mostraba dos.
//
// Reportado mirando el detalle de un traslado de Salud 5 a Salud 4: «¿cómo
// puedo ver quién aceptó esto en Salud 4?». No se podía. El modal pintaba a
// quien pidió y a quien despachó, y el tercero —quien abrió la bolsa del otro
// lado— estaba guardado en `metadata.erp_recibido` desde el día uno sin que
// ninguna pantalla lo leyera. Medido en producción el 2026-08-31: 622 de los
// 666 traslados tenían el dato y ninguno lo mostraba.
//
// Los metadatos de acá son los REALES de producción, copiados tal cual, porque
// las tres formas que sabe tomar `erp_recibido` no se adivinan escribiendo un
// objeto de mentira:
//
//   · la normal            → `by_name` con nombre y los tres números
//   · la del barrido       → `by_name: null` + `via: 'sistema'`, SIN números
//   · la del barrido vieja → `by_name` con nombre, `via: 'sistema'` y sin números
//
// La segunda es la que importa: ahí no se inventa una firma. Y las dos últimas
// son las que romperían un `Number(x)` descuidado, porque `Number(null)` es 0 y
// «0 productos · 0 unidades» no es un hueco, es una afirmación falsa.
// ═══════════════════════════════════════════════════════════════════════════

const DetalleSolicitud = (await import('../../src/views/solicitudes/DetalleSolicitud.jsx')).default;
const { cuandoSeDecidio } = await import('../../src/views/solicitudes/movimientoTexto.js');

/* Traslado 35559 — Salud 5 → Salud 4, ULTRA DOCEPLEX. El del reporte. */
const REAL = {
    id: '37718f72-1ad5-4908-beed-02e47e56b1c6',
    type: 'INVENTORY_TRANSFER_REQUEST',
    status: 'APPROVED',
    employee_id: 'kevin',
    approver_id: 'yessica',
    note: 'solicito por encargo',
    created_at: '2026-08-30T16:30:08.921Z',
    // Lo movió la RECEPCIÓN del día siguiente, no la aprobación. Ése es el bug.
    updated_at: '2026-08-31T16:35:23.872Z',
    metadata: {
        branch_name: 'Salud 4',
        origen_branch_name: 'Salud 5',
        total_unidades: 2,
        items: [{
            descripcion: 'ULTRA DOCEPLEX AMPOLLAS INY.',
            cantidad: 2, factor: 1, presentacion_tipo: 'CAJA', erp_product_id: 3689,
        }],
        erp_traslado: {
            at: '2026-08-30T16:34:01.896Z', by_name: 'Yessica Xiomara Hernandez',
            lineas: 1, unidades: 2, total: 6.2496, id_traslado: '35559',
        },
        erp_recibido: {
            at: '2026-08-31T16:35:23.861Z', by: '3be13c04', msg: 'Hecho!',
            total: 6.2496, lineas: 1, unidades: 2, by_name: 'Idalia Serrano',
            concepto: 'REC IDALIA SERRANO (S4) ENV YESSICA HERNANDEZ (S5)',
            id_traslado: '35559',
        },
    },
};

const conRecibido = (recibido) => ({
    ...REAL,
    metadata: { ...REAL.metadata, erp_recibido: recibido },
});

const pintar = (req) => render(<DetalleSolicitud req={req} employeesById={new Map()} />);

describe('el traslado dice quién lo recibió', () => {
    it('nombra a quien abrió la bolsa, y la sala donde la abrió', () => {
        pintar(REAL);
        expect(screen.getByText(/Recibido en Salud 4/i)).toBeTruthy();
        expect(screen.getByText(/por Idalia Serrano/)).toBeTruthy();
    });

    it('separa el despacho de la recepción por su rótulo', () => {
        pintar(REAL);
        // Con las dos cajas diciendo «Aplicado», la primera parecía el resumen
        // de todo y quien la firmaba, el único que tocó la bolsa.
        expect(screen.getByText(/Despachado desde Salud 5/i)).toBeTruthy();
        expect(screen.queryByText(/^Aplicado$/i)).toBeNull();
        expect(screen.getByText(/por Yessica Xiomara Hernandez/)).toBeTruthy();
    });

    it('dice cuánto entró y cuánto tardó la bolsa desde el despacho', () => {
        pintar(REAL);
        expect(screen.getByText(/1 producto · 2 unidades · \$6\.25 · por Idalia Serrano/)).toBeTruthy();
        expect(screen.getByText(/desde el despacho/)).toBeTruthy();
    });

    it('sin recepción no pinta la caja — un traslado en camino no llegó', () => {
        pintar(conRecibido(undefined));
        expect(screen.queryByText(/Recibido en/i)).toBeNull();
    });

    /* ── Lo que cerró el barrido ─────────────────────────────────────────── */

    it('cuando lo cerró el portal solo, NO inventa una firma', () => {
        pintar(conRecibido({
            at: '2026-08-20T14:16:07.778Z', by: null, by_name: null,
            por: 'barrido', via: 'sistema', id_traslado: '29444',
            msg: 'El sistema ya lo tenia recibido cuando el portal barrio las solicitudes en camino; no se volvio a cargar. La fecha de arriba es la del barrido, no la de la entrada.',
        }));
        expect(screen.getByText(/lo cerró el portal solo/)).toBeTruthy();
        // Y explica por qué la hora no es la de la entrada.
        expect(screen.getByText(/La fecha de arriba es la del barrido/)).toBeTruthy();
    });

    it('sin los números, no escribe «0 productos» — Number(null) es 0', () => {
        pintar(conRecibido({
            at: '2026-08-18T00:54:45.604Z', by: '5dd459fa', via: 'sistema',
            by_name: 'Amadeo Clemente', id_traslado: '29446',
            msg: 'El sistema ya lo tenía recibido; no se volvió a cargar.',
        }));
        expect(screen.queryByText(/0 productos/)).toBeNull();
        expect(screen.queryByText(/0 unidades/)).toBeNull();
        expect(screen.getByText(/por Amadeo Clemente/)).toBeTruthy();
        // Esta fila SÍ tiene firma, y aun así necesita la explicación: la
        // condición del aviso es `via`, no «falta el nombre».
        expect(screen.getByText(/El sistema ya lo tenía recibido/)).toBeTruthy();
    });

    /* Producción trae hoy la clave AUSENTE, y con eso `Number(undefined)` es NaN
       y hasta un chequeo perezoso pasa. El día que llegue en `null` explícito,
       `Number(null)` es 0 y la caja afirma «0 productos». Esta prueba es la que
       falla si alguien simplifica el guard a `Number.isFinite(Number(v))`. */
    it('con los números en null tampoco escribe «0 productos»', () => {
        pintar(conRecibido({
            at: '2026-08-18T00:54:45.604Z', by_name: 'Amadeo Clemente',
            lineas: null, unidades: null, total: null,
        }));
        expect(screen.queryByText(/0 productos/)).toBeNull();
        expect(screen.queryByText(/0 unidades/)).toBeNull();
        expect(screen.queryByText(/\$0\.00/)).toBeNull();
        expect(screen.getByText(/por Amadeo Clemente/)).toBeTruthy();
    });

    it('el «Hecho!» del sistema no se muestra: no le dice nada a nadie', () => {
        pintar(REAL);
        expect(screen.queryByText(/Hecho!/)).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Y la hora de «Aprobó» era la de otra persona.
//
// `updated_at` no es la hora de la decisión: es la del último retoque de la
// fila. La recepción de Idalia lo movió, y la ficha de Yessica quedó sellada
// con el momento en que actuó Idalia — 31 ago 10:35 sobre un despacho del 30
// ago 10:34. Medido en producción: `approvals` está VACÍO en las 788
// solicitudes de la tabla, así que la rama buena no existía y todo caía al
// respaldo; 416 de 635 traslados (65%) mostraban una hora equivocada, con hasta
// 118.8 horas de desfase.
// ═══════════════════════════════════════════════════════════════════════════

describe('cuándo se decidió de verdad', () => {
    it('un traslado se firma cuando se despachó, no cuando lo recibieron', () => {
        expect(cuandoSeDecidio(REAL)).toBe('2026-08-30T16:34:01.896Z');
        expect(cuandoSeDecidio(REAL)).not.toBe(REAL.updated_at);
    });

    it('lo que se aplica afuera usa su propia marca', () => {
        const req = {
            status: 'APPROVED', updated_at: '2026-08-26T23:10:39.247Z',
            metadata: { erp_aplicado: { at: '2026-08-26T01:15:07.568Z' } },
        };
        expect(cuandoSeDecidio(req)).toBe('2026-08-26T01:15:07.568Z');
    });

    it('un envío usa el paso que marcó al decidirse', () => {
        const req = {
            status: 'APPROVED', updated_at: '2026-08-25T10:00:00.000Z',
            metadata: { decidido_at: '2026-08-24T09:00:00.000Z' },
        };
        expect(cuandoSeDecidio(req)).toBe('2026-08-24T09:00:00.000Z');
    });

    it('un rechazo no deja marca propia y cae a updated_at', () => {
        const req = { status: 'REJECTED', updated_at: '2026-08-18T00:54:45.604Z', metadata: {} };
        expect(cuandoSeDecidio(req)).toBe('2026-08-18T00:54:45.604Z');
    });

    it('mientras está pendiente no hay decisión que fechar', () => {
        expect(cuandoSeDecidio({ status: 'PENDING', updated_at: 'x', metadata: {} })).toBeNull();
    });
});
