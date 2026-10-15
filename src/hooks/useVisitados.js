// La marca de «visitados» de Facturación: qué documentos ya se fueron a buscar
// al sistema copiando su ID interno. Se apaga la fila y se tacha el chip: es lo
// que permite recorrer una lista de 157 documentos sin perder el hilo de cuáles
// ya se buscaron.
//
// La clave es UNA para todas las colas, a propósito: la marca es del DOCUMENTO,
// no de la lista donde se lo encontró (pedido del usuario, 2026-07-31). Vivía
// escrita dentro de `FacturacionView`; se mudó acá (2026-10-15) para que la app
// la use igual — Anuladas, Pendiente MH y Observaciones en las dos puntas.
//
// El almacén es el del dispositivo (`@plataforma/almacen`): en la web el
// `localStorage` de siempre, con la misma clave, así que lo que un navegador ya
// tenía marcado se sigue leyendo; en la app, el suyo. Las marcas NO viajan
// entre dispositivos: son una ayuda de quien está recorriendo la lista.
import { useCallback, useState } from 'react';
import * as almacen from '@plataforma/almacen';

export const VISITED_KEY = 'facturacion_visited';

function leerVisitados() {
    try { return new Set(JSON.parse(almacen.leer(VISITED_KEY) || '[]')); }
    catch { return new Set(); }
}

export function useVisitados() {
    const [visitedIds, setVisitedIds] = useState(leerVisitados);

    const toggleVisited = useCallback((erpId) => {
        if (!erpId) return;
        setVisitedIds(prev => {
            const next = new Set(prev);
            const key = String(erpId);
            if (next.has(key)) next.delete(key); else next.add(key);
            try { almacen.guardar(VISITED_KEY, JSON.stringify([...next])); } catch { /* almacén no disponible (privado/cuota) */ }
            return next;
        });
    }, []);

    const clearVisited = useCallback(() => {
        setVisitedIds(new Set());
        try { almacen.borrar(VISITED_KEY); } catch { /* almacén no disponible (privado/cuota) */ }
    }, []);

    return { visitedIds, toggleVisited, clearVisited };
}

export default useVisitados;
