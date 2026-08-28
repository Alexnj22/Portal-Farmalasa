/**
 * El NUP de la AFP: el de hoy y el de antes.
 *
 * ── Los dos que hay que saber distinguir ───────────────────────────────────
 *
 * Desde **enero de 2023** el NUP quedó homologado al **DUI**: uno se afilia y
 * hace cualquier trámite de pensiones con su número de documento. Antes de eso
 * las AFP daban un número propio de **12 dígitos**, y esas fichas viejas siguen
 * existiendo — el número anterior no deja de ser cierto porque haya cambiado la
 * regla.
 *
 * Por eso el campo acepta las dos formas. Lo que NO acepta es cualquier cosa: un
 * número de pensiones mal escrito no falla al guardarse, falla el día que
 * alguien va a hacer un trámite con él.
 *
 * ── Y avisa cuando el DUI que se escribe NO es el de la persona ────────────
 *
 * Es el error silencioso de esta pareja de campos: si el NUP tiene forma de DUI
 * pero no coincide con el DUI de la ficha, o hay un dedazo o se copió el
 * documento de otra persona. Las dos cosas hay que decirlas — un NUP que apunta
 * a otro DUI es un dato que se ve perfectamente válido.
 */

const soloDigitos = (v) => String(v || '').replace(/\D/g, '');

/** ¿Tiene forma de DUI? Nueve dígitos. No comprueba el verificador: de eso se
 *  ocupa el campo del DUI, que es donde ese número vive de verdad. */
export const pareceDui = (v) => soloDigitos(v).length === 9;

/** El NUP viejo de la AFP: doce dígitos. */
export const pareceNupViejo = (v) => soloDigitos(v).length === 12;

/**
 * ¿Sirve este NUP? Y si no, por qué.
 *
 * @param {string} nup   lo escrito
 * @param {string} dui   el DUI de la ficha, para cruzarlo
 * @returns {{ok: boolean, motivo: string|null, esElDui: boolean}}
 */
export function revisarNup(nup, dui) {
    const n = soloDigitos(nup);
    if (!n) return { ok: true, motivo: null, esElDui: false };   // vacío es un estado legítimo

    if (pareceDui(n)) {
        const d = soloDigitos(dui);
        // Sin DUI en la ficha no se puede cruzar, y no se inventa un error:
        // el número tiene forma válida y eso es todo lo que se puede afirmar.
        if (!d) return { ok: true, motivo: null, esElDui: true };
        if (d === n) return { ok: true, motivo: null, esElDui: true };
        return {
            ok: false, esElDui: false,
            motivo: 'Ese número tiene forma de DUI pero no es el DUI de esta ficha. '
                  + 'Desde enero de 2023 el NUP ES el documento de identidad de la persona.',
        };
    }

    if (pareceNupViejo(n)) return { ok: true, motivo: null, esElDui: false };

    return {
        ok: false, esElDui: false,
        motivo: `Un NUP tiene 9 dígitos si es el DUI, o 12 si es de antes de 2023. Escribiste ${n.length}.`,
    };
}
