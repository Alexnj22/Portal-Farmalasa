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
import { fetchEncargos, mensajeDeEncargo, prorrogarEncargo, registrarAvisoDeReserva, responderEncargo, whatsappDe } from '@nucleo/data/reservas';
import { ROTULOS_DE_ENCARGO as ROT, encargoSinVincular, encargoVencido, estadoDeEncargo, notaDeEncargo, pilaDelCliente } from '@nucleo/utils/reservasDeSala';
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
  // Desde el reglamento v2 el aviso por WhatsApp queda anotado (cláusula 9).
  const whatsapp = (e) => {
    Linking.openURL(`https://wa.me/${whatsappDe(e.telefono)}?text=${encodeURIComponent(mensajeDeEncargo(e))}`)
      .catch((err) => console.warn(`Encargos: no se abrió WhatsApp para el encargo ${e.codigo}`, err));
    if (e.registrar_llamada) {
      registrarAvisoDeReserva({ encargo: e.id, canal: 'whatsapp' }).then(cargar)
        .catch((err) => console.warn(`Encargos: no se anotó el aviso por WhatsApp del encargo ${e.codigo}`, err));
    }
  };
  const llamar = (e) => router.push({ pathname: '/reserva-llamada', params: {
    encargo: String(e.id), codigo: e.codigo, cliente: pilaDelCliente(e), telefono: String(e.telefono ?? '') } });

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
            {(sinVincular && e.sugerido) || vencido || e.nivel?.prioridad ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {e.nivel?.prioridad ? <Pildora texto={`Cliente ${e.nivel.nombre}`} color={MARCA.azulClaro} /> : null}
                {sinVincular && e.sugerido ? <Pildora texto={`¿Ya está en el catálogo? «${e.sugerido}»`} color={MARCA.azulClaro} /> : null}
                {vencido ? <Pildora texto="Sin retirar · llamar" color={MARCA.ambar} /> : null}
              </View>
            ) : null}
            {notaDeEncargo(e) ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{notaDeEncargo(e)}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {!soloLectura && !e.reserva && !e.tiene_app && ['confirmado', 'listo'].includes(e.estado) && whatsappDe(e.telefono)
                ? <Accion texto={ROT.whatsapp} onPress={() => whatsapp(e)} /> : null}
              {e.foto_url ? <Accion texto={ROT.foto} onPress={() => openStoredFile(e.foto_url).catch((err) => fallo('No se pudo abrir la foto', err?.message ?? ''))} /> : null}
              {!soloLectura && e.estado === 'solicitado' ? (
                <>
                  <Accion texto={ROT.confirmar} color={MARCA.verde} onPress={() => abrir(e, 'confirmar')} />
                  <Accion texto={ROT.rechazar} color={MARCA.rojo} onPress={() => abrir(e, 'rechazar')} />
                </>
              ) : null}
              {!soloLectura && sinVincular ? <Accion texto={ROT.vincular} onPress={() => abrir(e, 'vincular')} /> : null}
              {!soloLectura && e.estado === 'aceptado' ? <Accion texto={ROT.pedido} deshabilitado={!!ocupado}
                onPress={() => mover(e, 'pedido', 'Marcar como pedido', `${e.codigo} · ${e.cantidad} × ${e.producto} ya se pidió.`)} /> : null}
              {!soloLectura && (e.estado === 'aceptado' || e.estado === 'pedido') ? <Accion texto={ROT.llego} color={MARCA.verde} deshabilitado={!!ocupado || sinVincular}
                onPress={() => mover(e, 'listo', 'Marcar que llegó', `${e.codigo} · ${e.cantidad} × ${e.producto} ya está en la sala.`)} /> : null}
              {!soloLectura && sinVincular && (e.estado === 'aceptado' || e.estado === 'pedido')
                ? <Text style={{ color: colorSistema.texto2, fontSize: 12, alignSelf: 'center' }}>Primero vincula el producto ya creado en el catálogo.</Text> : null}
              {!soloLectura && e.estado === 'listo' ? <Accion texto={ROT.entregar} color={MARCA.verde}
                onPress={() => router.push({ pathname: '/reserva-retirar', params: { id: String(e.id), tipo: 'encargo', sala: String(e.branch_id ?? branchId) } })} /> : null}
              {!soloLectura && e.registrar_llamada ? <Accion texto={ROT.llamada} onPress={() => llamar(e)} /> : null}
              {!soloLectura && e.puede_cambiar_fecha ? <Accion texto={ROT.fecha} onPress={() => abrir(e, 'fecha')} /> : null}
              {!soloLectura && e.puede_no_entrego ? <Accion texto={ROT.no_entrego} color={MARCA.rojo} onPress={() => abrir(e, 'no_entrego')} /> : null}
              {!soloLectura && e.estado === 'listo' && (e.prorrogable ?? !e.prorrogado_at) ? <Accion texto={ROT.prorrogar} deshabilitado={!!ocupado}
                onPress={() => mover(e, 'prorrogar', 'Prorrogar el plazo', 'Una sola prórroga de 7 días para retirarlo. No admite otra.')} /> : null}
              {!soloLectura && !e.reserva && e.pago_estado === 'pagado' && ['aceptado', 'pedido', 'listo'].includes(e.estado)
                ? <Accion texto={ROT.saldo} onPress={() => abrir(e, 'saldo')} /> : null}
            </View>
          </View>
        );
      })}
    </Seccion>
  );
}
