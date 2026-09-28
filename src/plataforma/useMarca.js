import { useEffect } from 'react';

// Pinta el portal entero con los colores de otra marca mientras la vista que
// lo llama está montada. Estampa `data-marca` en <html> —no en el envoltorio
// de la vista— porque los modales se montan en <body> y tienen que heredar
// los mismos tokens. Al desmontarse lo quita: la marca es de la vista, no de
// la sesión. Los valores viven en index.css bajo `:root[data-marca=…]`.
export function useMarca(marca) {
    useEffect(() => {
        const raiz = document.documentElement;
        raiz.setAttribute('data-marca', marca);
        return () => {
            if (raiz.getAttribute('data-marca') === marca) raiz.removeAttribute('data-marca');
        };
    }, [marca]);
}
