import { describe, it, expect } from 'vitest';
import { renglonSinVence } from '@nucleo/data/envios';

// Los textos son los que escribe `venceParaMover` (supabase/functions/_shared/venceDeCaja.ts).
describe('renglonSinVence', () => {
    it('reconoce el renglón sin vencimiento: reenviar no lo saca', () => {
        expect(renglonSinVence({ estado: 'error', error: 'KISS CHOCOLATE KISS BOLSA X 50 no tiene vencimiento registrado. Hay que armarlo de nuevo y escribir el vencimiento que trae la caja.' })).toBe(true);
        expect(renglonSinVence({ estado: 'error', error: 'X: el vencimiento escrito (2026-01-01) ya pasó.' })).toBe(true);
        // El texto de `enviar-producto-erp` cuando falta el lote (TOTALVIT, 2026-11-13).
        expect(renglonSinVence({ estado: 'error', error: 'TOTALVIT C 500MG X 30 CAPSULAS: 1 unidades no tienen lote asignado. Hay que armar el envío de nuevo y escribir el lote y el vencimiento que trae la caja.' })).toBe(true);
    });
    it('no toca los demás fallos, que sí se reintentan', () => {
        expect(renglonSinVence({ estado: 'error', error: 'X no tiene existencia en tu sala.' })).toBe(false);
        expect(renglonSinVence({ estado: 'por_enviar', error: null })).toBe(false);
    });
});
