import { describe, expect, it } from 'vitest';
import { motivoParaNoGuardarContacto } from '@nucleo/utils/encuestasClientes';

describe('motivoParaNoGuardarContacto', () => {
    it('sin consentimiento no se guarda nada', () => {
        expect(motivoParaNoGuardarContacto({ consiente: false, telefono: '71234567' })).toMatch(/consentimiento/);
    });
    it('hace falta el teléfono o el nombre', () => {
        expect(motivoParaNoGuardarContacto({ consiente: true, telefono: ' ', nombre: '' })).toMatch(/teléfono o el nombre/);
        expect(motivoParaNoGuardarContacto({ consiente: true, nombre: 'Ana' })).toBeNull();
    });
    it('el teléfono, si viene, tiene que ser válido', () => {
        expect(motivoParaNoGuardarContacto({ consiente: true, telefono: '1234' })).toMatch(/8 dígitos/);
        expect(motivoParaNoGuardarContacto({ consiente: true, telefono: '7123-4567' })).toBeNull();
    });
});
