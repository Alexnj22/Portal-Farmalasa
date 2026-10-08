// Mis reservas (2026-10-06): lo que el cliente apartó, si es de una promoción o
// un producto normal, en qué va, cómo se entrega (retiro en qué sucursal, o a
// domicilio), cómo se paga y si ya está pagado. Una reserva «lista» muestra la
// cuenta regresiva de las 24 horas; una pendiente o lista se puede cancelar.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { Boton, Cargando, Pantalla, Tarjeta, Vacio } from '../componentes/ui';
import Icono from '../componentes/Icono';
import CodigoReserva from '../componentes/CodigoReserva';
import { Entrada, Latido } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { dolares, fecha } from '../lib/formato';
import { suave, useTema } from '../tema/tema';
import { navegar } from '../lib/navegar';

// Colores del tema (cambian con el modo oscuro y se leen sobre el vidrio).
const ESTADO_BASE = {
  pendiente: { texto: 'Preparando', tono: 'aviso' },
  lista: { texto: '¡Lista para retirar!', tono: 'exito' },
  retirada: { texto: 'Retirada', tono: 'neutro' },
  vencida: { texto: 'Venció', tono: 'peligro' },
  cancelada: { texto: 'Cancelada', tono: 'neutro' },
};
const FONDOS = { aviso: 'rgba(255,159,10,0.18)', exito: 'rgba(52,199,89,0.2)', peligro: 'rgba(255,59,48,0.14)', neutro: 'rgba(120,110,130,0.16)' };
const estadoDe = (t, e) => {
  const b = ESTADO_BASE[e] ?? ESTADO_BASE.pendiente;
  const color = { aviso: t.color.avisoTexto, exito: t.color.exitoTexto, peligro: t.color.peligroTexto, neutro: colorSistema.texto2 }[b.tono];
  return { texto: b.texto, color, fondo: FONDOS[b.tono] };
};

function restante(iso, ahora) {
  const ms = Date.parse(iso) - ahora;
  if (ms <= 0) return 'vence ahora';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h ? `quedan ${h} h ${m} min` : `quedan ${m} min`;
}

export default function Reservas() {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [ahora, setAhora] = useState(Date.now());
  const [refrescando, setRefrescando] = useState(false);
  const [encargos, setEncargos] = useState([]);
  const cargar = useCallback(() => Promise.all([
    pedir('mis_reservas').then((r) => setD((ant) => (r?.ok || !ant?.ok ? r : ant))),
    pedir('mis_encargos').then((r) => { if (r?.ok) setEncargos(r.encargos); }),
  ]), [pedir]);
  // Pagar el anticipo de un encargo confirmado (Wompi, como las reservas).
  const pagarEncargo = async (e) => {
    const res = await pedir('pagar_encargo', { id: e.id });
    if (!res?.ok) { Alert.alert('No se pudo abrir el pago', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
    await WebBrowser.openAuthSessionAsync(res.url, 'puntossalud://reservas');
    for (let i = 0; i < 4; i++) {
      const r = await pedir('mis_encargos');
      if (r?.ok) setEncargos(r.encargos);
      if (r?.encargos?.find((x) => x.id === e.id)?.pago_estado === 'pagado') { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); break; }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  };
  const cancelarEncargo = (e) => Alert.alert('Cancelar encargo', `¿Cancelar ${e.producto_nombre}?`, [
    { text: 'No', style: 'cancel' },
    { text: 'Cancelar encargo', style: 'destructive', onPress: async () => {
      const res = await pedir('cancelar_encargo', { id: e.id });
      if (!res?.ok) Alert.alert('No se pudo cancelar', res?.mensaje ?? 'Revisa tu conexión.');
      cargar();
    } },
  ]);
  useFocusEffect(useCallback(() => { cargar(); pedir('pago_preparar'); }, [cargar, pedir]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };
  useEffect(() => { const id = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(id); }, []);

  const cancelar = (r) => Alert.alert('Cancelar reserva', `¿Cancelar ${r.producto_nombre}?`, [
    { text: 'No', style: 'cancel' },
    { text: 'Cancelar reserva', style: 'destructive', onPress: async () => {
      const res = await pedir('cancelar_reserva', { id: r.id });
      if (res?.ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      else Alert.alert('No se pudo cancelar', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
      cargar();
    } },
  ]);

  // Pagar en línea (Wompi, 2026-10-07): el servidor arma el cobro con el total
  // de la reserva y la pantalla de Wompi se abre en una hoja sobre la app.
  // Al pagar, Wompi vuelve a `puntossalud://reservas` y la hoja se cierra
  // sola. Quien marca «pagado» es el servidor, nunca esta pantalla: acá sólo
  // se vuelve a leer, un par de veces, por si el aviso de Wompi se atrasa.
  const [pagando, setPagando] = useState(null);
  const pagar = async (r) => {
    setPagando(r.id);
    try {
      const res = await pedir('pagar_reserva', { id: r.id });
      if (!res?.ok) { Alert.alert('No se pudo abrir el pago', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
      await WebBrowser.openAuthSessionAsync(res.url, 'puntossalud://reservas');
      for (let i = 0; i < 4; i++) {
        const nuevo = await pedir('mis_reservas');
        if (nuevo?.ok) setD(nuevo);
        if (nuevo?.reservas?.find((x) => x.id === r.id)?.pago_estado === 'pagado') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          break;
        }
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    } finally {
      setPagando(null);
    }
  };

  if (!d) return <Cargando />;
  if (!d.ok) return <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}><Vacio titulo="No se pudieron cargar">{d.mensaje ?? 'Revisa tu conexión y desliza hacia abajo para reintentar.'}</Vacio></Pantalla>;
  if (!d.reservas.length && !encargos.length) {
    return (
      <Pantalla conPestanas={false}>
        <Vacio titulo="Sin reservas">Aparta productos de las ofertas y pásalos a retirar sin hacer fila.</Vacio>
        <Pressable onPress={() => navegar('/ofertas')} style={{ alignSelf: 'center', padding: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: t.color.magentaTexto }}>Ver ofertas</Text>
        </Pressable>
      </Pantalla>
    );
  }
  const abiertas = d.reservas.filter((r) => r.estado === 'pendiente' || r.estado === 'lista');
  const cerradas = d.reservas.filter((r) => r.estado !== 'pendiente' && r.estado !== 'lista');
  return (
    <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      {encargos.length ? (
        <>
          <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4 }}>Encargos</Text>
          {encargos.map((e) => <Encargo key={e.id} e={e} alPagar={() => pagarEncargo(e)} alCancelar={() => cancelarEncargo(e)} />)}
          {abiertas.length ? <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4, marginTop: 8 }}>Reservas</Text> : null}
        </>
      ) : null}
      {abiertas.map((r, i) => (
        <Entrada key={r.id} indice={Math.min(i, 8)}>
          <ReservaAbierta r={r} ahora={ahora} alCancelar={() => cancelar(r)} alPagar={() => pagar(r)} pagando={pagando === r.id} />
        </Entrada>
      ))}
      {cerradas.length ? (
        <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4, marginTop: 8 }}>Anteriores</Text>
      ) : null}
      {cerradas.map((r, i) => (
        <Entrada key={r.id} indice={Math.min(abiertas.length + i, 8)}>
          <ReservaCerrada r={r} />
        </Entrada>
      ))}
    </Pantalla>
  );
}

// Promoción o producto normal, cómo se paga y cómo se entrega (2026-10-06).
const PAGO = {
  pendiente: { texto: 'Pendiente de pago', tono: 'aviso', sf: 'clock' },
  anticipo: { texto: 'Anticipo pagado', tono: 'aviso', sf: 'circle.lefthalf.filled' },
  pagado: { texto: 'Pagado', tono: 'exito', sf: 'checkmark.seal.fill' },
  devuelto: { texto: 'Devuelto', tono: 'neutro', sf: 'arrow.uturn.backward' },
};
const METODO = {
  al_retirar: 'En caja, al retirar', efectivo: 'Efectivo', tarjeta: 'Tarjeta',
  en_linea: 'En línea', transferencia: 'Transferencia',
};
const tonoColor = (t, tono) => ({ aviso: t.color.avisoTexto, exito: t.color.exitoTexto, peligro: t.color.peligroTexto, neutro: colorSistema.texto2 }[tono]);
const fechaHora = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  // El día en la hora del teléfono (no el de UTC: de noche ya sería mañana).
  const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${fecha(dia)}, ${h % 12 || 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};
const mapa = (r) => {
  const q = encodeURIComponent(`Farmacia ${r.sala}, ${r.sala_direccion ?? ''}, El Salvador`);
  return Platform.OS === 'ios' ? `maps://?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
};

// Promoción (con el nombre de la oferta) o producto a precio normal.
function Tipo({ r }) {
  const t = useTema();
  const promo = r.tipo === 'promocion';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
      backgroundColor: promo ? suave(t.color.magenta, t.oscuro ? 0.28 : 0.14) : (t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)') }}>
      <Icono sf={promo ? 'tag.fill' : 'shippingbox.fill'} respaldo="" tam={11} color={promo ? t.color.magentaTexto : colorSistema.texto2} />
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '800', color: promo ? t.color.magentaTexto : colorSistema.texto2 }}>
        {promo ? 'Promoción' : 'Producto'}
      </Text>
    </View>
  );
}

// Un renglón de datos: ícono, rótulo, valor y, si hace falta, una acción.
function Dato({ sf, rotulo, valor, detalle, color, accion }) {
  const t = useTema();
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 10 }}>
      <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}>
        <Icono sf={sf} respaldo="•" tam={15} color={color ?? colorSistema.texto2} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto3 }}>{rotulo}</Text>
        <Text style={{ fontSize: 15, fontWeight: '700', color: color ?? colorSistema.texto }}>{valor}</Text>
        {detalle ? <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>{detalle}</Text> : null}
      </View>
      {accion ? (
        <Pressable onPress={accion.alTocar} hitSlop={8} accessibilityRole="button" accessibilityLabel={accion.texto}
          style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: t.color.magentaTexto }}>{accion.texto}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const Separador = () => <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 42 }} />;

// Una reserva en curso: qué es (promoción o producto), en qué paso va
// (Recibida → Lista → Retirada), cómo se entrega, cómo se paga y cuánto.
function ReservaAbierta({ r, ahora, alCancelar, alPagar, pagando }) {
  const t = useTema();
  const lista = r.estado === 'lista';
  const e = estadoDe(t, r.estado);
  const pasos = ['Recibida', 'Lista', 'Retirada'];
  const actual = lista ? 1 : 0;
  const pago = PAGO[r.pago_estado] ?? PAGO.pendiente;
  const domicilio = r.entrega === 'domicilio';
  const ahorro = r.precio_normal != null && r.precio_unitario != null && r.precio_normal > r.precio_unitario
    ? (r.precio_normal - r.precio_unitario) * r.cantidad : 0;
  // El código para retirar (2026-10-07): el del pedido del carrito o el de la
  // reserva. En la sucursal lo escanean para encontrarla, prepararla y facturarla.
  const [verCodigo, setVerCodigo] = useState(lista);
  const codigo = r.pedido ?? r.codigo;
  return (
    <Tarjeta tono={lista ? t.color.verde : undefined} estilo={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {lista ? <Latido><Pildora e={e} /></Latido> : <Pildora e={e} />}
          <Tipo r={r} />
        </View>
        <Text style={{ fontSize: 13, fontWeight: '800', color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>{r.codigo}</Text>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto, letterSpacing: -0.3 }}>{r.producto_nombre}</Text>
        {r.tipo === 'promocion' && r.oferta_titulo ? (
          <Text style={{ fontSize: 14, fontWeight: '600', color: t.color.magentaTexto }} numberOfLines={1}>{r.oferta_titulo}</Text>
        ) : null}
      </View>

      {/* Los pasos: dónde va la reserva. */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {pasos.map((p, i) => (
          <View key={p} style={{ flex: i < pasos.length - 1 ? 1 : 0, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
                backgroundColor: i <= actual ? (lista ? '#34C759' : t.color.magenta) : (t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)') }}>
                {i <= actual ? <Icono sf="checkmark" respaldo="✓" tam={11} color="#FFFFFF" /> : null}
              </View>
              <Text style={{ fontSize: 11, fontWeight: i === actual ? '800' : '600', color: i <= actual ? colorSistema.texto : colorSistema.texto3 }}>{p}</Text>
            </View>
            {i < pasos.length - 1 ? (
              <View style={{ flex: 1, height: 2, marginHorizontal: 6, marginBottom: 16, borderRadius: 1,
                backgroundColor: i < actual ? (lista ? '#34C759' : t.color.magenta) : (t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)') }} />
            ) : null}
          </View>
        ))}
      </View>

      {lista && r.vence_at ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, padding: 12, backgroundColor: 'rgba(52,199,89,0.16)' }}>
          <Icono sf="timer" respaldo="⏱" tam={16} color={t.color.exitoTexto} />
          <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: t.color.exitoTexto }}>
            Lista para {domicilio ? 'entregar' : 'retirar'}: {restante(r.vence_at, ahora)}
          </Text>
        </View>
      ) : (
        <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>
          La sucursal la está preparando. Te avisamos cuando esté lista{r.oferta_fin ? `; la oferta vale hasta el ${fecha(r.oferta_fin)}` : ''}.
        </Text>
      )}

      <View>
        {domicilio ? (
          <Dato sf="house.fill" rotulo="Entrega" valor="A domicilio" detalle={r.direccion_entrega} />
        ) : (
          <Dato sf="storefront.fill" rotulo="Retiro en sucursal" valor={r.sala ?? 'Sucursal'} detalle={r.sala_direccion}
            accion={r.sala ? { texto: 'Cómo llegar', alTocar: () => Linking.openURL(mapa(r)).catch(() => {}) } : null} />
        )}
        <Separador />
        <Dato sf={pago.sf} rotulo="Pago" valor={pago.texto} color={tonoColor(t, pago.tono)}
          detalle={`${METODO[r.pago_metodo] ?? 'En caja, al retirar'}${r.pago_estado === 'anticipo' && r.anticipo ? ` · anticipo ${dolares(r.anticipo)}` : ''}${r.pagado_at ? ` · ${fechaHora(r.pagado_at)}` : ''}`} />
        <Separador />
        <Dato sf="calendar" rotulo="Reservada" valor={fechaHora(r.created_at)} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
        paddingTop: 12, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.texto3 }}>
            {r.cantidad} {r.cantidad === 1 ? 'UNIDAD' : 'UNIDADES'}{r.precio_unitario != null ? ` × ${dolares(r.precio_unitario)}` : ''}
          </Text>
          {ahorro > 0 ? <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }}>Ahorras {dolares(ahorro)}</Text> : null}
        </View>
        {r.precio_unitario != null ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.texto3 }}>{r.pago_estado === 'pagado' ? 'PAGASTE' : 'TOTAL'}</Text>
            <Text style={{ fontSize: 24, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(r.total ?? r.precio_unitario * r.cantidad)}</Text>
          </View>
        ) : null}
      </View>

      {r.pago_estado === 'pendiente' && Number(r.total) > 0 ? (
        <View style={{ gap: 6 }}>
          {/* Un pedido del carrito se cobra entero: sus productos + el envío. */}
          <Boton alTocar={alPagar} cargando={pagando}>{r.total_pedido != null
            ? `Pagar el pedido ${dolares(r.total_pedido)}${Number(r.costo_envio) > 0 ? ' (con envío)' : ''}`
            : `Pagar en línea ${dolares(r.total)}`}</Boton>
          <Text style={{ fontSize: 12, textAlign: 'center', color: colorSistema.texto3 }}>
            O paga al retirar, en la sucursal. Pagada en línea tienes 7 días para retirarla.
          </Text>
        </View>
      ) : null}

      {/* El código para retirar: se muestra solo cuando está lista. */}
      <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setVerCodigo((x) => !x); }} accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icono sf="qrcode" respaldo="" tam={16} color={colorSistema.texto} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>{r.pedido ? `Pedido ${r.pedido}` : `Código ${r.codigo}`}</Text>
        </View>
        <Icono sf={verCodigo ? 'chevron.up' : 'chevron.down'} respaldo="" tam={12} color={colorSistema.texto3} />
      </Pressable>
      {verCodigo ? <CodigoReserva codigo={codigo} tam={140} /> : null}

      {r.pago_estado === 'pagado' ? (
        <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>
          Ya está pagada. Para cancelarla, escríbele a la sucursal.
        </Text>
      ) : (
        <Pressable onPress={alCancelar} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.rojo }}>Cancelar reserva</Text>
        </Pressable>
      )}
    </Tarjeta>
  );
}

// Una reserva terminada: compacta, con lo que importa después.
function ReservaCerrada({ r }) {
  const t = useTema();
  const e = estadoDe(t, r.estado);
  const pago = PAGO[r.pago_estado] ?? PAGO.pendiente;
  const retirada = r.estado === 'retirada';
  return (
    <Tarjeta estilo={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icono sf={retirada ? 'checkmark.circle.fill' : 'xmark.circle'} respaldo="•" tam={24} color={e.color} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }} numberOfLines={1}>{r.cantidad} × {r.producto_nombre}</Text>
          <Text style={{ fontSize: 13, color: colorSistema.texto3 }} numberOfLines={1}>
            {e.texto} · {r.entrega === 'domicilio' ? 'A domicilio' : r.sala} · {fechaHora(r.cerrada_at ?? r.created_at)}
          </Text>
        </View>
        {r.precio_unitario != null ? (
          <Text style={{ fontSize: 15, fontWeight: '800', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(r.total ?? r.precio_unitario * r.cantidad)}</Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginLeft: 36, flexWrap: 'wrap' }}>
        <Tipo r={r} />
        {retirada || r.pago_estado !== 'pendiente' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: FONDOS[pago.tono] }}>
            <Icono sf={pago.sf} respaldo="" tam={11} color={tonoColor(t, pago.tono)} />
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '800', color: tonoColor(t, pago.tono) }}>{pago.texto}</Text>
          </View>
        ) : null}
      </View>
    </Tarjeta>
  );
}

function Pildora({ e }) {
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: e.fondo, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '800', color: e.color }}>{e.texto}</Text>
    </View>
  );
}

// Un encargo (2026-10-07): en qué paso va, el precio y la fecha cuando la
// sucursal confirma, y pagar el anticipo para asegurarlo.
const PASOS_ENCARGO = ['solicitado', 'confirmado', 'aceptado', 'pedido', 'listo'];
const TEXTO_ENCARGO = {
  solicitado: 'La sucursal está revisando si lo puede conseguir',
  confirmado: 'Se puede conseguir: confírmalo pagando el anticipo',
  aceptado: 'Pagado: ya lo estamos pidiendo',
  pedido: 'Pedido al proveedor',
  listo: '¡Llegó! Pasa a retirarlo',
  entregado: 'Entregado',
  rechazado: 'No se pudo conseguir',
  cancelado: 'Cancelado',
};
function Encargo({ e, alPagar, alCancelar }) {
  const t = useTema();
  const paso = PASOS_ENCARGO.indexOf(e.estado);
  const cerrado = paso < 0;
  return (
    <Tarjeta tono={e.estado === 'listo' ? t.color.verde : e.estado === 'confirmado' ? t.color.magenta : undefined} estilo={{ gap: 12, opacity: cerrado ? 0.7 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icono sf="shippingbox.fill" respaldo="" tam={14} color={colorSistema.texto2} />
          <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: colorSistema.texto2 }}>ENCARGO</Text>
        </View>
        <Text style={{ fontSize: 13, fontWeight: '800', color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>{e.codigo}</Text>
      </View>
      <Text style={{ fontSize: 18, fontWeight: '800', color: colorSistema.texto }}>{e.cantidad} × {e.producto_nombre}</Text>
      {!cerrado ? (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {PASOS_ENCARGO.map((p, i) => (
            <View key={p} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= paso ? (e.estado === 'listo' ? '#34C759' : t.color.magenta) : (t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)') }} />
          ))}
        </View>
      ) : null}
      <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto }}>{TEXTO_ENCARGO[e.estado] ?? e.estado}</Text>
      {e.precio_unitario != null ? (
        <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>
          {dolares(e.anticipo)} en total{e.fecha_estimada ? ` · llega aprox. el ${fecha(e.fecha_estimada)}` : ''} · retiro en {e.sala}
        </Text>
      ) : <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>Retiro en {e.sala}</Text>}
      {e.nota_sucursal ? <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>«{e.nota_sucursal}»</Text> : null}
      {e.estado === 'confirmado' && e.pago_estado !== 'pagado' ? (
        <Boton alTocar={alPagar}>{`Confirmar y pagar ${dolares(e.anticipo)}`}</Boton>
      ) : null}
      {(e.estado === 'solicitado' || e.estado === 'confirmado') && e.pago_estado !== 'pagado' ? (
        <Pressable onPress={alCancelar} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.rojo }}>Cancelar encargo</Text>
        </Pressable>
      ) : null}
    </Tarjeta>
  );
}
