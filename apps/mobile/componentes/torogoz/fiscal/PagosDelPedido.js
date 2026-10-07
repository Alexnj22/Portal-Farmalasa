// Las formas de pago de un pedido y sus comprobantes —el `PagosDelPedido` del
// portal—, para verlos y para adjuntar DESPUÉS el que faltó al vender. La forma
// y el monto ya no se tocan si el pedido está facturado (están en el
// documento): sólo el comprobante. Se sube al mismo bucket privado y a la misma
// carpeta que desde el portal (`dist-comprobantes/distribucion/<pedido>`).
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useStaffStore } from '@nucleo/store/staffStore';
import { adjuntarComprobante, fetchPagos, LLEVA_COMPROBANTE, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { nombreFormaPago, VERIFICACION_PAGO } from '@nucleo/utils/distribucionFacturacion';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { colorSistema } from '../../Formulario';
import { Aviso, Seccion } from '../../formulario/Piezas';
import { subirFotos } from '../../formulario/Fotos';
import { ACCIONES_DE_DINERO } from '../soloConsulta';
import { Pildora } from '../../avisos/Piezas';
import { colorDeVariante } from '../../colorDeVariante';
import { fallo, listo, trabajando } from '../../Progreso';
import ComprobantePago from './ComprobantePago';

const PETROLEO = '#0f6e7d';

function Enlace({ texto, onPress, deshabilitado }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button" hitSlop={6}
      style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', opacity: deshabilitado ? 0.4 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: PETROLEO, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function PagosDelPedido({ pedidoId, puedeEditar, onCambio }) {
  const [pagos, setPagos] = useState(null);
  const [error, setError] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    fetchPagos(pedidoId).then(setPagos).catch((e) => setError(mensajeDeDistribucion(e)));
  }, [pedidoId]);
  useEffect(() => { cargar(); }, [cargar]);

  const adjuntar = async (pago, r) => {
    setGuardando(true); trabajando('Guardando el comprobante…');
    try {
      const [url] = await subirFotos([r.foto], { bucket: 'dist-comprobantes', carpeta: `distribucion/${pedidoId}` });
      await adjuntarComprobante(pago.id, { url, lectura: r.lectura, montoLeido: r.montoLeido, verificacion: r.verificacion, nota: r.nota });
      useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_COMPROBANTE', String(pago.id), { verificacion: r.verificacion, pedido: pedidoId, via: 'app' });
      listo('Comprobante guardado', r.verificacion === 'diferencia_aceptada' ? 'Quedó anotada la diferencia.' : '');
      setAbierto(null);
      cargar();
      onCambio?.();
    } catch (e) {
      fallo('No se pudo guardar el comprobante', mensajeDeDistribucion(e));
    } finally { setGuardando(false); }
  };

  if (error) return <Aviso tono="freno" texto={error} />;
  if (!pagos?.length) return null;

  return (
    <Seccion titulo="Pagos">
      {pagos.map((p, i) => {
        const v = LLEVA_COMPROBANTE.has(p.forma) ? (VERIFICACION_PAGO[p.verificacion] ?? VERIFICACION_PAGO.pendiente) : null;
        return (
          <View key={p.id} style={{ gap: 6, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{`${nombreFormaPago(p.forma)}${p.referencia ? ` · ${p.referencia}` : ''}`}</Text>
                {p.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{p.nota}</Text> : null}
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{p.monto != null ? formatMoney(p.monto) : 'El resto'}</Text>
            </View>
            {v ? <Pildora texto={v.label} color={colorDeVariante(v.variant)} /> : null}
            {v ? (
              <View style={{ flexDirection: 'row', gap: 18 }}>
                {p.comprobante_url ? <Enlace texto="Ver comprobante" onPress={() => openStoredFile(p.comprobante_url).catch((e) => fallo('No se pudo abrir', e?.message ?? ''))} /> : null}
                {/* Adjuntar marca la verificación del pago: sólo consulta → en el portal. */}
                {puedeEditar && ACCIONES_DE_DINERO && abierto !== p.id ? <Enlace texto={p.comprobante_url ? 'Cambiar comprobante' : 'Adjuntar comprobante'} deshabilitado={guardando} onPress={() => setAbierto(p.id)} /> : null}
              </View>
            ) : null}
            {abierto === p.id ? (
              <ComprobantePago forma={p.forma} montoEsperado={p.monto} puedeCambiarMonto={false}
                onListo={(r) => adjuntar(p, r)} onCancelar={() => setAbierto(null)} />
            ) : null}
          </View>
        );
      })}
    </Seccion>
  );
}
