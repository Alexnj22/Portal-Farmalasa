// Pintar de a tramos una lista que ya llegó entera (el servidor la devuelve de
// una vez, con su propio tope): trescientas tarjetas de vidrio montadas juntas
// traban el primer cuadro en un teléfono viejo; cuarenta, no. Al acercarse al
// final pinta el siguiente tramo solo, con el mismo gatillo que el resto de la
// app (`useMasAlFinal` de `ListaPaginada`). `reinicio` vuelve al primer tramo
// cuando cambia el filtro.
import { useEffect, useState } from 'react';
import { useMasAlFinal } from './ListaPaginada';

export function useEnTramos(lista, tramo = 40, reinicio) {
  const [n, setN] = useState(tramo);
  useEffect(() => { setN(tramo); }, [reinicio, tramo]); // eslint-disable-line react-hooks/set-state-in-effect -- volver al primer tramo al cambiar el filtro
  const total = lista?.length ?? 0;
  const scroll = useMasAlFinal(() => setN((x) => x + tramo), n < total);
  return { visibles: (lista || []).slice(0, n), quedan: Math.max(0, total - n), scroll };
}
