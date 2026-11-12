// ¿Se puede pagar en línea? (2026-11-11). Mientras n1co no tenga su llave
// cargada (`pasarelaLista()` en `_shared/n1co.ts`), la app NO muestra ningún
// botón de pagar en línea —carrito, reservas, pedidos, encargos ni créditos—:
// un «Próximamente» o un botón que contesta «en preparación» es motivo de
// rechazo en la revisión de las tiendas (guía 2.1 de Apple). El día que se
// cargue la llave, los botones aparecen solos, sin publicar nada.
//
// Falla cerrado: hasta que el servidor diga que sí, no hay botón.
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSesion } from './sesion';

let ultimo = false;

export function usePagoEnLinea() {
  const pedir = useSesion((s) => s.pedir);
  const token = useSesion((s) => s.token);
  const [listo, setListo] = useState(ultimo);
  useFocusEffect(useCallback(() => {
    if (!token) return;
    pedir('pago_preparar')
      .then((r) => { ultimo = r?.ok === true; setListo(ultimo); })
      .catch(() => {});
  }, [token, pedir]));
  return listo;
}
