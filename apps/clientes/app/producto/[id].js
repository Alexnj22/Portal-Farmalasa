// La ficha de un producto del catálogo (2026-10-07): foto, principio activo,
// laboratorio, cada presentación con su precio de viñeta y su precio VIP, y en
// qué sucursal hay. «Consultar» abre WhatsApp con la empresa y el nombre del
// producto. Hoja del sistema que se cierra deslizando hacia abajo.
//
// 2026-10-12: lo bajo receta YA se agrega al carrito (al reservar se pide la
// foto de la receta), y quien tiene precio de mayoreo lo ve como el principal
// («Mayoreo» / «Mayoreo Plus»), con la viñeta tachada (lib/precioTuyo.js).
//
// 2026-10-15: «¿Dónde lo hay?» cuenta por lo que se va a pedir (presentación ×
// cantidad), dice si la sucursal está abierta y a cuánto queda.
import { useEffect, useState } from 'react';
import { Alert, Linking, Modal, ScrollView, Text, View } from 'react-native';
import { Image as ImagenFicha } from 'expo-image';
import Presionable from '../../componentes/Presionable';
import { MAX_UNIDADES, useCarrito } from '../../lib/carrito';
import EncargoHoja from '../../componentes/EncargoHoja';
import DondeLoHay from '../../componentes/DondeLoHay';
import MismoPrincipio from '../../componentes/MismoPrincipio';
import BotonAvisame from '../../componentes/BotonAvisame';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Cargando, RADIO, Seccion, Vacio } from '../../componentes/ui';
import { colorSistema } from '../../componentes/sistema';
import Icono from '../../componentes/Icono';
import IconoWhatsapp, { VERDE_WHATSAPP } from '../../componentes/IconoWhatsapp';
import FotoProducto from '../../componentes/FotoProducto';
import { llamar } from '../../lib/api';
import { dolares } from '../../lib/formato';
import { nombreProducto, recordarVisto } from '../../lib/catalogo';
import { suave, useTema } from '../../tema/tema';
import { navegar } from '../../lib/navegar';
import { seguirSiYaReservado } from '../../lib/reservaDuplicada';
import { datosDePrecio, mayoreoSoloEnCaja, precioFinal, rotuloPrecioTuyo } from '../../lib/precioTuyo';
import { useSesion } from '../../lib/sesion';

export default function Producto() {
  const { id } = useLocalSearchParams();
  const navigation = useNavigation();
  const ins = useSafeAreaInsets();
  const t = useTema();
  const [d, setD] = useState(null);
  // Lo que se va a agregar: la presentación (por factor) y cuántas.
  const [sel, setSel] = useState(null);
  const [cant, setCant] = useState(1);
  const [fotoGrande, setFotoGrande] = useState(false);
  const [encargando, setEncargando] = useState(false);
  // «Preguntar a la farmacia» (2026-10-13): sólo con sesión (el chat cuelga de la ficha).
  const conSesion = useSesion((s) => !!s.token);
  const cargar = () => {
    setD(null);
    llamar('catalogo_producto', { id: Number(id), ...datosDePrecio() }).then((r) => {
      // El mayoreo sólo en la caja (lib/precioTuyo): las unidades, a Preferente.
      if (r?.ok) r = { ...r, producto: { ...r.producto, presentaciones: mayoreoSoloEnCaja(r.producto.presentaciones) } };
      setD(r ?? { ok: false });
      if (r?.ok) {
        const pm = [...(r.producto.presentaciones ?? [])].sort((a, b) => (b.factor ?? 1) - (a.factor ?? 1))[0];
        recordarVisto({ id: r.producto.id, nombre: r.producto.nombre, foto: r.producto.foto, precio: pm?.precio, precio_vip: pm?.precio_vip });
      }
    });
  };
  useEffect(() => { cargar(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // El fondo de pantalla del sistema (2026-11-04; antes dos hex a mano).
  const fondo = colorSistema.fondo;
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';
  const cerrar = () => { Haptics.selectionAsync().catch(() => {}); router.back(); };

  if (!d) return <View style={{ flex: 1, backgroundColor: fondo }}><Cargando /></View>;
  if (!d.ok) {
    return (
      <View style={{ flex: 1, backgroundColor: fondo, justifyContent: 'center' }}>
        {/* «Reintentar» con el botón del sistema dentro del vacío (2026-11-04),
            como el resto de los errores de la app; antes era un texto suelto. */}
        <View style={{ padding: 16 }}>
          <Vacio titulo="No se pudo cargar" accion="Reintentar" alAccion={cargar}>{d.mensaje ?? 'Revisa tu conexión.'}</Vacio>
        </View>
      </View>
    );
  }
  const p = d.producto;
  const nombre = nombreProducto(p.nombre);
  const consultar = () => {
    const msg = encodeURIComponent(`Hola, quiero consultar por ${nombre}.`);
    Linking.openURL(`https://wa.me/${d.whatsapp ?? '50323010013'}?text=${msg}`).catch(() => {});
  };
  // La presentación mayor (la de mayor factor): la que agrega el botón de abajo.
  const mayor = [...(p.presentaciones ?? [])].sort((a, b) => (b.factor ?? 1) - (a.factor ?? 1))[0];
  const elegida_factor = sel ?? mayor?.factor ?? 1;
  const elegidaP = (p.presentaciones ?? []).find((x) => (x.factor ?? 1) === elegida_factor) ?? mayor;
  // Volver a la Tienda (2026-11-03). El producto es un modal sobre las
  // pestañas: si debajo está la Tienda, basta cerrarlo; si se abrió desde otro
  // lado (Inicio, el chat, un tratamiento), se cierra y se va a la Tienda.
  const volverALaTienda = () => {
    if (!router.canGoBack()) { navegar('/catalogo'); return; }
    const pila = navigation.getState?.();
    const debajo = pila?.routes?.[(pila?.index ?? 0) - 1];
    const pestanas = debajo?.name === '(tabs)' ? debajo.state : null;
    const enLaTienda = pestanas?.routes?.[pestanas.index ?? 0]?.name === 'catalogo';
    router.back();
    if (!enLaTienda) setTimeout(() => navegar('/catalogo'), 300);
  };
  const agregar = async (x, n = 1) => {
    if (!x) return;
    // Si ya está reservado, se pregunta antes (2026-10-09). Para ver la
    // reserva primero se cierra esta hoja.
    const seguir = await seguirSiYaReservado(p.id, {
      alVer: (r) => { router.back(); setTimeout(() => navegar(`/reservas?resaltar=${r.id}`), 300); },
    });
    if (!seguir) return;
    const ok = useCarrito.getState().agregar({ id: p.id, nombre: p.nombre, foto: p.foto, tipo: x.tipo, factor: x.factor ?? 1, precio: x.precio, precio_vip: x.precio_vip,
      precio_tuyo: x.precio_tuyo ?? null, precio_tuyo_nombre: x.precio_tuyo_nombre ?? null, factor_mayor: x.factor_mayor ?? null, receta: !!p.bajo_receta }, n);
    if (!ok) { Alert.alert('Carrito lleno', 'El carrito admite hasta 10 productos distintos.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCant(1);
    // «Seguir viendo» dejaba al cliente en el producto (2026-11-03): ahora es
    // «Seguir comprando» y vuelve a la Tienda.
    Alert.alert('Agregado al carrito', `${n} × ${nombreProducto(p.nombre)} · ${nombreProducto(x.tipo)}`, [
      { text: 'Seguir comprando', style: 'cancel', onPress: volverALaTienda },
      { text: 'Ir al carrito', onPress: () => { router.back(); setTimeout(() => navegar('/carrito'), 300); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: fondo }}>
      <Modal visible={fotoGrande} transparent animationType="fade" onRequestClose={() => setFotoGrande(false)}>
        <Presionable onPress={() => setFotoGrande(false)} accessibilityRole="button" accessibilityLabel="Cerrar foto" style={{ flex: 1, backgroundColor: '#FFFFFF', padding: 24 }}>
          <ImagenFicha source={{ uri: p.foto }} contentFit="contain" style={{ flex: 1 }} accessibilityIgnoresInvertColors />
        </Presionable>
      </Modal>
      <ScrollView contentContainerStyle={{ paddingBottom: ins.bottom + 110 }}
        // Jalar hacia abajo estando arriba del todo también la cierra: el gesto de la
        // hoja a veces se lo queda el ScrollView (2026-10-07).
        onScrollEndDrag={(e) => { if (e.nativeEvent.contentOffset.y < -80) router.back(); }} scrollEventThrottle={16}>
        {/* Foto al lado del nombre (2026-11-09): el cuadro grande dejaba mucho blanco
            y empujaba precio y existencias hacia abajo. Tocarla la amplía. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12 }}>
          <Presionable disabled={!p.foto} onPress={() => setFotoGrande(true)} accessibilityRole={p.foto ? 'imagebutton' : undefined} accessibilityLabel={p.foto ? `Ampliar foto de ${nombre}` : undefined}
            style={({ pressed }) => ({ width: 120, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            <FotoProducto id={p.id} nombre={p.nombre} foto={p.foto} alto={120} radio={20} />
          </Presionable>
          {/* A la derecha deja libre la esquina de la X de la hoja. */}
          <View style={{ flex: 1, gap: 5, paddingRight: 30 }}>
            {p.bajo_receta ? (
              <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
                backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.14) }}>
                <Icono sf="doc.text.fill" respaldo="" tam={11} color={t.color.magentaTexto} />
                <Text style={{ fontSize: 12, fontWeight: '800', color: t.color.magentaTexto }}>Bajo Receta</Text>
              </View>
            ) : null}
            <Text style={{ fontSize: 22, lineHeight: 26, fontWeight: '800', color: colorSistema.texto, letterSpacing: -0.3 }}>{nombre}</Text>
            {p.principio_activo ? (
              <Text numberOfLines={3} style={{ fontSize: 14, lineHeight: 19, color: colorSistema.texto2 }}>{nombreProducto(p.principio_activo)}</Text>
            ) : null}
            {p.laboratorio ? <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto3 }}>{nombreProducto(p.laboratorio)}</Text> : null}
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          {/* Abre el chat con este producto ya puesto sobre la barra (2026-10-13). */}
          {conSesion ? (
            <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); router.back(); setTimeout(() => navegar(`/chat?producto=${p.id}`), 300); }}
              accessibilityRole="button" accessibilityLabel={`Preguntar a la farmacia por ${nombre}`}
              style={({ pressed }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 4, paddingHorizontal: 16,
                borderRadius: 22, backgroundColor: suave(t.color.magenta, pressed ? (t.oscuro ? 0.4 : 0.24) : (t.oscuro ? 0.26 : 0.13)) })}>
              <Icono sf="bubble.left.and.bubble.right.fill" respaldo="💬" tam={16} color={t.color.magentaTexto} />
              <Text style={{ flexShrink: 1, fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>Preguntar a la farmacia</Text>
            </Presionable>
          ) : null}
        </View>

        {/* Precios: cada presentación con el de viñeta y el Preferente (antes «VIP», Procedimiento de Clientes §1); se toca la que se quiere. */}
        <Titular texto="Elige la presentación" />
        <View style={{ marginHorizontal: 16, borderRadius: RADIO.medio, backgroundColor: superficie, overflow: 'hidden' }}>
          {(p.presentaciones ?? []).map((x, i) => {
            const ahorro = precioFinal(x) < x.precio ? x.precio - precioFinal(x) : 0;
            const suyo = rotuloPrecioTuyo(x);
            const elegida = (x.factor ?? 1) === (elegida_factor ?? -1);
            return (
              <View key={i}>
                {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 16 }} /> : null}
                <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); setSel(x.factor ?? 1); }}
                  accessibilityRole="radio" accessibilityState={{ selected: elegida }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14,
                    backgroundColor: elegida ? suave(t.color.magenta, t.oscuro ? 0.18 : 0.08) : 'transparent' }}>
                  <Icono sf={elegida ? 'checkmark.circle.fill' : 'circle'} respaldo="" tam={22} color={elegida ? t.color.magenta : colorSistema.texto3} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: colorSistema.texto }}>{nombreProducto(x.tipo)}</Text>
                    {ahorro >= 0.01 ? (
                      <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.verdeTexto }}>Ahorras {dolares(ahorro)}{suyo ? '' : ' con tu tarjeta de Puntos Salud'}</Text>
                    ) : null}
                    {suyo && x.precio_tuyo_sin_puntos ? (
                      <Text style={{ fontSize: 12, color: colorSistema.texto3 }}>A precio de personal no acumula puntos</Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {suyo ? (
                      <>
                        <Text style={{ fontSize: 13, color: colorSistema.texto3, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>{dolares(x.precio)}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: t.color.magentaTexto }}>{suyo.toUpperCase()}</Text>
                          <Text style={{ fontSize: 20, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(x.precio_tuyo)}</Text>
                        </View>
                      </>
                    ) : x.precio_vip != null ? (
                      <>
                        <Text style={{ fontSize: 13, color: colorSistema.texto3, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>{dolares(x.precio)}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: t.color.magentaTexto }}>PREFERENTE</Text>
                          <Text style={{ fontSize: 20, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(x.precio_vip)}</Text>
                        </View>
                      </>
                    ) : (
                      <Text style={{ fontSize: 20, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(x.precio)}</Text>
                    )}
                  </View>
                </Presionable>
              </View>
            );
          })}
        </View>
        <Text style={{ fontSize: 13, color: colorSistema.texto3, marginHorizontal: 32, marginTop: 8 }}>
          El precio Preferente es para quien tiene cuenta en Puntos Salud: muestra tu tarjeta en caja.
        </Text>
        {/* Con precio de mayoreo y más de una presentación: por qué las unidades no lo llevan. */}
        {(p.presentaciones ?? []).some((x) => rotuloPrecioTuyo(x)) && (p.presentaciones ?? []).length > 1 ? (
          <Text style={{ fontSize: 13, color: colorSistema.texto2, marginHorizontal: 32, marginTop: 6 }}>
            El precio {rotuloPrecioTuyo((p.presentaciones ?? []).find((x) => rotuloPrecioTuyo(x)))} es por la presentación completa. En unidades sueltas pagas el precio Preferente.
          </Text>
        ) : null}
        {p.bajo_receta ? (
          <Text style={{ fontSize: 13, color: colorSistema.texto2, marginHorizontal: 32, marginTop: 6 }}>
            Bajo receta: al reservarlo te pedimos una foto de tu receta, y la sucursal la revisa antes de confirmar tu pedido.
          </Text>
        ) : null}

        {/* Dónde hay (2026-10-15): por CANTIDAD —la presentación y el «+» de
            abajo—, si está abierta ahora y a cuánto queda (componentes/DondeLoHay). */}
        <Titular texto="¿Dónde lo hay?" />
        <DondeLoHay existencias={p.existencias} salas={p.salas} factor={elegida_factor} cantidad={cant}
          tipo={elegidaP ? nombreProducto(elegidaP.tipo) : null} superficie={superficie} />
        <Text style={{ fontSize: 13, color: colorSistema.texto3, marginHorizontal: 32, marginTop: 8 }}>
          Las existencias se actualizan cada pocos minutos; confírmalo antes de ir.
        </Text>
        {p.principio_activo ? <MismoPrincipio id={p.id} /> : null}
      </ScrollView>

      {/* Abajo, fijos: agregar al carrito (la presentación mayor) y consultar. */}
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: ins.bottom + 12, flexDirection: 'row', gap: 10 }}>
        {!p.bajo_receta && !(p.existencias ?? []).length ? (
          // No hay en ninguna sucursal: se pide por encargo (2026-10-07).
          <Presionable onPress={() => setEncargando(true)} accessibilityRole="button" accessibilityLabel="Pedir por encargo"
            style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 54, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
              backgroundColor: t.color.magenta, transform: [{ scale: pressed ? 0.97 : 1 }],
              shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } })}>
            <Icono sf="shippingbox.fill" respaldo="📦" tam={17} color="#FFFFFF" />
            <Text style={{ flexShrink: 1, textAlign: 'center', color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>Pedir por encargo</Text>
          </Presionable>
        ) : p.bajo_receta && !(p.existencias ?? []).length && conSesion ? (
          <BotonAvisame productoId={p.id} nombre={nombre} bloque />
        ) : p.bajo_receta && !(p.existencias ?? []).length ? (
          // Bajo receta y sin existencia: no se encarga desde la app (se pide con la receta en la sucursal).
          <View style={{ flex: 1, minHeight: 54, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14,
            backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colorSistema.texto2, textAlign: 'center' }}>Sin existencia: consúltalo en la sucursal</Text>
          </View>
        ) : (
          <>
            {/* 2026-11-04 (accesibilidad): los botones medían 40 × 40 —bajo los
                44 pt del dedo— y la cantidad no se anunciaba. Ahora 44 × 44, y
                para VoiceOver/TalkBack el conjunto es UN control ajustable
                («Cantidad, 2»; deslizar arriba o abajo), como el Contador del
                carrito. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 999, paddingHorizontal: 5, minHeight: 54,
              backgroundColor: t.oscuro ? '#2A2630' : '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}
              accessible accessibilityRole="adjustable" accessibilityLabel="Cantidad"
              accessibilityValue={{ min: 1, max: MAX_UNIDADES, now: cant, text: `${cant}` }}
              accessibilityActions={[{ name: 'increment', label: 'Más' }, { name: 'decrement', label: 'Menos' }]}
              onAccessibilityAction={(e) => {
                const a = e.nativeEvent.actionName;
                if (a === 'increment') setCant((c) => Math.min(MAX_UNIDADES, c + 1));
                else if (a === 'decrement') setCant((c) => Math.max(1, c - 1));
              }}>
              <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); setCant((c) => Math.max(1, c - 1)); }} disabled={cant <= 1}
                accessibilityRole="button" accessibilityLabel="Menos" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: cant <= 1 ? 0.3 : 1 }}>
                <Icono sf="minus" respaldo="−" tam={15} color={colorSistema.texto} />
              </Presionable>
              <Text style={{ fontSize: 18, fontWeight: '900', color: colorSistema.texto, minWidth: 18, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{cant}</Text>
              <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); setCant((c) => Math.min(MAX_UNIDADES, c + 1)); }} disabled={cant >= MAX_UNIDADES}
                accessibilityRole="button" accessibilityLabel="Más" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: cant >= MAX_UNIDADES ? 0.3 : 1 }}>
                <Icono sf="plus" respaldo="+" tam={15} color={colorSistema.texto} />
              </Presionable>
            </View>
            <Presionable onPress={() => agregar(elegidaP, cant)} disabled={!elegidaP} accessibilityRole="button"
              accessibilityLabel={`Agregar ${cant} al carrito por ${elegidaP ? dolares(precioFinal(elegidaP) * cant) : ''}`}
              style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 54, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
                backgroundColor: t.color.magenta, transform: [{ scale: pressed ? 0.97 : 1 }],
                shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } })}>
              <Icono sf="cart.badge.plus" respaldo="+" tam={17} color="#FFFFFF" />
              <Text style={{ flexShrink: 1, textAlign: 'center', color: '#FFFFFF', fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                Agregar{elegidaP ? ` · ${dolares(precioFinal(elegidaP) * cant)}` : ''}
              </Text>
            </Presionable>
          </>
        )}
        {/* Sin existencia y con encargo disponible: la campana va al lado. */}
        {!p.bajo_receta && !(p.existencias ?? []).length && conSesion ? <BotonAvisame productoId={p.id} nombre={nombre} /> : null}
        <Presionable onPress={consultar} accessibilityRole="button" accessibilityLabel="Consultar por WhatsApp"
          style={({ pressed }) => ({ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center',
            backgroundColor: VERDE_WHATSAPP, transform: [{ scale: pressed ? 0.94 : 1 }],
            shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } })}>
          <IconoWhatsapp tam={24} color="#FFFFFF" />
        </Presionable>
      </View>

      {encargando ? <EncargoHoja producto={p} presentacion={elegidaP} salas={p.salas} alCerrar={() => setEncargando(false)} /> : null}
      <Presionable onPress={cerrar} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cerrar"
        style={{ position: 'absolute', top: 14, right: 14, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Icono sf="xmark" respaldo="✕" tam={14} color="#FFFFFF" />
      </Presionable>
    </View>
  );
}

function Titular({ texto }) {
  return (
    // El rótulo canónico (ui.js), alineado con el texto de la lista de abajo.
    <Seccion estilo={{ marginLeft: 32, marginTop: 24, marginBottom: 8 }}>{texto}</Seccion>
  );
}
