// Responder un encargo, NATIVO (2026-10-22) — gemela de los diálogos de
// `WidgetEncargos` del portal. `modo`:
//   · `confirmar`: precio por unidad, para cuándo llega y una nota; el cliente
//     paga el 100 % por adelantado. Un producto raro y no devolvible pide el
//     visto bueno del gerente (`encargoConRiesgo`);
//   · `rechazar`: no se puede conseguir — el motivo es lo que se le dice al
//     cliente, y es obligatorio para un producto que no tenemos;
//   · `saldo`: el cliente no lo retira o desiste: lo pagado queda a su favor
//     60 días y el producto queda para la venta. No se deshace;
//   · `vincular`: Bodega ya creó el producto nuevo y llegó al catálogo; sin
//     amarrarlo no se puede marcar «Llegó». La base sugiere uno si lo encontró;
//   · `fecha` (reglamento v2, 4.4): Compras cambia la fecha estimada y la base
//     le avisa al cliente;
//   · `no_entrego` (reglamento v2, 4.6): el proveedor no entregó y el CLIENTE
//     elige la devolución completa (se PIDE: administración la autoriza o la
//     niega, cláusula 8.3) o aplicarlo a otro producto (saldo a favor). Los dos los habilita la base
//     (`puede_cambiar_fecha`, `puede_no_entrego`) sólo desde la fecha.
// El encargo se relee con `fetchEncargos` (la misma lista de la sala).
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { cambiarFechaDeEncargo, fetchEncargos, pasarEncargoASaldo, proveedorNoEntregoEncargo, responderEncargo, vincularProductoDeEncargo } from '@nucleo/data/reservas';
import { useReglasDeReserva } from '@nucleo/hooks/useReglasDeReserva';
import { vigenciaDelSaldo } from '@nucleo/utils/abonoTicket';
import { ROTULOS_DE_ENCARGO as ROT, encargoConRiesgo, fichaDeProductoNuevo } from '@nucleo/utils/reservasDeSala';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import BuscadorProducto from '../componentes/compras/BuscadorProducto';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { Enlace } from '../componentes/reservas/piezas';

const dinero = (v) => v.replace(/[^\d.,]/g, '').replace(',', '.');
// Los mismos rótulos que el botón que abre la pantalla (y que el portal).
const TITULO = { confirmar: ROT.confirmar, rechazar: ROT.rechazar, saldo: ROT.saldo, vincular: ROT.vincular, fecha: 'Nueva fecha', no_entrego: ROT.no_entrego };

export default function EncargoAccion() {
  const { id, modo = 'confirmar', sala } = useLocalSearchParams();
  const [e, setE] = useState(null);
  const [error, setError] = useState('');
  const [precio, setPrecio] = useState('');
  const [fecha, setFecha] = useState(() => sumarDias(hoySV(), 3));
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [eleccion, setEleccion] = useState('devolucion');
  const reglas = useReglasDeReserva();

  useEffect(() => {
    let vivo = true;
    fetchEncargos(sala ? Number(sala) : null, true).then((filas) => {
      if (!vivo) return;
      const f = (filas || []).find((x) => String(x.id) === String(id));
      if (f) setE(f); else setError('Ese encargo ya no está abierto.');
    }).catch((err) => { if (vivo) setError(mensajeAmigable(err, 'No se pudo cargar el encargo.')); });
    return () => { vivo = false; };
  }, [id, sala]);

  const hacer = async (fn, titulo, detalle) => {
    setOcupado(true); trabajando('Guardando…');
    try {
      const r = await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(titulo, typeof detalle === 'function' ? detalle(r) : detalle);
      router.back();
    } catch (err) { fallo('No se pudo', mensajeAmigable(err, 'Intenta de nuevo.')); } finally { setOcupado(false); }
  };

  if (!e) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: TITULO[modo] ?? 'Encargo' }} />
        <View style={{ padding: 16 }}>{error ? <Aviso tono="cuidado" texto={error} /> : <ActivityIndicator />}</View>
      </>
    );
  }

  const p = Number(precio);
  const ficha = e.producto_nuevo ? (
    <Seccion titulo="Producto que no está en el catálogo">
      <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{fichaDeProductoNuevo(e)}</Text>
      {e.foto_url ? <Enlace texto="Ver la foto" onPress={() => openStoredFile(e.foto_url).catch((err) => fallo('No se pudo abrir la foto', err?.message ?? ''))} /> : null}
    </Seccion>
  ) : null;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `${TITULO[modo] ?? 'Encargo'} ${e.codigo}` }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700', marginHorizontal: 4 }}>
            {`${e.cantidad} × ${e.producto}${e.nota_cliente ? ` · «${e.nota_cliente}»` : ''}`}
          </Text>
          {ficha}

          {modo === 'confirmar' ? (
            <>
              {encargoConRiesgo(e) ? (
                <Aviso tono="cuidado" texto={`${!e.devolutivo ? 'No se puede devolver al proveedor. ' : ''}${!e.vendido_antes ? 'Nunca se ha vendido en ninguna sucursal. ' : ''}Si es caro, confírmalo con el gerente antes de aceptar.`} />
              ) : null}
              <Seccion titulo="Precio por unidad" pie={p > 0 ? `El cliente paga ${formatMoney(p * e.cantidad)} por adelantado (100 %).` : undefined}>
                <Campo multiline={false} value={precio} keyboardType="decimal-pad" onChangeText={(v) => setPrecio(dinero(v))} placeholder="0.00" style={{ textAlign: 'center', fontWeight: '700' }} />
              </Seccion>
              <Seccion titulo="Llega aproximadamente">
                <Fecha valor={fecha} onCambiar={setFecha} desde={hoySV()} />
              </Seccion>
              <Seccion titulo="Nota para el cliente (opcional)">
                <Campo value={nota} onChangeText={setNota} maxLength={300} />
              </Seccion>
              <BotonGrande texto={ocupado ? 'Guardando…' : 'Confirmar y avisar'} color={MARCA.verde} deshabilitado={ocupado || !(p > 0) || !fecha || fecha < hoySV()}
                onPress={() => hacer(() => responderEncargo(e.id, 'confirmar', { precio: p, fecha, nota: nota.trim() || null }),
                  'Encargo confirmado', 'La sala recibe el aviso para confirmarlo con el cliente.')} />
            </>
          ) : null}

          {modo === 'rechazar' ? (
            <>
              <Seccion titulo="Motivo para el cliente">
                <Campo value={nota} onChangeText={setNota} maxLength={300} placeholder="Ej. El proveedor no lo tiene; te recomendamos …" />
              </Seccion>
              <BotonGrande texto={ocupado ? 'Guardando…' : 'Avisar al cliente'} color={MARCA.rojo}
                deshabilitado={ocupado || (e.producto_nuevo && !nota.trim())}
                onPress={() => hacer(() => responderEncargo(e.id, 'rechazar', { nota: nota.trim() || null }), 'Encargo cerrado', 'Se le avisa al cliente que no se puede conseguir.')} />
            </>
          ) : null}

          {modo === 'saldo' ? (
            <>
              <Aviso texto={`Lo pagado (${formatMoney(Number(e.anticipo ?? 0))}) queda a favor del cliente por ${vigenciaDelSaldo(reglas)}, para cualquier compra en cualquier sala. El producto queda para la venta. No se deshace.`} />
              <Seccion titulo="Motivo">
                <Campo value={nota} onChangeText={setNota} maxLength={300} placeholder="Ej. Se le llamó dos veces y no contestó / dijo que ya no lo necesita" />
              </Seccion>
              <BotonGrande texto={ocupado ? 'Guardando…' : 'Pasar a saldo a favor'} color={MARCA.azulClaro} deshabilitado={ocupado || nota.trim().length < 3}
                onPress={() => hacer(() => pasarEncargoASaldo(e.id, nota.trim()), 'Quedó como saldo a favor',
                  (r) => `${formatMoney(r?.saldo)} a favor del cliente (${r?.reserva ?? ''}). El producto queda para la venta.`)} />
            </>
          ) : null}

          {modo === 'fecha' ? (
            <>
              <Seccion titulo="Llega aproximadamente" pie={e.fecha_estimada ? `Hoy dice ${e.fecha_estimada}. El cliente recibe el aviso en la app.` : 'El cliente recibe el aviso en la app.'}>
                <Fecha valor={fecha} onCambiar={setFecha} desde={hoySV()} />
              </Seccion>
              <Seccion titulo="Motivo para el cliente (opcional)">
                <Campo value={nota} onChangeText={setNota} maxLength={200} placeholder="Ej. El proveedor atrasó el envío" />
              </Seccion>
              <BotonGrande texto={ocupado ? 'Guardando…' : 'Cambiar y avisar'} color={MARCA.azulClaro}
                deshabilitado={ocupado || !fecha || fecha < hoySV() || fecha === e.fecha_estimada}
                onPress={() => hacer(() => cambiarFechaDeEncargo(e.id, fecha, nota.trim() || null), 'Fecha cambiada', 'El cliente recibe el aviso en la app.')} />
            </>
          ) : null}

          {modo === 'no_entrego' ? (
            <>
              <Seccion titulo="Qué eligió el cliente">
                <Opciones valor={eleccion} onCambiar={setEleccion} opciones={[
                  { id: 'devolucion', label: 'Devolución completa', detalle: `Se pide devolver ${formatMoney(Number(e.anticipo ?? 0))} en efectivo; administración la autoriza o la niega` },
                  { id: 'saldo', label: 'Otro producto', detalle: `Por ${vigenciaDelSaldo(reglas)}, para otro producto en cualquier sucursal` },
                ]} />
              </Seccion>
              <Seccion titulo="Nota (opcional)">
                <Campo value={nota} onChangeText={setNota} maxLength={200} placeholder="Ej. El proveedor lo descontinuó" />
              </Seccion>
              <Aviso tono="cuidado" texto={eleccion === 'devolucion' ? 'Mientras se autoriza, lo pagado queda a su favor.' : 'No se deshace.'} />
              <BotonGrande texto={ocupado ? 'Guardando…' : eleccion === 'devolucion' ? 'Pedir la devolución' : 'Dejar a su favor'}
                color={eleccion === 'devolucion' ? MARCA.rojo : MARCA.verde} deshabilitado={ocupado}
                onPress={() => hacer(() => proveedorNoEntregoEncargo(e.id, eleccion, nota.trim() || null),
                  eleccion === 'devolucion' ? 'Devolución pedida' : 'Quedó como saldo a favor',
                  (r) => (eleccion === 'devolucion'
                    ? `${formatMoney(r?.monto)} por autorizar (${r?.reserva ?? ''}). Cuando la autoricen, se entrega desde Reservas.`
                    : `${formatMoney(r?.monto)} a favor del cliente (${r?.reserva ?? ''}).`))} />
            </>
          ) : null}

          {modo === 'vincular' ? (
            <>
              {e.sugerido ? (
                <Seccion titulo="Parece que ya entró como">
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{e.sugerido}</Text>
                  <BotonGrande texto="Es éste" color={MARCA.verde} deshabilitado={ocupado}
                    onPress={() => hacer(() => vincularProductoDeEncargo(e.id, e.sugerido_product_id), 'Producto vinculado', `${e.codigo} → ${e.sugerido}`)} />
                </Seccion>
              ) : null}
              <Seccion titulo={`El producto que se creó para «${e.producto}»`}>
                {ocupado ? <ActivityIndicator /> : (
                  <BuscadorProducto onElegir={(prod) => hacer(() => vincularProductoDeEncargo(e.id, prod.id), 'Producto vinculado', `${e.codigo} → ${prod.nombre}`)}
                    onCancelar={() => router.back()} />
                )}
              </Seccion>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
