// ─────────────────────────────────────────────────────────────────────────────
// El NUP de la AFP: el de hoy y el de antes
// ─────────────────────────────────────────────────────────────────────────────
//
// Desde enero de 2023 el NUP quedó homologado al DUI. El campo estaba de sólo
// lectura pintando el DUI, y la comprobación que había —`length !== 12`— daba
// por INCOMPLETO justamente el número de hoy, que tiene 9.
//
// Las dos formas conviven y las dos son ciertas: quien se afilió antes de 2023
// tiene su número de 12 dígitos y sigue siendo el suyo.
//
// La prueba que más importa es la del DUI AJENO: un NUP con forma de DUI que no
// es el de la ficha se ve perfectamente válido, y significa un dedazo o el
// documento de otra persona.

import { describe, it, expect } from 'vitest';
import { revisarNup, pareceDui, pareceNupViejo } from '../../src/utils/nupAfp';

const DUI = '01234567-8';

describe('lo que acepta', () => {
    it('vacío — no tener NUP es un estado legítimo', () => {
        expect(revisarNup('', DUI).ok).toBe(true);
        expect(revisarNup(null, DUI).ok).toBe(true);
    });

    it('el DUI de la ficha, y lo dice', () => {
        const r = revisarNup(DUI, DUI);
        expect(r.ok).toBe(true);
        expect(r.esElDui).toBe(true);
    });

    it('el mismo DUI escrito sin guion', () => {
        expect(revisarNup('012345678', DUI)).toMatchObject({ ok: true, esElDui: true });
    });

    it('el NUP viejo de 12 dígitos', () => {
        expect(revisarNup('123456789012', DUI)).toMatchObject({ ok: true, esElDui: false });
    });
});

describe('lo que rechaza', () => {
    it('EL CASO QUE IMPORTA: un DUI que no es el de esta ficha', () => {
        const r = revisarNup('09876543-2', DUI);
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/no es el DUI de esta ficha/i);
    });

    it('cualquier otro largo, y dice cuántos dígitos escribió', () => {
        const r = revisarNup('12345', DUI);
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/Escribiste 5/);
    });
});

describe('sin DUI en la ficha no se inventa un error', () => {
    it('un número con forma de DUI pasa: no hay contra qué cruzarlo', () => {
        // Afirmar «no coincide» cuando no hay con qué comparar es acusar sin
        // evidencia, y bloquearía a quien todavía no cargó el documento.
        expect(revisarNup(DUI, '')).toMatchObject({ ok: true, esElDui: true });
        expect(revisarNup(DUI, null).ok).toBe(true);
    });
});

describe('las dos formas', () => {
    it('nueve dígitos es forma de DUI; doce, del NUP viejo', () => {
        expect(pareceDui('01234567-8')).toBe(true);
        expect(pareceDui('123456789012')).toBe(false);
        expect(pareceNupViejo('123456789012')).toBe(true);
        expect(pareceNupViejo('01234567-8')).toBe(false);
    });
});
