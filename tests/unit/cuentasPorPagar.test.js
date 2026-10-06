import { describe, expect, it } from 'vitest';
import { ESTADO_PAGO, totalesCuentasPorPagar } from '@nucleo/utils/cuentasPorPagar';

describe('cuentasPorPagar', () => {
    it('suma lo que se debe, lo vencido y lo en trámite, y cuenta los sin plazo', () => {
        expect(totalesCuentasPorPagar([
            { saldo: 100, vencido: 40, en_tramite: 10, dias_credito: 30 },
            { saldo: 50, vencido: 0, en_tramite: 0, dias_credito: null },
        ])).toEqual({ saldo: 150, vencido: 40, tramite: 10, proveedores: 2, conVencido: 1, sinPlazo: 1 });
        expect(totalesCuentasPorPagar(null).proveedores).toBe(0);
    });
    it('cada estado de pago tiene rótulo', () => {
        expect(ESTADO_PAGO.pendiente.rotulo).toBe('Espera aprobación');
    });
});
