// Encargos de la sala, NATIVO — gemela de `WidgetEncargos` del portal: lo que
// no hay en la red y Compras o Bodega consigue. Lo ven la sala del retiro y
// Bodega (`branchId` null = todos). Se confirma con precio y fecha (o se dice
// que no se puede), se marca pedido, llegó y entregado; un producto que no
// tenemos se vincula al catálogo cuando Bodega lo crea. Lo que llegó se retira
// en 7 días con UNA prórroga; si no se retira, lo pagado pasa a saldo a favor.
// A quien no tiene la app se le avisa por WhatsApp desde aquí.
// El estado y las reglas salen del núcleo (`reservasDeSala`).
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchEncargos, mensajeDeEncargo, prorrogarEncargo, responderEncargo, whatsappDe } from '@nucleo/data/reservas';
import { encargoSinVincular, encargoVencido, estadoDeEncargo, pilaDelCliente } from '@nucleo/utils/reservasDeSala';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { colorSistema } from '../Formulario';
import { Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';
import { Accion, colorDeTono } from './piezas';

const corta = (d) => fechaTexto(d, { day: 'numeric', month: 'short' });

export default function Encargos({ branchId = null, soloLectura = false, recarga = 0 }) {
  const [filas, setFilas] = useState(null);
  const [ocupado, setOcupado] = useState(null);

  const cargar = useCallback(async () => {
    try { setFilas(await fetchEncargos(branchId, true)); } catch { setFilas((f) => f ?? []); }
  }, [branchId]);
  useEffect(() => { const t = setInterval(cargar, 120_000); return () => clearInterval(t); }, [cargar]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  // `recarga` cambia al tirar la lista hacia abajo: se relee también.
  useEffect(() => { if (recarga) cargar(); }, [recarga, cargar]);

  const mover = (e, accion, titulo, texto) => {
    Alert.alert(titulo, texto, [
      { text: 'Volver', style: 'cancel' },
      { text: 'Sí', onPress: async () => {
        setOcupado(e.id);
        try {
          if (accion === 'prorrogar') {
            const r = await prorrogarEncargo(e.id);
            listo('Plazo prorrogado', `Puede retirarlo hasta el ${fechaTexto(r?.retirar_hasta, { day: 'numeric', month: 'long' })}. No admite otra prórroga.`);
          } else {
            await responderEncargo(e.id, accion);
            listo('Encargo actualizado', '');
          }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          cargar();
        } catch (err) { fallo('No se pudo actualizar', mensajeAmigable(err, 'Intenta de nuevo.')); } finally { setOcupado(null); }
      } },
    ]);
  };
  const abrir = (e, modo) => router.push({ pathname: '/encargo-accion', params: { id: String(e.id), modo, sala: branchId == null ? '' : String(branchId) } });
  const whatsapp = (e) => Linking.openURL(`https://wa.me/${whatsappDe(e.telefono)}?text=${encodeURIComponent(mensajeDeEncargo(e))}`).catch(() => {});

  if (!filas?.length) return null;
  const hoy = hoySV();
  return (
    <Seccion titulo={`Encargos · ${filas.length}`} pie="Lo que no hay en la red: Compras lo consigue y confirma el precio.">
      {filas.map((e, i) => {
        const est = estadoDeEncargo(e);
        const sinVincular = encargoSinVincular(e);
        const vencido = encargoVencido(e, hoy);
        return (
          <View key={e.id} style={{ gap: 6, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: ocupado === e.id ? 0.5 : 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>
                {`${e.cantidad} × ${e.producto}${e.producto_nuevo ? (e.product_id ? ` → ${e.producto_catalogo ?? 'vinculado'}` : ' · producto nuevo') : ''}`}
              </Text>
              <Pildora texto={est.texto} color={colorDeTono(est.tono)} />
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {`${e.codigo}${e.reserva ? ` · resto de ${e.reserva}` : ''} · ${pilaDelCliente(e)} · retira en ${e.sala}${e.fecha_estimada ? ` · llega ${corta(e.fecha_estimada)}` : ''}${e.anticipo ? ` · ${formatMoney(Number(e.anticipo))}` : ''}${e.retirar_hasta ? ` · retira hasta ${corta(e.retirar_hasta)}${e.prorrogado_at ? ' (prorrogado)' : ''}` : ''}`}
            </Text>
            {(sinVincular && e.sugerido) || vencido ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {sinVincular && e.sugerido ? <Pildora texto={`¿Ya está en el catálogo? «${e.sugerido}»`} color={MARCA.azulClaro} /> : null}
                {vencido ? <Pildora texto="Sin retirar · llamar" color={MARCA.ambar} /> : null}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {!soloLectura && !e.reserva && !e.tiene_app && ['confirmado', 'listo'].includes(e.estado) && whatsappDe(e.telefono)
                ? <Accion texto="WhatsApp" onPress={() => whatsapp(e)} /> : null}
              {e.foto_url ? <Accion texto="Ver la foto" onPress={() => openStoredFile(e.foto_url).catch((err) => fallo('No se pudo abrir la foto', err?.message ?? ''))} /> : null}
              {!soloLectura && e.estado === 'solicitado' ? (
                <>
                  <Accion texto="Confirmar" color={MARCA.verde} onPress={() => abrir(e, 'confirmar')} />
                  <Accion texto="No se consigue" color={MARCA.rojo} onPress={() => abrir(e, 'rechazar')} />
                </>
              ) : null}
              {!soloLectura && sinVincular ? <Accion texto="Vincular producto" onPress={() => abrir(e, 'vincular')} /> : null}
              {!soloLectura && e.estado === 'aceptado' ? <Accion texto="Pedido" deshabilitado={!!ocupado}
                onPress={() => mover(e, 'pedido', 'Marcar como pedido', `${e.codigo} · ${e.cantidad} × ${e.producto} ya se pidió.`)} /> : null}
              {!soloLectura && (e.estado === 'aceptado' || e.estado === 'pedido') ? <Accion texto="Llegó" color={MARCA.verde} deshabilitado={!!ocupado || sinVincular}
                onPress={() => mover(e, 'listo', 'Marcar que llegó', `${e.codigo} · ${e.cantidad} × ${e.producto} ya está en la sala.`)} /> : null}
              {!soloLectura && sinVincular && (e.estado === 'aceptado' || e.estado === 'pedido')
                ? <Text style={{ color: colorSistema.texto2, fontSize: 12, alignSelf: 'center' }}>Primero vincula el producto ya creado en el catálogo.</Text> : null}
              {!soloLectura && e.estado === 'listo' ? <Accion texto="Entregar" color={MARCA.verde}
                onPress={() => router.push({ pathname: '/reserva-retirar', params: { id: String(e.id), tipo: 'encargo', sala: String(e.branch_id ?? branchId) } })} /> : null}
              {!soloLectura && e.estado === 'listo' && !e.prorrogado_at ? <Accion texto="Prorrogar" deshabilitado={!!ocupado}
                onPress={() => mover(e, 'prorrogar', 'Prorrogar el plazo', 'Una sola prórroga de 7 días para retirarlo. No admite otra.')} /> : null}
              {!soloLectura && !e.reserva && e.pago_estado === 'pagado' && ['aceptado', 'pedido', 'listo'].includes(e.estado)
                ? <Accion texto="A saldo a favor" onPress={() => abrir(e, 'saldo')} /> : null}
            </View>
          </View>
        );
      })}
    </Seccion>
  );
}
