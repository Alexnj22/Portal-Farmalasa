import { describe, expect, it } from 'vitest';
import { construirComprobanteDeCorte } from '@nucleo/utils/corteTicket';
import { acumuladoAntesDe, conTramoDelCorte, resultadoDeLaFila } from '@nucleo/utils/cortesDiagnostico';
import { textoParaElRollo } from '@nucleo/utils/ticketPrint';

/* La Popular, 27-sep-2026 — el caso del reporte. Las filas tal cual están en
 * `cortes_caja` (las columnas que lee `diferenciaDelCorte`). El corte de las
 * 19:07 salió en Mi caja y en el papel con +$0.55 (la acumulada del día) y en
 * Cortes con −$0.05 (el tramo). La cifra que importa es la del tramo. */
const fila = (id, hora, estado, declarado, total, dif, ingresos, venta) => ({
    id, branch_id: 2, fecha: '2026-09-27', tipo: 'C', hora, estado,
    erp_corte_id: id + 13667, caja_erp: 6, turno: 1, empleado_texto: 'MI CAJA LA POPULAR',
    total_declarado: declarado, diferencia_erp: dif, esperado: total,
    tk_ingresos: ingresos, tk_venta: venta, tk_subtotal: total + 15, tk_vales: 15,
    tk_total_caja: total, tk_cobros_credito: null, cobros_portal_efectivo: 0,
});
const DIA = [
    fila(1537, '12:45:20', 'DESCARTADO', 458.26, 438.91, 19.35, 59.41, 394.50),
    fila(1539, '13:04:23', 'CONFIRMADO', 465.46, 464.86, 0.60, 91.81, 388.05),
    fila(1554, '19:01:41', 'DESCARTADO', 672.86, 672.31, 0.55, 96.81, 590.50),
    fila(1555, '19:07:35', 'PENDIENTE', 672.86, 672.31, 0.55, 96.81, 590.50),
    { id: 1557, tipo: 'Z', hora: '19:07:56', estado: 'PENDIENTE', total_declarado: 672.31, diferencia_erp: 0 },
];

describe('la diferencia del tramo', () => {
    it('mide contra el último CONFIRMADO; los descartados no corren la base', () => {
        const previo = acumuladoAntesDe(DIA, { hora: '19:07:35', excluirId: 1555 });
        expect(previo).toEqual({ valor: 0.60, hora: '13:04:23' });
        const r = conTramoDelCorte(resultadoDeLaFila(DIA[3]), previo);
        expect(r.diferencia).toBe(0.55);
        expect(r.tramo).toBe(-0.05);
    });

    it('el primer corte del día: tramo y acumulada son lo mismo', () => {
        const previo = acumuladoAntesDe(DIA, { hora: '13:04:23', excluirId: 1539 });
        expect(previo).toEqual({ valor: 0, hora: null });
        expect(conTramoDelCorte(resultadoDeLaFila(DIA[1]), previo).tramo).toBe(0.60);
    });

    it('el corte recién hecho (sin hora): toma el último confirmado del día', () => {
        expect(acumuladoAntesDe(DIA).valor).toBe(0.60);
    });

    it('el papel dice el tramo como Diferencia y la acumulada debajo', () => {
        const r = conTramoDelCorte(resultadoDeLaFila(DIA[3]),
            acumuladoAntesDe(DIA, { hora: '19:07:35', excluirId: 1555 }));
        const papel = textoParaElRollo({ ancho: 58, ...construirComprobanteDeCorte({
            resultado: r, sala: 'La Popular', hechoPor: 'NATALY FLORES', hechoAt: '2026-09-28T01:07:46Z',
        }) });
        expect(papel).toMatch(/Diferencia[^\n]*-\$0\.05/);
        expect(papel).toMatch(/Acumulada del dia[^\n]*\+\$0\.55/);
    });

    it('sin base (no se pudo leer el día), el papel queda con la acumulada', () => {
        const r = conTramoDelCorte(resultadoDeLaFila(DIA[3]), null);
        expect(r.tramo).toBeUndefined();
        const papel = textoParaElRollo({ ancho: 58, ...construirComprobanteDeCorte({
            resultado: r, sala: 'La Popular', hechoPor: 'X', hechoAt: '2026-09-28T01:07:46Z',
        }) });
        expect(papel).toMatch(/Diferencia[^\n]*\+\$0\.55/);
        expect(papel).not.toContain('Acumulada');
    });
});
