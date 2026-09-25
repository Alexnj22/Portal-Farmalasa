import { useEffect, useState } from 'react';

/**
 * El texto de un buscador que consulta a la base, rebotado.
 *
 *   const [texto, setTexto, aplicado] = useBusqueda();
 *   <ViewTabBar searchValue={texto} onSearchChange={setTexto} … />
 *   useEffect(() => cargar(aplicado), [aplicado]);
 *
 * Existe porque estaba escrito a mano en doce vistas, con esperas de 250 a
 * 380 ms, y una —Compras— no esperaba nada: cada tecla era una consulta, y
 * «amoxicilina» eran once. Plan: docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md (F5).
 *
 * `aplicado` va sin espacios en los extremos: «amox » y «amox» son la misma
 * búsqueda y no merecen dos consultas. Vaciar el buscador se aplica al
 * instante — nadie espera a que vuelva la lista entera.
 */
export const ESPERA_BUSQUEDA_MS = 350;

export function useBusqueda(inicial = '', espera = ESPERA_BUSQUEDA_MS) {
    const [texto, setTexto] = useState(inicial);
    const aplicado = useTextoRebotado(texto, espera);
    return [texto, setTexto, aplicado];
}

/** La mitad del hook para quien ya tiene el texto en su propio estado. */
export function useTextoRebotado(texto, espera = ESPERA_BUSQUEDA_MS) {
    const limpio = (texto ?? '').trim();
    const [aplicado, setAplicado] = useState(limpio);
    useEffect(() => {
        if (!limpio) { setAplicado(''); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar no espera
        const t = setTimeout(() => setAplicado(limpio), espera);
        return () => clearTimeout(t);
    }, [limpio, espera]);
    return aplicado;
}
