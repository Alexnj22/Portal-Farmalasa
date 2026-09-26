import { describe, it, expect } from 'vitest';
import { datosDeDiferenciasPendientes } from '../../src/utils/faltanteDeCaja';

const aviso = (metadata) => ({ type: 'CORTE_DIFERENCIAS_PENDIENTES', metadata });

describe('datosDeDiferenciasPendientes', () => {
    it('suma lo sin resolver y lo por cobrar, con números que llegan como texto', () => {
        const d = datosDeDiferenciasPendientes(aviso({
            sala: 'Salud 2', sin_resolver: 1, monto_sin_resolver: '0.20', con_saldo: 1, por_cobrar: '6.75',
        }));
        expect(d).toMatchObject({ sala: 'Salud 2', sinResolver: 1, conSaldo: 1, total: 6.95 });
    });
    it('sin nada pendiente vuelve a la fila de texto', () => {
        expect(datosDeDiferenciasPendientes(aviso({ sin_resolver: 0, por_cobrar: 0 }))).toBeNull();
    });
    it('otro tipo de aviso no se toca', () => {
        expect(datosDeDiferenciasPendientes({ type: 'CORTE_DIFERENCIA_AYER', metadata: {} })).toBeNull();
    });
});
