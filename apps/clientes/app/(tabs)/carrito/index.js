// El carrito (2026-10-07): lo que el cliente agregó desde el catálogo, con el
// precio VIP, en qué sucursal está TODO, y «Reservar para retirar». Al
// reservar, la sucursal recibe el aviso para tenerlo listo y el cliente un
// código (QR) que la sala escanea para prepararlo y facturarlo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { errorFiscal, nitEscrito, nrcEscrito } from '../../../lib/fiscal';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { Pantalla, Tarjeta, Texto, Vacio, Boton } from '../../../componentes/ui';
import { colorSistema } from '../../../componentes/sistema';
import Icono from '../../../componentes/Icono';
import FotoProducto from '../../../componentes/FotoProducto';
import CodigoReserva from '../../../componentes/CodigoReserva';
import { useCarrito, MAX_UNIDADES } from '../../../lib/carrito';
import { useCuenta } from '../../../lib/cuenta';
import { useSesion } from '../../../lib/sesion';
import { dolares } from '../../../lib/formato';
import { nombreProducto } from '../../../lib/catalogo';
import { suave, useTema } from '../../../tema/tema';
import { navegar } from '../../../lib/navegar';

const CLAVE_TERMINOS = 'puntos_salud_terminos_reserva';

export default function Carrito() {
  const t = useTema();
  const items = useCarrito((s) => s.items);
  const { cantidad, quitar, vaciar } = useCarrito.getState();
  const pedir = useSesion((s) => s.pedir);
  const pendiente = useCuenta((s) => !!s.resumen?.pendiente);
  const [salas, setSalas] = useState(null);
  const [sala, setSala] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [terminos, setTerminos] = useState(null);
  const [hecho, setHecho] = useState(null);
  // Cómo paga y qué documento quiere (2026-10-07).
  const [pago, setPago] = useState('en_linea');
  const [documento, setDocumento] = useState('consumidor_final');
  const [fiscales, setFiscales] = useState(null);       // { completos, datos } de la ficha
  const [editarFiscales, setEditarFiscales] = useState(false);
  const [f, setF] = useState({ nombre: '', nit: '', nrc: '', giro: '', direccion: '' });
  useEffect(() => {
    if (documento !== 'credito_fiscal' || fiscales) return;
    pedir('mis_datos_fiscales').then((r) => {
      if (!r?.ok) return;
      setFiscales(r);
      setF({ nombre: r.datos.nombre ?? '', nit: r.datos.nit ?? '', nrc: r.datos.nrc ?? '', giro: r.datos.giro ?? '', direccion: r.datos.direccion ?? '' });
      setEditarFiscales(!r.completos);
    });
  }, [documento, fiscales, pedir]);
  const problemaFiscal = documento === 'credito_fiscal' ? errorFiscal(f) : null;
  // A la sucursal elegida le falta algo: no se cobra; se envía para confirmar.
  const faltan = salas?.find((x) => x.id === sala)?.faltan ?? 0;
  const pagoReal = faltan ? 'al_retirar' : pago;

  // Dónde hay de cada producto: se vuelve a preguntar al entrar y si cambia el carrito.
  const ids = useMemo(() => [...new Set(items.map((x) => x.id))].sort().join(','), [items]);
  const cargarSalas = useCallback(async () => {
    if (!ids) { setSalas([]); return; }
    const r = await pedir('carrito_existencias', { ids: ids.split(',').map(Number) });
    if (!r?.ok) { setSalas(null); return; }
    const hay = new Map();
    for (const e of r.existencias) hay.set(`${e.product_id}|${e.branch_id}`, Number(e.cantidad));
    const lista = r.salas.map((s) => {
      // «Hay» o no: las existencias no dicen en qué presentación están contadas.
      const faltan = items.filter((x) => (hay.get(`${x.id}|${s.id}`) ?? 0) <= 0).length;
      return { ...s, faltan };
    }).sort((a, b) => a.faltan - b.faltan);
    setSalas(lista);
    setSala((ant) => ant ?? lista[0]?.id ?? null);
  }, [ids, pedir]); // eslint-disable-line react-hooks/exhaustive-deps -- `items` se lee en el momento
  useFocusEffect(useCallback(() => { cargarSalas(); }, [cargarSalas]));

  const normal = items.reduce((s, x) => s + x.precio * x.cantidad, 0);
  const total = items.reduce((s, x) => s + (x.precio_vip ?? x.precio) * x.cantidad, 0);

  const reservar = async () => {
    if (enviando || !sala) return;
    if (problemaFiscal) { Alert.alert('Faltan datos del crédito fiscal', problemaFiscal); return; }
    if (pendiente) { Alert.alert('Falta completar tu registro', 'Completa tu registro en cualquier sucursal para reservar.'); return; }
    // Las condiciones, una vez (las mismas de las reservas de ofertas).
    const [term, aceptada] = await Promise.all([pedir('reserva_terminos'), SecureStore.getItemAsync(CLAVE_TERMINOS).catch(() => null)]);
    if (!term?.ok) { Alert.alert('No se pudo reservar', 'Revisa tu conexión e intenta de nuevo.'); return; }
    if (aceptada !== term.version) { setTerminos(term); return; }
    enviar(term.version);
  };

  const enviar = async (version) => {
    setTerminos(null);
    setEnviando(true);
    const r = await pedir('reservar_carrito', {
      branch_id: sala, acepta_terminos: version, pago: pagoReal, documento,
      datos_fiscales: documento === 'credito_fiscal' ? f : null,
      items: items.map((x) => ({ producto_id: x.id, factor: x.factor, cantidad: x.cantidad })),
    });
    setEnviando(false);
    if (!r?.ok) { Alert.alert('No se pudo reservar', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
    vaciar();
    const base = { pedido: r.pedido, total: r.total, sala: salas?.find((s) => s.id === sala)?.sala, pagado: false, enLinea: pagoReal === 'en_linea', porConfirmar: faltan > 0 };
    // Pagar en línea: la hoja de Wompi; el pago lo confirma el servidor.
    if (pagoReal === 'en_linea' && r.pago?.url) {
      await WebBrowser.openAuthSessionAsync(r.pago.url, 'puntossalud://reservas');
      for (let i = 0; i < 4; i++) {
        const mr = await pedir('mis_reservas');
        const delPedido = (mr?.reservas ?? []).filter((x) => x.pedido === r.pedido);
        if (delPedido.length && delPedido.every((x) => x.pago_estado === 'pagado')) { base.pagado = true; break; }
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    } else if (pagoReal === 'en_linea') {
      Alert.alert('El pago en línea no está disponible', 'Tu pedido quedó reservado: lo pagas al retirar o desde Mis reservas.');
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setHecho(base);
  };

  if (hecho) {
    return (
      <Pantalla>
        <Tarjeta estilo={{ alignItems: 'center', gap: 14, paddingVertical: 26 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.verde, 0.25) }}>
            <Icono sf="checkmark" respaldo="✓" tam={26} color={t.color.verdeTexto} />
          </View>
          <Text style={{ fontSize: 22, fontWeight: '900', color: colorSistema.texto }}>¡Pedido reservado!</Text>
          <Texto nivel={2} estilo={{ textAlign: 'center' }}>
            {hecho.porConfirmar
              ? `${hecho.sala ?? 'La sucursal'} recibió tu pedido y va a confirmar los productos que no tenía a la mano. Te avisamos; pagas al retirar.`
              : `${hecho.sala ?? 'La sucursal'} ya recibió tu pedido y lo va a preparar. Te avisamos cuando esté listo.`}
          </Texto>
          <CodigoReserva codigo={hecho.pedido} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>
            Total: {dolares(hecho.total)} · {hecho.pagado ? 'pagado' : hecho.enLinea ? 'pago pendiente (puedes pagarlo en Mis reservas)' : 'pagas al retirar'}
          </Text>
        </Tarjeta>
        <Boton alTocar={() => { setHecho(null); navegar('/reservas'); }}>Ver mis reservas</Boton>
        <Boton tipo="secundario" alTocar={() => setHecho(null)}>Seguir comprando</Boton>
      </Pantalla>
    );
  }

  if (!items.length) {
    return (
      <Pantalla>
        <Vacio titulo="Tu carrito está vacío">Agrega productos desde el catálogo y resérvalos para retirar en la sucursal que prefieras.</Vacio>
        <Boton alTocar={() => navegar('/catalogo')}>Ver el catálogo</Boton>
      </Pantalla>
    );
  }

  return (
    <Pantalla>
      {items.map((x) => (
        <Tarjeta key={`${x.id}|${x.factor}`} estilo={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ width: 64 }}><FotoProducto id={x.id} nombre={x.nombre} foto={x.foto} alto={64} radio={14} /></View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }} numberOfLines={2}>{nombreProducto(x.nombre)}</Text>
            <Text style={{ fontSize: 12, color: colorSistema.texto3 }}>{nombreProducto(x.tipo || 'Unidad')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Contador valor={x.cantidad} alCambiar={(n) => cantidad(x, n)} />
              <View style={{ alignItems: 'flex-end' }}>
                {x.precio_vip != null ? <Text style={{ fontSize: 12, color: colorSistema.texto3, textDecorationLine: 'line-through' }}>{dolares(x.precio * x.cantidad)}</Text> : null}
                <Text style={{ fontSize: 17, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares((x.precio_vip ?? x.precio) * x.cantidad)}</Text>
              </View>
            </View>
          </View>
          <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); quitar(x); }} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Quitar ${x.nombre}`}
            style={{ alignSelf: 'flex-start', padding: 4 }}>
            <Icono sf="xmark.circle.fill" respaldo="✕" tam={20} color={colorSistema.texto3} />
          </Pressable>
        </Tarjeta>
      ))}

      {/* Dónde retirar: primero la sucursal que tiene todo. */}
      <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4, marginTop: 6 }}>
        Retirar en
      </Text>
      <Tarjeta estilo={{ padding: 0, gap: 0 }}>
        {salas == null ? <ActivityIndicator style={{ margin: 18 }} /> : salas.map((s, i) => {
          const elegida = s.id === sala;
          return (
            <Pressable key={s.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setSala(s.id); }} accessibilityRole="radio" accessibilityState={{ selected: elegida }}>
              {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 50 }} /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 52 }}>
                <Icono sf={elegida ? 'checkmark.circle.fill' : 'circle'} respaldo="" tam={22} color={elegida ? t.color.magenta : colorSistema.texto3} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: elegida ? '700' : '500', color: colorSistema.texto }}>{s.sala}</Text>
                  <Text style={{ fontSize: 12, color: s.faltan ? t.color.avisoTexto : t.color.exitoTexto }}>
                    {s.faltan ? `Le ${s.faltan === 1 ? 'falta 1 producto' : `faltan ${s.faltan} productos`}: puede tardar más` : 'Tiene todo'}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </Tarjeta>

      {/* Cómo pagas. */}
      <Seccion texto="Cómo pagas" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Opcion sf="creditcard.fill" titulo="En línea ahora" detalle={faltan ? 'No disponible: falta existencia' : 'Tarjeta, seguro con Wompi'}
          elegida={pagoReal === 'en_linea'} deshabilitada={faltan > 0} alTocar={() => setPago('en_linea')} />
        <Opcion sf="banknote.fill" titulo="Al retirar" detalle="Efectivo o tarjeta en caja" elegida={pagoReal === 'al_retirar'} alTocar={() => setPago('al_retirar')} />
      </View>
      {faltan ? (
        <Texto nivel={2} estilo={{ fontSize: 13, marginHorizontal: 4 }}>
          A esta sucursal le {faltan === 1 ? 'falta 1 producto' : `faltan ${faltan} productos`}: la sucursal te confirma antes de cobrar. Si prefieres pagar ahora, elige una sucursal que tenga todo.
        </Texto>
      ) : null}

      {/* Qué documento quieres. */}
      <Seccion texto="Documento" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Opcion sf="doc.text.fill" titulo="Consumidor final" detalle="Factura normal" elegida={documento === 'consumidor_final'} alTocar={() => setDocumento('consumidor_final')} />
        <Opcion sf="building.2.fill" titulo="Crédito fiscal" detalle="Para tu negocio (CCF)" elegida={documento === 'credito_fiscal'} alTocar={() => setDocumento('credito_fiscal')} />
      </View>
      {documento === 'credito_fiscal' ? (
        <Tarjeta estilo={{ gap: 10 }}>
          {!fiscales ? <ActivityIndicator /> : !editarFiscales ? (
            <>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>{f.nombre}</Text>
              <Texto nivel={2} estilo={{ fontSize: 14 }}>NIT {f.nit} · NRC {f.nrc}</Texto>
              <Texto nivel={2} estilo={{ fontSize: 14 }}>{f.giro}</Texto>
              <Texto nivel={3} estilo={{ fontSize: 13 }}>{f.direccion}</Texto>
              <Pressable onPress={() => setEditarFiscales(true)} accessibilityRole="button" style={{ minHeight: 40, justifyContent: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.texto }}>Usar otros datos</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Texto nivel={2} estilo={{ fontSize: 13 }}>
                {fiscales.completos ? 'Escribe los datos del contribuyente.' : 'Tu ficha no tiene los datos completos del crédito fiscal. Escríbelos como aparecen en tu tarjeta de IVA:'}
              </Texto>
              <Campo etiqueta="Nombre o razón social" valor={f.nombre} alCambiar={(v) => setF((x) => ({ ...x, nombre: v }))} />
              <Campo etiqueta="NIT" valor={f.nit} teclado="number-pad" alCambiar={(v) => setF((x) => ({ ...x, nit: nitEscrito(v) }))} />
              <Campo etiqueta="NRC" valor={f.nrc} teclado="number-pad" alCambiar={(v) => setF((x) => ({ ...x, nrc: nrcEscrito(v) }))} />
              <Campo etiqueta="Actividad económica (giro)" valor={f.giro} alCambiar={(v) => setF((x) => ({ ...x, giro: v }))} />
              <Campo etiqueta="Dirección" valor={f.direccion} alCambiar={(v) => setF((x) => ({ ...x, direccion: v }))} multilinea />
              {problemaFiscal ? <Text style={{ fontSize: 13, color: t.color.avisoTexto }}>{problemaFiscal}</Text>
                : <Text style={{ fontSize: 13, color: t.color.exitoTexto }}>✓ Datos completos</Text>}
            </>
          )}
        </Tarjeta>
      ) : null}

      <Tarjeta estilo={{ gap: 6 }}>
        <Fila etiqueta="Precio normal" valor={dolares(normal)} tachado />
        {normal - total >= 0.01 ? <Fila etiqueta="Ahorro con tu tarjeta" valor={`−${dolares(normal - total)}`} color={t.color.verdeTexto} /> : null}
        <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginVertical: 4 }} />
        <Fila etiqueta="Total" valor={dolares(total)} grande />
        <Texto nivel={3} estilo={{ fontSize: 12 }}>El precio se confirma al reservar. La sucursal recibe tu pedido al instante y te avisamos cuando esté listo.</Texto>
      </Tarjeta>

      <Boton alTocar={reservar} cargando={enviando} deshabilitado={!sala || !!problemaFiscal}>
        {faltan ? 'Enviar para confirmar' : pagoReal === 'en_linea' ? `Pagar ${dolares(total)}` : 'Reservar · pagar al retirar'}
      </Boton>

      <Modal visible={!!terminos} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTerminos(null)}>
        <Terminos terminos={terminos} alAceptar={async () => {
          await SecureStore.setItemAsync(CLAVE_TERMINOS, terminos.version).catch(() => {});
          enviar(terminos.version);
        }} alCerrar={() => setTerminos(null)} />
      </Modal>
    </Pantalla>
  );
}

function Fila({ etiqueta, valor, tachado, grande, color }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Text style={{ fontSize: grande ? 17 : 15, fontWeight: grande ? '800' : '500', color: colorSistema.texto2 }}>{etiqueta}</Text>
      <Text style={{ fontSize: grande ? 24 : 15, fontWeight: grande ? '900' : '600', color: color ?? colorSistema.texto,
        textDecorationLine: tachado ? 'line-through' : 'none', fontVariant: ['tabular-nums'] }}>{valor}</Text>
    </View>
  );
}

function Contador({ valor, alCambiar }) {
  const t = useTema();
  const boton = (sf, n, habilitado) => (
    <Pressable onPress={() => { if (!habilitado) return; Haptics.selectionAsync().catch(() => {}); alCambiar(n); }} disabled={!habilitado}
      accessibilityRole="button" accessibilityLabel={sf === 'minus' ? 'Menos' : 'Más'} hitSlop={6}
      style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', opacity: habilitado ? 1 : 0.35,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' }}>
      <Icono sf={sf} respaldo={sf === 'minus' ? '−' : '+'} tam={13} color={colorSistema.texto} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {boton('minus', valor - 1, valor > 1)}
      <Text style={{ fontSize: 16, fontWeight: '800', color: colorSistema.texto, minWidth: 16, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{valor}</Text>
      {boton('plus', valor + 1, valor < MAX_UNIDADES)}
    </View>
  );
}

function Terminos({ terminos, alAceptar, alCerrar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  if (!terminos) return null;
  return (
    <View style={{ flex: 1, backgroundColor: t.oscuro ? '#121016' : '#F5F4F8' }}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: ins.bottom + 24, gap: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 22, fontWeight: '900', color: colorSistema.texto, flex: 1 }}>{terminos.titulo}</Text>
          <Pressable onPress={alCerrar} hitSlop={12} accessibilityRole="button"><Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>Cerrar</Text></Pressable>
        </View>
        {terminos.puntos.map((p, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: t.color.magenta, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 13 }}>{i + 1}</Text>
            </View>
            <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: colorSistema.texto }}>{p}</Text>
          </View>
        ))}
        <Boton alTocar={alAceptar}>Aceptar y reservar</Boton>
      </ScrollView>
    </View>
  );
}

function Seccion({ texto }) {
  return <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4, marginTop: 6 }}>{texto}</Text>;
}

// Una opción elegible en tarjeta: ícono, título y una línea.
function Opcion({ sf, titulo, detalle, elegida, alTocar, deshabilitada = false }) {
  const t = useTema();
  return (
    <Pressable onPress={() => { if (deshabilitada) return; Haptics.selectionAsync().catch(() => {}); alTocar(); }} disabled={deshabilitada}
      accessibilityRole="radio" accessibilityState={{ selected: elegida, disabled: deshabilitada }}
      style={({ pressed }) => ({ flex: 1, borderRadius: 20, padding: 14, gap: 8, borderWidth: 2, opacity: deshabilitada ? 0.45 : 1,
        borderColor: elegida ? t.color.magenta : 'transparent',
        backgroundColor: elegida ? suave(t.color.magenta, t.oscuro ? 0.18 : 0.08) : (t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.8)'),
        transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Icono sf={sf} respaldo="" tam={20} color={elegida ? t.color.magentaTexto : colorSistema.texto2} />
        <Icono sf={elegida ? 'checkmark.circle.fill' : 'circle'} respaldo="" tam={18} color={elegida ? t.color.magenta : colorSistema.texto3} />
      </View>
      <Text style={{ fontSize: 15, fontWeight: '800', color: colorSistema.texto }}>{titulo}</Text>
      <Text style={{ fontSize: 12, color: colorSistema.texto2 }}>{detalle}</Text>
    </Pressable>
  );
}

function Campo({ etiqueta, valor, alCambiar, teclado, multilinea }) {
  const t = useTema();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto3 }}>{etiqueta}</Text>
      <TextInput value={valor} onChangeText={alCambiar} keyboardType={teclado ?? 'default'} multiline={!!multilinea}
        autoCorrect={false} autoCapitalize={teclado ? 'none' : 'characters'}
        style={{ fontSize: 16, color: colorSistema.texto, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: multilinea ? 64 : 44,
          backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }} />
    </View>
  );
}
