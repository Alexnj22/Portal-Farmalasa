// ¿Se puede pagar en línea? (2026-11-11). Mientras n1co no tenga su llave
// cargada (`pasarelaLista()` en `_shared/n1co.ts`), la app NO muestra ningún
// botón de pagar en línea —carrito, reservas, pedidos, encargos ni créditos—:
// un «Próximamente» o un botón que contesta «en preparación» es motivo de
// rechazo en la revisión de las tiendas (guía 2.1 de Apple). El día que se
// cargue la llave, los botones aparecen solos, sin publicar nada.
//
// Falla cerrado: hasta que el servidor diga que sí, no hay botón.
import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
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

/**
 * Abre el cobro y espera a que la persona vuelva (2026-11-14). En el teléfono
 * es la hoja del navegador del sistema (`openAuthSessionAsync`), que se cierra
 * sola al volver a `regreso`.
 *
 * En el NAVEGADOR esa hoja es una ventana emergente, y Safari la bloquea si se
 * abre después de esperar al servidor (el toque ya «pasó»): el cobro no abría
 * y en el carrito ni siquiera se avisaba. Si el navegador no la deja abrir,
 * se pide un toque más («Ir a pagar»), que sí puede abrirla. Se espera a que
 * esa pestaña se cierre (o a que la persona vuelva a esta) para seguir: lo que
 * viene después —verificar el pago con el servidor— es lo mismo en los dos.
 */
export async function abrirPago(url, regreso) {
  if (Platform.OS !== 'web') return WebBrowser.openAuthSessionAsync(url, regreso);
  let ventana = window.open(url, '_blank');
  if (!ventana) {
    ventana = await new Promise((listo) => {
      Alert.alert('Tu pago está listo', 'Toca «Ir a pagar» para abrir el cobro en otra pestaña.', [
        { text: 'Cancelar', style: 'cancel', onPress: () => listo(null) },
        { text: 'Ir a pagar', onPress: () => listo(window.open(url, '_blank')) },
      ]);
    });
    if (!ventana) throw new Error('sin ventana');
  }
  await new Promise((listo) => {
    const fin = () => { clearInterval(reloj); document.removeEventListener('visibilitychange', alVolver); listo(); };
    // Volver a esta pestaña con la otra todavía abierta también cuenta: en el
    // iPhone las pestañas no se «cierran» solas al terminar el cobro.
    const alVolver = () => { if (document.visibilityState === 'visible') setTimeout(fin, 800); };
    const reloj = setInterval(() => { if (ventana.closed) fin(); }, 1000);
    document.addEventListener('visibilitychange', alVolver);
  });
  return { type: 'dismiss' };
}
