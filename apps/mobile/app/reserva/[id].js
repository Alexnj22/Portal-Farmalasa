// El detalle de una reserva, NATIVO (2026-10-22) — el `DetalleDeReserva` del
// portal: lo que la tarjeta de `reservas-sala` resume, entero. El cliente (con
// llamar y WhatsApp), TODOS los productos con su estado, traslado, encargo y
// oferta, el pago, las fechas y la receta.
//
// Desde la segunda vuelta (2026-10-22) también se TRABAJA desde acá: la
// tarjeta sólo lleva las dos acciones que importan y «Más» abre este detalle,
// con «Qué hacer» —todas las acciones, la primera como principal— y «Cancelar
// reserva» al pie. La lista sale del núcleo (`accionesDeReservaNucleo`) y el
// cómo de cada una del mismo hook que usa la lista (`useAccionesDeReserva`):
// dos lugares que hacen lo mismo con código propio terminan haciendo cosas
// distintas.
//
// Se abre con el id de cualquier renglón; si es de un pedido del carrito
// (P-XXXXXX) se muestra el pedido entero, igual que su tarjeta
// (`agruparPorPedido`). Lo que se dice sale del núcleo (`reservasDeSala`).
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { codigoDeReserva, fetchReservasDeSucursal, whatsappDe } from '@nucleo/data/reservas';
import {
  accionesDeReservaNucleo, agruparPorPedido, cuentasDeReserva, estadoDeReserva, formaDePagoLegible, recetaLegible, renglonesDe, reservasAbiertas, telefonoLegible, textoDeProrroga, TRASLADO_DE_RESERVA,
} from '@nucleo/utils/reservasDeSala';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { Accion, colorDeTono } from '../../componentes/reservas/piezas';
import { colorDeAccion } from '../../componentes/reservas/TarjetaDeReserva';
import { permisosDeReservas, useAccionesDeReserva } from '../../componentes/reservas/useAccionesDeReserva';

const cuando = (v) => fechaTexto(v, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const dia = (v) => fechaTexto(v, { weekday: 'short', day: 'numeric', month: 'short' });

function Cifra({ rotulo, valor, color = colorSistema.texto }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', minWidth: 0 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{rotulo}</Text>
      <Text style={{ color, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(valor)}</Text>
    </View>
  );
}

/** Los renglones «dato: valor» que tienen valor. */
function Datos({ filas }) {
  return filas.filter(Boolean).map(([k, v], i) => <Dato key={k} rotulo={k} valor={v} primero={i === 0} />);
}

export default function DetalleDeReserva() {
  const { id, sala, todas } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const permisos = permisosDeReservas(hasPermission);
  const branches = useStaffStore((s) => s.branches);
  const salaVista = todas === '1' ? null : sala;
  const nombreSala = (branches || []).find((b) => String(b.id) === String(salaVista))?.name || '';
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const filas = await fetchReservasDeSucursal(salaVista, true);
      const g = agruparPorPedido(reservasAbiertas(filas)).find((x) => renglonesDe(x).some((y) => String(y.id) === String(id)));
      if (!g) { setError('Esa reserva ya no está abierta.'); setR(null); return; }
      setError(''); setR(g);
    } catch (e) { setError(mensajeAmigable(e, 'No se pudo cargar la reserva.')); }
  }, [id, salaVista]);
  // Al volver de otra pantalla se relee (igual que la lista).
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const { ocupada, ejecutar } = useAccionesDeReserva({ sala: salaVista, nombreSala, verTodas: todas === '1', recargar: cargar });

  if (!r) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Reserva' }} />
        <View style={{ padding: 16 }}>{error ? <Aviso tono="cuidado" texto={error} /> : <ActivityIndicator />}</View>
      </>
    );
  }

  const filas = renglonesDe(r);
  const estado = estadoDeReserva(r);
  const { total, pagado, falta, pagadoTodo } = cuentasDeReserva(r);
  const codigo = r.pedido ?? codigoDeReserva(r.id);
  const tel = telefonoLegible(r.telefono);
  const wa = whatsappDe(r.telefono);
  const fiscal = r.documento === 'credito_fiscal' ? r.datos_fiscales : null;
  const acciones = accionesDeReservaNucleo(r, permisos);
  const mayores = acciones.filter((a) => !a.menor);
  const menores = acciones.filter((a) => a.menor);
  const fechas = [
    ['Creada', r.creada && cuando(r.creada)],
    ['Lista', r.lista_at && cuando(r.lista_at)],
    ['Retira hasta', r.estado === 'lista' && r.vence_at && `${dia(r.vence_at)}${textoDeProrroga(r)}`],
    ['Avisada', r.avisado_at && `${cuando(r.avisado_at)}${r.avisado_via === 'whatsapp' ? ' · por WhatsApp' : ''}`],
  ].filter(([, v]) => v);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: codigo }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <View style={{ gap: 6, marginHorizontal: 4 }}>
          <Pildora texto={estado.label} color={colorDeTono(estado.variant)} />
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
            {`${r.origen === 'app' ? 'Reservada desde la app' : 'Hecha en la sala'}${r.sala ? ` · ${r.sala}` : ''}`}
          </Text>
        </View>

        {mayores.length ? (
          <Seccion titulo="Qué hacer">
            {mayores.map((a, i) => (
              <BotonGrande key={a.k} texto={a.label} color={colorDeAccion(a)} borde={i > 0} deshabilitado={ocupada === r.id}
                onPress={() => ejecutar(r, a)} />
            ))}
          </Seccion>
        ) : null}

        <Seccion titulo="Cliente">
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{r.cliente ?? 'Sin cliente'}</Text>
          <Datos filas={[
            ['Teléfono', tel || 'Sin teléfono'],
            ['App', r.tiene_app ? 'La tiene: los avisos le llegan solos' : 'No la tiene: se le avisa por WhatsApp'],
            r.entrega === 'domicilio' && ['Entrega', `A domicilio · ${r.direccion_entrega ?? ''}`],
            fiscal && ['Factura', `Crédito fiscal · ${fiscal.nombre} · NIT ${fiscal.nit} · NRC ${fiscal.nrc}`],
          ]} />
          {tel || wa ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {tel ? <Accion texto="Llamar" onPress={() => Linking.openURL(`tel:${String(r.telefono).replace(/\D/g, '')}`).catch((e) => console.warn(`reserva/[id]: no se abrió la llamada de la reserva ${r.id}`, e))} /> : null}
              {wa ? <Accion texto="WhatsApp" color={MARCA.verde} onPress={() => Linking.openURL(`https://wa.me/${wa}`).catch((e) => console.warn(`reserva/[id]: no se abrió WhatsApp de la reserva ${r.id}`, e))} /> : null}
            </View>
          ) : null}
        </Seccion>

        <Seccion titulo={filas.length > 1 ? `Productos · ${filas.length}` : 'Producto'}>
          {filas.map((x, i) => {
            const t = x.estado === 'pendiente' ? TRASLADO_DE_RESERVA[x.traslado_estado] : null;
            const nota = x.estado === 'pendiente'
              ? `${x.traslado_nota || (x.traslado_estado ? '' : 'Hay que apartarla en la sala.')}${Number(x.traslado_llegaron) > 0 ? ` Llegaron ${x.traslado_llegaron} de ${x.cantidad}.` : ''}`.trim()
              : '';
            return (
              <View key={x.id} style={{ gap: 4, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{x.producto}</Text>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                    {formatMoney(Number(x.precio ?? 0) * Number(x.cantidad ?? 1))}
                  </Text>
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                  {`${x.cantidad} × ${formatMoney(Number(x.precio ?? 0))}${Number(x.precio_normal) > Number(x.precio) ? ` · precio normal ${formatMoney(Number(x.precio_normal))}` : ''}${x.lista_precio ? ` · ${x.lista_precio === 'mayoreo_plus' ? 'Mayoreo Plus' : 'Mayoreo'}` : ''}${r.pedido ? ` · ${codigoDeReserva(x.id)}` : ''}`}
                </Text>
                {t || nota ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    {t ? <Pildora texto={t.texto} color={colorDeTono(t.tono)} /> : null}
                    {nota ? <Text style={{ flexShrink: 1, color: colorSistema.texto2, fontSize: 13 }}>{nota}</Text> : null}
                  </View>
                ) : x.estado === 'lista' && filas.length > 1 ? <Pildora texto="Lista" color={MARCA.verde} /> : null}
                {x.encargo ? (
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {`Encargo ${x.encargo.codigo} · ${x.encargo.cantidad} a Bodega${x.encargo.fecha ? ` · llega ${dia(x.encargo.fecha)}` : ''}`}
                  </Text>
                ) : null}
                {x.oferta ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Oferta: ${x.oferta}`}</Text> : null}
              </View>
            );
          })}
        </Seccion>

        <Seccion titulo="Pago">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Cifra rotulo="Total" valor={total} />
            <Cifra rotulo={pagadoTodo ? 'Pagado' : 'Anticipo'} valor={pagado} color={MARCA.verde} />
            <Cifra rotulo="Falta al retirar" valor={falta} color={falta > 0.004 ? MARCA.ambar : colorSistema.texto2} />
          </View>
          <Datos filas={[
            pagado > 0 && ['Cómo pagó', formaDePagoLegible(r.pago_metodo)],
            Number(r.costo_envio) > 0 && ['Envío', formatMoney(Number(r.costo_envio))],
            r.pago_prueba && ['Atención', 'El cobro en línea fue de prueba: no entró dinero, se cobra en caja.'],
            r.preventa_ref && ['En caja', `Preventa #${r.preventa_ref}${r.factura ? ` · factura ${r.factura}` : ''}`],
          ]} />
        </Seccion>

        {fechas.length ? <Seccion titulo="Fechas"><Datos filas={fechas} /></Seccion> : null}

        {r.bajo_receta ? (
          <Seccion titulo="Receta">
            <Datos filas={[['Estado', recetaLegible(r.receta_estado)], r.receta_motivo && ['Motivo', r.receta_motivo]]} />
          </Seccion>
        ) : null}

        {/* La menor (cancelar), al pie y lejos de las demás. */}
        {menores.map((a) => (
          <BotonGrande key={a.k} texto={a.label} color={colorDeAccion(a)} borde deshabilitado={ocupada === r.id} onPress={() => ejecutar(r, a)} />
        ))}
      </ScrollView>
    </>
  );
}
