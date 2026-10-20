// Consultar un medicamento desde el chat (2026-10-13), aparte de
// componentes/ChatPiezas.js para que se lea. Pedido del usuario: «que permita
// consultar de un medicamento, agrégale funciones que consideres necesarias».
//
//   · `BuscadorProducto`: la hoja para elegir un producto del catálogo (la
//     misma búsqueda de la Tienda, acción `catalogo`), con los vistos
//     recientemente mientras no se escribe nada.
//   · `ProductoPendiente`: la tarjeta del producto elegido sobre la barra para
//     escribir, con ✕ — como «Respondiendo a…». Se envía junto con el texto.
//   · `TarjetaProducto`: el producto dentro de la conversación, con foto,
//     nombre, precio y «Ver producto» / «Reservar». El servidor arma el nombre
//     y el precio (nunca los del teléfono).
//   · `Sugerencias`: los atajos sobre la barra con la conversación vacía o
//     después de la respuesta automática.
//   · `Calificar`: «¿Cómo te atendimos?» cuando el equipo resolvió la consulta.
//   · `TextoConEnlaces`: enlaces, correos y teléfonos de un mensaje, tocables.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Presionable from './Presionable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import FotoProducto from './FotoProducto';
import { colorSistema } from './sistema';
import { copiar } from './ChatPiezas';
import { llamar } from '../lib/api';
import { dolares } from '../lib/formato';
import { leerVistos, nombreProducto } from '../lib/catalogo';
import { datosDePrecio, mayoreoSoloEnCaja, precioFinal } from '../lib/precioTuyo';
import { useCarrito } from '../lib/carrito';
import { seguirSiYaReservado } from '../lib/reservaDuplicada';
import { navegar } from '../lib/navegar';
import { suave, useTema } from '../tema/tema';

const IOS = Platform.OS === 'ios';
const vibrar = () => Haptics.selectionAsync().catch(() => {});

// ── Elegir un producto ──────────────────────────────────────────────────
export function BuscadorProducto({ visible, titulo = 'Consultar un producto', alElegir, alCerrar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const [texto, setTexto] = useState('');
  const [lista, setLista] = useState(null);
  const [vistos, setVistos] = useState([]);
  const [error, setError] = useState(false);
  const pedido = useRef(0);
  useEffect(() => {
    if (!visible) return;
    setTexto(''); setLista(null); setError(false);
    leerVistos().then((v) => setVistos(Array.isArray(v) ? v : []));
  }, [visible]);
  // La búsqueda sale 300 ms después de la última tecla, como en la Tienda.
  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) { setLista(null); return undefined; }
    const id = setTimeout(async () => {
      const n = ++pedido.current;
      setError(false);
      const r = await llamar('catalogo', { q, desde: 0, limite: 30, ...datosDePrecio() });
      if (n !== pedido.current) return; // llegó tarde: ya se pidió otra cosa
      if (!r?.ok) { setError(true); setLista([]); return; }
      setLista(r.productos ?? []);
    }, 300);
    return () => clearTimeout(id);
  }, [texto]);

  const buscando = texto.trim().length >= 2;
  const datos = buscando ? (lista ?? []) : vistos;
  const elegir = (p) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // El precio de viñeta, el mismo que pone el servidor en la tarjeta enviada.
    alElegir({ id: Number(p.id), nombre: p.nombre, foto: p.foto ?? null, precio: p.precio ?? null });
  };
  const fondo = IOS ? (t.oscuro ? '#1C1C1E' : '#F2F2F7') : (t.oscuro ? '#121016' : '#F5F4F8');
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={IOS ? 'pageSheet' : 'fullScreen'} onRequestClose={alCerrar}>
      <View style={{ flex: 1, backgroundColor: fondo, paddingTop: IOS ? 0 : ins.top }}>
        {/* La barra de la hoja: Cancelar a la izquierda y el título al centro, como en iOS. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 8 }}>
          <Presionable onPress={alCerrar} accessibilityRole="button" hitSlop={8} style={{ minWidth: 88, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
            <Text style={{ fontSize: 17, color: t.color.magentaTexto }}>Cancelar</Text>
          </Presionable>
          <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>{titulo}</Text>
          <View style={{ minWidth: 88 }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginBottom: 8, minHeight: 40, borderRadius: IOS ? 10 : 28,
          paddingHorizontal: 10, backgroundColor: t.oscuro ? 'rgba(118,118,128,0.24)' : 'rgba(118,118,128,0.12)' }}>
          <Icono sf="magnifyingglass" respaldo="🔍" tam={16} color={colorSistema.texto3} />
          <TextInput value={texto} onChangeText={setTexto} autoFocus placeholder="Busca por nombre o principio activo" placeholderTextColor={colorSistema.placeholder}
            returnKeyType="search" clearButtonMode="while-editing" autoCorrect={false} accessibilityLabel="Buscar un producto"
            style={{ flex: 1, fontSize: 17, color: colorSistema.texto, paddingVertical: 8 }} />
        </View>
        <FlatList
          data={datos}
          keyExtractor={(p) => String(p.id)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: ins.bottom + 24 }}
          ListHeaderComponent={!buscando && vistos.length ? (
            <Text style={{ fontSize: 13, fontWeight: '600', textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 16, marginTop: 12, marginBottom: 6 }}>Vistos recientemente</Text>
          ) : null}
          ListEmptyComponent={(
            <View style={{ alignItems: 'center', gap: 8, paddingTop: 48, paddingHorizontal: 24 }}>
              {buscando && lista == null ? <ActivityIndicator /> : (
                <>
                  <Icono sf={buscando ? 'magnifyingglass' : 'pills.fill'} respaldo="💊" tam={30} color={colorSistema.texto3} />
                  <Text style={{ fontSize: 15, lineHeight: 21, textAlign: 'center', color: colorSistema.texto2 }}>
                    {error ? 'No se pudo buscar. Revisa tu conexión.'
                      : buscando ? 'No encontramos ese producto. Igual puedes escribirnos su nombre y lo buscamos por ti.'
                        : 'Escribe el nombre del medicamento que quieres consultar.'}
                  </Text>
                </>
              )}
            </View>
          )}
          renderItem={({ item: p, index: i }) => (
            <Presionable onPress={() => elegir(p)} accessibilityRole="button"
              accessibilityLabel={`${nombreProducto(p.nombre)}${p.precio != null ? `, ${dolares(precioFinal(p))}` : ''}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 64,
                backgroundColor: pressed ? (t.oscuro ? '#3A3A3C' : '#E5E5EA') : (t.oscuro ? '#2C2C2E' : '#FFFFFF'),
                borderTopLeftRadius: i === 0 ? 12 : 0, borderTopRightRadius: i === 0 ? 12 : 0,
                borderBottomLeftRadius: i === datos.length - 1 ? 12 : 0, borderBottomRightRadius: i === datos.length - 1 ? 12 : 0,
                borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: colorSistema.separador })}>
              <View style={{ width: 48 }}><FotoProducto id={p.id} nombre={p.nombre} foto={p.foto} alto={48} radio={10} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 16, color: colorSistema.texto }} numberOfLines={2}>{nombreProducto(p.nombre)}</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  {p.precio != null ? <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{dolares(precioFinal(p))}</Text> : null}
                  {p.bajo_receta ? <Text style={{ fontSize: 12, fontWeight: '700', color: t.color.magentaTexto }}>Bajo Receta</Text> : null}
                  {p.disponible === false ? <Text style={{ fontSize: 12, color: colorSistema.texto3 }}>Sin existencia</Text> : null}
                </View>
              </View>
              <Icono sf="plus.circle.fill" respaldo="+" tam={24} color={t.color.magenta} />
            </Presionable>
          )}
        />
      </View>
    </Modal>
  );
}

// ── El producto elegido, sobre la barra ─────────────────────────────────
export function ProductoPendiente({ p, alQuitar }) {
  const t = useTema();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 12, paddingRight: 4, paddingTop: 8 }}
      accessible accessibilityLabel={`Vas a consultar por ${nombreProducto(p.nombre)}`}>
      <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: t.color.magenta }} />
      <View style={{ width: 40 }}><FotoProducto id={p.id} nombre={p.nombre} foto={p.foto} alto={40} radio={8} /></View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }}>Consultar por este producto</Text>
        <Text style={{ fontSize: 14, color: colorSistema.texto2 }} numberOfLines={1}>
          {nombreProducto(p.nombre)}{p.precio != null ? ` · ${dolares(p.precio)}` : ''}
        </Text>
      </View>
      <Presionable onPress={alQuitar} accessibilityRole="button" accessibilityLabel="Quitar el producto" hitSlop={6}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icono sf="xmark.circle.fill" respaldo="✕" tam={20} color={colorSistema.texto3} />
      </Presionable>
    </View>
  );
}

// «Reservar» desde la tarjeta: la presentación mayor al carrito, como el botón
// de la ficha. Sin existencia (o si algo no cuadra) se abre la ficha.
async function reservar(id) {
  const r = await llamar('catalogo_producto', { id: Number(id), ...datosDePrecio() });
  if (!r?.ok) { Alert.alert('No se pudo abrir', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
  const p = r.producto;
  const pres = mayoreoSoloEnCaja(p.presentaciones);
  const mayor = [...(pres ?? [])].sort((a, b) => (b.factor ?? 1) - (a.factor ?? 1))[0];
  if (!mayor || !(p.existencias ?? []).length) { navegar(`/producto/${id}`); return; }
  const seguir = await seguirSiYaReservado(p.id, { alVer: (x) => navegar(`/reservas?resaltar=${x.id}`) });
  if (!seguir) return;
  const ok = useCarrito.getState().agregar({ id: p.id, nombre: p.nombre, foto: p.foto, tipo: mayor.tipo, factor: mayor.factor ?? 1, precio: mayor.precio,
    precio_vip: mayor.precio_vip, precio_tuyo: mayor.precio_tuyo ?? null, precio_tuyo_nombre: mayor.precio_tuyo_nombre ?? null,
    factor_mayor: mayor.factor_mayor ?? null, receta: !!p.bajo_receta }, 1);
  if (!ok) { Alert.alert('Carrito lleno', 'El carrito admite hasta 10 productos distintos.'); return; }
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  Alert.alert('Agregado al carrito', `${nombreProducto(p.nombre)} · ${nombreProducto(mayor.tipo)}`, [
    { text: 'Seguir en el chat', style: 'cancel' },
    { text: 'Ir al carrito', onPress: () => navegar('/carrito') },
  ]);
}

// ── El producto dentro de la conversación ───────────────────────────────
export function TarjetaProducto({ a, mio }) {
  const t = useTema();
  const [ocupado, setOcupado] = useState(false);
  const nombre = nombreProducto(a.nombre);
  const fondo = t.oscuro ? '#2C2C2E' : '#FFFFFF';
  const ver = () => { vibrar(); navegar(`/producto/${a.id}`); };
  const alReservar = async () => {
    if (ocupado) return;
    vibrar();
    setOcupado(true);
    try { await reservar(a.id); } finally { setOcupado(false); }
  };
  return (
    <View style={{ width: 248, borderRadius: 18, overflow: 'hidden', backgroundColor: fondo,
      borderWidth: StyleSheet.hairlineWidth, borderColor: mio ? suave(t.color.magenta, 0.6) : (t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)') }}>
      <Presionable onPress={ver} accessibilityRole="button" accessibilityLabel={`${nombre}${a.precio != null ? `, desde ${dolares(a.precio)}` : ''}. Ver producto`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, opacity: pressed ? 0.75 : 1 })}>
        <View style={{ width: 56 }}><FotoProducto id={a.id} nombre={a.nombre} foto={a.foto} alto={56} radio={12} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.4, color: colorSistema.texto3 }}>PRODUCTO</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }} numberOfLines={2}>{nombre}</Text>
          {a.precio != null ? <Text style={{ fontSize: 14, fontWeight: '800', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(a.precio)}</Text> : null}
        </View>
      </Presionable>
      <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colorSistema.separador }}>
        <Presionable onPress={ver} accessibilityRole="button" accessibilityLabel={`Ver ${nombre}`}
          style={({ pressed }) => ({ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? suave(t.color.magenta, 0.1) : 'transparent' })}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: t.color.magentaTexto }}>Ver producto</Text>
        </Presionable>
        <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colorSistema.separador }} />
        <Presionable onPress={alReservar} disabled={ocupado} accessibilityRole="button" accessibilityLabel={`Reservar ${nombre}`}
          style={({ pressed }) => ({ flex: 1, minHeight: 44, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? suave(t.color.magenta, 0.1) : 'transparent' })}>
          {ocupado ? <ActivityIndicator size="small" /> : <Icono sf="cart.badge.plus" respaldo="+" tam={15} color={t.color.magentaTexto} />}
          <Text style={{ fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>Reservar</Text>
        </Presionable>
      </View>
    </View>
  );
}

// ── Atajos para empezar ─────────────────────────────────────────────────
// `accion`: 'producto' abre el buscador y deja la pregunta escrita; 'escribir'
// la deja en la barra para completarla; 'enviar' la manda tal cual.
export const SUGERENCIAS = [
  { texto: '¿Tienen este medicamento?', sf: 'pills.fill', accion: 'producto', mensaje: '¿Tienen disponible este medicamento?' },
  { texto: '¿Necesita receta?', sf: 'doc.text.fill', accion: 'producto', mensaje: '¿Este medicamento necesita receta?' },
  { texto: 'Precio de un producto', sf: 'tag.fill', accion: 'producto', mensaje: '¿Qué precio tiene este producto?' },
  { texto: 'Horario y sucursales', sf: 'clock', accion: 'enviar', mensaje: '¿Cuál es su horario y dónde quedan sus sucursales?' },
  { texto: 'Estado de mi reserva', sf: 'bag.fill', accion: 'enviar', mensaje: 'Quiero saber el estado de mi reserva.' },
];

// Respuestas sugeridas (2026-10-20, «como las apps de mensajería»): después
// de un mensaje del equipo, dos a cuatro respuestas de un toque según lo que
// dijo — una pregunta, una receta, una reserva, un precio, si lo hay —, como
// las respuestas inteligentes de Gmail o Mensajes. Es una lista de reglas
// sencillas sobre el texto (sin servidor): lo que no reconoce, «Gracias».
const sinTildes = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const enviar = (texto, sf = 'arrowshape.turn.up.left.fill') => ({ texto, mensaje: texto, accion: 'enviar', sf });
export function respuestasSugeridas(m) {
  if (!m || m.autor !== 'equipo') return [];
  const t = sinTildes(m.texto);
  const out = [];
  if (/receta|foto|imagen/.test(t)) out.push({ texto: 'Te mando la foto', accion: 'foto', sf: 'camera.fill' });
  if (/reserv|apart|guard/.test(t)) out.push(enviar('Sí, resérvalo'), enviar('¿Hasta cuándo me lo guardan?'));
  if (/\$|precio|cuesta|vale|costo/.test(t)) out.push(enviar('¿Hay genérico más barato?'), enviar('Perfecto, lo voy a pedir'));
  if (/tenemos|hay |disponib|existencia|sucursal|sala/.test(t)) out.push(enviar('¿En qué sucursal?'), enviar('Paso a traerlo'));
  if (m.adjunto?.tipo === 'producto') out.push(enviar('¿Necesita receta?'));
  if (/\?\s*$/.test(String(m.texto ?? '').trim()) && out.length < 2) out.push(enviar('Sí'), enviar('No'));
  out.push(enviar('Gracias 🙏'));
  const vistos = new Set();
  return out.filter((x) => (vistos.has(x.texto) ? false : vistos.add(x.texto))).slice(0, 4);
}

export function Sugerencias({ alElegir, lista = SUGERENCIAS }) {
  const t = useTema();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 }}
      accessibilityLabel="Preguntas frecuentes">
      {lista.map((s) => (
        <Presionable key={s.texto} onPress={() => { vibrar(); alElegir(s); }} accessibilityRole="button"
          accessibilityHint={s.accion === 'enviar' ? 'Lo envía' : s.accion === 'foto' ? 'Elige la foto' : 'Elige el producto'}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: 18,
            backgroundColor: pressed ? suave(t.color.magenta, t.oscuro ? 0.35 : 0.2) : (t.oscuro ? 'rgba(255,255,255,0.1)' : '#FFFFFF'),
            borderWidth: StyleSheet.hairlineWidth, borderColor: suave(t.color.magenta, 0.5) })}>
          <Icono sf={s.sf} respaldo="" tam={14} color={t.color.magentaTexto} />
          <Text style={{ fontSize: 15, fontWeight: '600', color: t.color.magentaTexto }}>{s.texto}</Text>
        </Presionable>
      ))}
    </ScrollView>
  );
}

// ── «¿Cómo te atendimos?» ───────────────────────────────────────────────
const NOTAS = ['Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'];
export function Calificar({ alEnviar, alCerrar }) {
  const t = useTema();
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [gracias, setGracias] = useState(false);
  const enviar = async () => {
    if (!nota || enviando) return;
    setEnviando(true);
    const ok = await alEnviar(nota, comentario.trim());
    setEnviando(false);
    if (ok) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); setGracias(true); setTimeout(alCerrar, 2200); }
  };
  const marco = { alignSelf: 'center', width: '92%', maxWidth: 380, marginTop: 16, marginBottom: 4, borderRadius: 18, padding: 16, gap: 12,
    backgroundColor: t.oscuro ? '#2C2C2E' : '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' };
  if (gracias) {
    return (
      <View style={[marco, { alignItems: 'center' }]} accessible accessibilityLiveRegion="polite">
        <Icono sf="heart.fill" respaldo="❤" tam={24} color={t.color.magenta} />
        <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto, textAlign: 'center' }}>¡Gracias por tu opinión!</Text>
      </View>
    );
  }
  return (
    <View style={marco}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>¿Cómo te atendimos?</Text>
          <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>Tu opinión nos ayuda a atenderte mejor.</Text>
        </View>
        <Presionable onPress={alCerrar} accessibilityRole="button" accessibilityLabel="Ahora no" hitSlop={8}
          style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <Icono sf="xmark" respaldo="✕" tam={13} color={colorSistema.texto3} />
        </Presionable>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Presionable key={n} onPress={() => { vibrar(); setNota(n); }} accessibilityRole="radio" accessibilityState={{ checked: nota === n }}
            accessibilityLabel={`${n} ${n === 1 ? 'estrella' : 'estrellas'}, ${NOTAS[n - 1]}`}
            style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.88 : 1 }] })}>
            <Icono sf={n <= nota ? 'star.fill' : 'star'} respaldo={n <= nota ? '★' : '☆'} tam={32} color={n <= nota ? '#F5A623' : colorSistema.texto3} />
          </Presionable>
        ))}
      </View>
      {nota ? (
        <>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto2, textAlign: 'center', marginTop: -4 }}>{NOTAS[nota - 1]}</Text>
          <TextInput value={comentario} onChangeText={(v) => setComentario(v.slice(0, 500))} placeholder="Cuéntanos más (opcional)"
            placeholderTextColor={colorSistema.placeholder} multiline accessibilityLabel="Comentario opcional"
            style={{ minHeight: 64, maxHeight: 120, borderRadius: 12, padding: 10, fontSize: 16, color: colorSistema.texto, textAlignVertical: 'top',
              backgroundColor: t.oscuro ? 'rgba(118,118,128,0.24)' : 'rgba(118,118,128,0.12)' }} />
          <Presionable onPress={enviar} disabled={enviando} accessibilityRole="button" accessibilityLabel="Enviar calificación"
            style={({ pressed }) => ({ minHeight: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.magenta,
              opacity: enviando ? 0.6 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            {enviando ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>Enviar</Text>}
          </Presionable>
        </>
      ) : null}
    </View>
  );
}

// ── Enlaces y teléfonos tocables ────────────────────────────────────────
// URL, «www.…», correo o un teléfono de El Salvador (8 dígitos que empiezan en
// 2, 6 o 7, con o sin +503 y guion). Un teléfono pegado a otros dígitos (un
// código, un monto) no cuenta.
const PATRON = /(https?:\/\/[^\s]+|www\.[^\s]+\.[^\s]+|[\w.+-]+@[\w-]+\.[\w.-]+|\+?(?:503[\s-]?)?[267]\d{3}[\s-]?\d{4})/g;
function partir(texto) {
  const partes = [];
  let desde = 0;
  for (const m of String(texto).matchAll(PATRON)) {
    let v = m[0];
    const i = m.index;
    const tipo = /^https?:|^www\./i.test(v) ? 'url' : v.includes('@') ? 'correo' : 'tel';
    if (tipo === 'tel' && (/\d/.test(texto[i - 1] ?? '') || /\d/.test(texto[i + v.length] ?? ''))) continue;
    // La puntuación final («…mira www.x.com.») no es parte del enlace.
    const sobra = v.match(/[.,;:!?)»"']+$/)?.[0] ?? '';
    if (sobra) v = v.slice(0, -sobra.length);
    if (i > desde) partes.push({ texto: texto.slice(desde, i) });
    partes.push({ texto: v, tipo });
    desde = i + v.length;
  }
  if (desde < texto.length) partes.push({ texto: texto.slice(desde) });
  return partes;
}

function abrirTelefono(v) {
  const digitos = v.replace(/\D/g, '').replace(/^503(?=\d{8}$)/, '');
  const opciones = [`Llamar al ${v}`, 'Copiar', 'Cancelar'];
  const elegir = (i) => {
    if (i === 0) Linking.openURL(`tel:${digitos}`).catch(() => {});
    if (i === 1 && copiar(v)) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };
  if (Platform.OS === 'web') { Linking.openURL(`tel:${digitos}`).catch(() => {}); return; }
  ActionSheetIOS.showActionSheetWithOptions({ options: opciones, cancelButtonIndex: 2, title: v }, elegir);
}

export function TextoConEnlaces({ texto, color, colorEnlace, estilo }) {
  // Las expresiones regulares corren una vez por texto, no en cada dibujo.
  const partes = useMemo(() => partir(texto ?? ''), [texto]);
  const tocar = (p) => {
    vibrar();
    if (p.tipo === 'url') Linking.openURL(/^https?:/i.test(p.texto) ? p.texto : `https://${p.texto}`).catch(() => {});
    else if (p.tipo === 'correo') Linking.openURL(`mailto:${p.texto}`).catch(() => {});
    else abrirTelefono(p.texto);
  };
  return (
    <Text style={[{ color }, estilo]}>
      {partes.map((p, i) => (p.tipo ? (
        <Text key={i} onPress={() => tocar(p)} accessibilityRole="link" suppressHighlighting={false}
          style={{ color: colorEnlace, textDecorationLine: 'underline' }}>{p.texto}</Text>
      ) : p.texto))}
    </Text>
  );
}
