import { describe, it, expect } from 'vitest';
import { hastaElTope } from '@nucleo/utils/hastaElTope';

// La regla de todo campo de dinero con máximo (usuario, 2026-09-29): escribir
// de más se lleva al máximo, no bloquea.
describe('hastaElTope', () => {
    it('un valor mayor se lleva al tope y avisa que topeó', () => {
        expect(hastaElTope('50', 8.93)).toEqual({ valor: '8.93', topeado: true });
        expect(hastaElTope('100', 47.5)).toEqual({ valor: '47.50', topeado: true });
    });
    it('lo que cabe queda tal cual, incluso a medio escribir', () => {
        expect(hastaElTope('8.93', 8.93)).toEqual({ valor: '8.93', topeado: false });
        expect(hastaElTope('5.', 8.93)).toEqual({ valor: '5.', topeado: false });
        expect(hastaElTope('', 8.93)).toEqual({ valor: '', topeado: false });
    });
    it('sin tope conocido no recorta nada', () => {
        expect(hastaElTope('50', null)).toEqual({ valor: '50', topeado: false });
        expect(hastaElTope('50', 0)).toEqual({ valor: '50', topeado: false });
        expect(hastaElTope('50', NaN)).toEqual({ valor: '50', topeado: false });
    });
    it('el tope sale redondeado al centavo', () => {
        expect(hastaElTope('30', 20.004999).valor).toBe('20.00');
        expect(hastaElTope('30', 0.1 + 0.2).valor).toBe('0.30');
    });
});
