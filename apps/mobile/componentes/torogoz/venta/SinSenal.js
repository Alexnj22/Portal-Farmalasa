// Ventas SIN SEÑAL en el teléfono: la cola que vive en el núcleo
// (`data/distribucionSinSenal.js`, la misma del portal) y el aviso para verla
// y mandarla.
//
// En el navegador la cola se vacía sola con el evento `online`. El teléfono no
// tiene ese evento (no hay módulo de red instalado), así que se intenta en los
// tres momentos en que puede haber vuelto la señal: al abrir la pantalla, al
// volver la app al frente y cuando la persona toca «Enviar ahora». Si sigue
// sin señal, la cola queda igual y no se marca ningún error (`esErrorDeRed`).
//
// ⚠️ Mandar la cola FACTURA en contingencia y avisa a Hacienda: es la misma
// acción que el portal hace solo, con la hora real de cada venta.
//
// `BandaSinSenal` es el aviso del MARCO de Torogoz en el portal
// (`TorogozLayout`): «N ventas sin señal» con «Enviar» en cada pantalla de la
// distribuidora, no sólo dentro de la venta. Como la pila deja montadas varias
// pantallas a la vez, el freno contra dos envíos simultáneos es del MÓDULO
// (`enviandoAhora`) y no de cada instancia: mandar dos veces la misma cola
// facturaría dos veces.
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { escuchar } from '@plataforma/eventos';
import { ventasSinSenal, enviarVentasSinSenal, EVENTO_SIN_SENAL } from '@nucleo/data/distribucionSinSenal';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import Vidrio from '../../Vidrio';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../../inicio/marca';
import { fallo, listo } from '../../Progreso';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../soloConsulta';

let enviandoAhora = false;

export function useColaSinSenal({ automatico = true } = {}) {
  const [lista, setLista] = useState(ventasSinSenal);
  const [enviando, setEnviando] = useState(false);
  const enviar = useCallback(async ({ avisar = false } = {}) => {
    if (enviandoAhora || !ventasSinSenal().length) return null;
    enviandoAhora = true;
    setEnviando(true);
    try {
      const r = await enviarVentasSinSenal();
      if (r.facturadas) listo(`${r.facturadas} venta${r.facturadas === 1 ? '' : 's'} sin señal facturada${r.facturadas === 1 ? '' : 's'}`, 'En contingencia, con la hora de la venta.');
      if (r.aviso) fallo('Falta el aviso de contingencia', `${r.aviso} Las ventas ya quedaron facturadas: el aviso sale desde Facturación.`);
      else if (r.errores) fallo('Una venta sin señal no entró', 'Revisa el motivo en la lista y vuelve a facturarla.');
      else if (avisar && !r.facturadas) fallo('Sigue sin señal', 'Las ventas quedan guardadas en el teléfono y se mandan solas al volver.');
      return r;
    } catch (e) {
      fallo('No se pudieron mandar', mensajeDeDistribucion(e));
      return null;
    } finally {
      enviandoAhora = false;
      setEnviando(false);
      setLista(ventasSinSenal());
    }
  }, []);

  useEffect(() => {
    const soltar = escuchar(EVENTO_SIN_SENAL, () => setLista(ventasSinSenal()));
    const sub = AppState.addEventListener('change', (e) => { if (e === 'active' && automatico) enviar(); });
    if (automatico) enviar();
    return () => { soltar(); sub.remove(); };
  }, [automatico, enviar]);

  return { lista, enviando, enviar };
}

/** El aviso de la cola: cuántas hay, de quién y el botón para mandarlas. */
export function AvisoSinSenal({ lista, enviando, onEnviar }) {
  if (!lista.length) return null;
  return (
    <Vidrio radio={18}>
      <View style={{ padding: 14, gap: 8, backgroundColor: `${MARCA.ambar}1F` }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>
          {`${lista.length} venta${lista.length === 1 ? '' : 's'} sin señal por facturar`}
        </Text>
        {lista.slice(0, 5).map(v => (
          <View key={v.clientUuid} style={{ gap: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>
              {`${v.resumen?.cliente ?? 'Cliente'} · ${formatMoney(v.resumen?.total ?? 0)}`}
            </Text>
            <Text style={{ color: v.error ? MARCA.rojo : colorSistema.texto2, fontSize: 12 }} numberOfLines={2}>
              {v.error ? v.error : `${fechaHora12(v.emitido_at)} · código ${v.codigo_generacion.slice(0, 8)}…`}
            </Text>
          </View>
        ))}
        {/* Sin `onEnviar` (sólo consulta, soloConsulta.js) la app no las manda: sólo las muestra. */}
        {!onEnviar ? (
          <SeHaceEnElPortal texto="Por ahora la app no las envía. Avisa a quien administra: Hacienda da 72 horas desde la venta." />
        ) : null}
        {onEnviar ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Se facturan en contingencia al volver la señal. Hacienda da 72 horas desde la venta.</Text> : null}
        {onEnviar ? <Pressable onPress={() => onEnviar({ avisar: true })} disabled={enviando} accessibilityRole="button" hitSlop={6}
          style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', opacity: enviando ? 0.5 : pressed ? 0.6 : 1 })}>
          <Text style={{ color: colorSistema.acento, fontSize: 16, fontWeight: '700' }}>{enviando ? 'Enviando…' : 'Enviar ahora'}</Text>
        </Pressable> : null}
      </View>
    </Vidrio>
  );
}

/**
 * La franja del marco: una línea con cuántas hay y «Enviar» (detrás de
 * `ACCIONES_DE_DINERO`, como en la venta). Sin la acción, tocarla lleva a la
 * venta, donde se ve la lista. No pinta nada si la cola está vacía.
 */
export function BandaSinSenal({ automatico = false, style }) {
  const { lista, enviando, enviar } = useColaSinSenal({ automatico: automatico && ACCIONES_DE_DINERO });
  if (!lista.length) return null;
  const conError = lista.some((v) => v.error);
  return (
    <View style={style}>
      <Vidrio radio={16}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: `${conError ? MARCA.rojo : MARCA.ambar}1F` }}>
          <Pressable style={{ flex: 1, minHeight: 40, justifyContent: 'center' }} accessibilityRole="button" onPress={() => router.push('/torogoz/venta')}>
            <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
              <Text style={{ fontWeight: '800' }}>{`${lista.length} venta${lista.length === 1 ? '' : 's'} sin señal`}</Text>
              {conError ? ' · con error' : ' · se envían al volver la señal'}
            </Text>
          </Pressable>
          {ACCIONES_DE_DINERO ? (
            <Pressable onPress={() => enviar({ avisar: true })} disabled={enviando} accessibilityRole="button" hitSlop={6}
              style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', opacity: enviando ? 0.5 : pressed ? 0.6 : 1 })}>
              <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '700' }}>{enviando ? 'Enviando…' : 'Enviar'}</Text>
            </Pressable>
          ) : null}
        </View>
      </Vidrio>
    </View>
  );
}
