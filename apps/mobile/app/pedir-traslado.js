// Pedir a otra sala — la MISMA solicitud que arma el portal: el estado y las
// reglas son `hooks/usePedirTraslado` del núcleo (salas, lotes, presentación,
// vencimiento, reparto, composición de varias salas y envío) y los avisos salen
// de `avisosDelPedido`. Acá sólo se dibuja, con las piezas de vidrio de toda la
// app (pedido del usuario del 2026-10-01: «si usamos canónico y vidrio, ¿por
// qué poner sólidos?»).
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { usePedirTraslado } from '@nucleo/hooks/usePedirTraslado';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { buscarInventarioGlobalV2, MAX_PRODUCTOS_BUSQUEDA } from '@nucleo/data/inventory';
import { MIN_LETRAS_BUSQUEDA, resumirPorProducto } from '@nucleo/utils/consultaInventario';
import { claveOrigen, diasHasta, fmtVence } from '@nucleo/utils/pedirTraslado';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { listo as avisoListo } from '../componentes/Progreso';

const TONO = { danger: 'freno', warning: 'cuidado', neutral: 'nota' };
const AvisoPedido = ({ aviso }) => (aviso ? <Aviso tono={TONO[aviso.tono] || 'nota'} texto={aviso.texto} /> : null);

function Buscador({ onElegir, enLaSolicitud, onRevisar }) {
  const [texto, setTexto, aplicado] = useBusqueda();
  const [estado, setEstado] = useState({ cargando: false, productos: [], total: 0, error: null });
  useEffect(() => {
    if (aplicado.length < MIN_LETRAS_BUSQUEDA) { setEstado({ cargando: false, productos: [], total: 0, error: null }); return undefined; }
    let cancelado = false;
    setEstado((e) => ({ ...e, cargando: true }));
    buscarInventarioGlobalV2(aplicado, MAX_PRODUCTOS_BUSQUEDA).then((r) => {
      if (!cancelado) setEstado({ cargando: false, productos: resumirPorProducto(r.filas), total: r.total, error: r.error });
    });
    return () => { cancelado = true; };
  }, [aplicado]);
  const corto = texto.trim().length > 0 && texto.trim().length < MIN_LETRAS_BUSQUEDA;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}
      contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      {enLaSolicitud ? <BotonGrande texto={`En la solicitud · ${enLaSolicitud} — revisar y enviar`} borde onPress={onRevisar} /> : null}
      <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Busca el producto o su principio activo" autoFocus autoCorrect={false} returnKeyType="search" />
      {corto ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Escribe al menos ${MIN_LETRAS_BUSQUEDA} letras.`}</Text> : null}
      {estado.cargando ? <ActivityIndicator /> : null}
      {estado.error ? <Aviso tono="freno" texto="No se pudo buscar. Intenta de nuevo." /> : null}
      {!estado.cargando && aplicado.length >= MIN_LETRAS_BUSQUEDA && !estado.productos.length && !estado.error
        ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Ninguna sala tiene un producto con ese nombre.</Text> : null}
      {estado.productos.map((item) => (
        <Pressable key={String(item.erp_product_id ?? item.descripcion)} accessibilityRole="button"
          onPress={() => { Haptics.selectionAsync().catch(() => {}); onElegir(item); }}
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <Vidrio radio={20} interactivo>
            <View style={{ padding: 14, gap: 4 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{item.descripcion}</Text>
              {item.principioActivo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{item.principioActivo}</Text> : null}
              <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{item.salas.map((s) => `${s.sala} ${s.unidades}`).join(' · ') || 'Sin existencia'}</Text>
            </View>
          </Vidrio>
        </Pressable>
      ))}
      {estado.total > estado.productos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Se muestran ${estado.productos.length} de ${estado.total}. Escribe más para acotar.`}</Text> : null}
    </ScrollView>
  );
}

export default function PedirTraslado() {
  const p = usePedirTraslado({ alCerrar: () => {}, alTerminar: () => router.back() });
  const { producto, setElegido, donde, origenId, setOrigenId, opcionesPres, presIdx, setPresIdx, cantidad, setCantidad,
    esAntibiotico, avisoVence, lotesDeSala, descartados, setDescartados, reparto, hayLotes, avisos,
    renglones, quitarDelStore, causa, setCausa, agregar, lineaLista, yaEstaEnLaLista, puedeEnviar, enviar, enviando, listo, resumen, error, miErp } = p;
  const [buscando, setBuscando] = useState(!producto);

  useEffect(() => {
    if (!listo) return;
    avisoListo('Solicitud enviada', resumen?.solicitudes > 1 ? `${resumen.solicitudes} solicitudes: ${resumen.salas.join(', ')}` : `A ${resumen?.salas?.[0] ?? 'la sala'}`);
  }, [listo, resumen]);

  const pantalla = <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pedir a otra sala' }} />;

  if (!miErp) {
    return (
      <>
        {pantalla}
        <ScrollView contentContainerStyle={{ padding: 16 }} contentInsetAdjustmentBehavior="automatic">
          <Aviso tono="cuidado" texto="Los traslados los pide una sala. Tu ficha no está asignada a ninguna." />
        </ScrollView>
      </>
    );
  }
  if (listo) return pantalla;
  if (buscando || !producto) {
    return (
      <>
        {pantalla}
        <Buscador enLaSolicitud={renglones.length} onRevisar={() => setBuscando(false)}
          onElegir={(item) => { setElegido({ erp_product_id: item.erp_product_id, descripcion: item.descripcion }); setBuscando(false); }} />
      </>
    );
  }

  return (
    <>
      {pantalla}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          <Seccion titulo="Producto">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{producto.descripcion}</Text>
              <Pressable onPress={() => setBuscando(true)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cambiar</Text>
              </Pressable>
            </View>
            {esAntibiotico ? <Pildora texto="Bajo Receta" color={MARCA.ambar} /> : null}
          </Seccion>

          <Seccion titulo="De qué sala">
            {!donde.length ? <ActivityIndicator /> : (
              <Opciones valor={String(origenId)} onCambiar={setOrigenId}
                opciones={donde.map((d) => ({ id: claveOrigen(d), label: `${d.sala} — ${d.unidades}`, detalle: esAntibiotico && d.vence ? `Vence ${fmtVence(d.vence)}` : null }))} />
            )}
          </Seccion>

          {opcionesPres.length ? (
            <Seccion titulo="Presentación y cantidad">
              <Opciones valor={String(presIdx)} onCambiar={setPresIdx}
                opciones={opcionesPres.map((o) => ({ id: String(o.value), label: o.label, detalle: o.disabled ? 'No alcanza para una' : null }))} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <BotonPaso texto="−" deshabilitado={Number(cantidad) <= 1} onPress={() => setCantidad(String(Math.max(1, Number(cantidad || 1) - 1)))} />
                <View style={{ flex: 1 }}><Campo multiline={false} value={String(cantidad)} onChangeText={(v) => setCantidad(v.replace(/\D/g, ''))} keyboardType="number-pad" style={{ textAlign: 'center', fontSize: 20, fontWeight: '700' }} /></View>
                <BotonPaso texto="+" onPress={() => setCantidad(String(Number(cantidad || 0) + 1))} />
              </View>
              <AvisoPedido aviso={avisos.existencia} />
              <AvisoPedido aviso={avisos.ningunaAlcanza} />
              {avisoVence ? <Aviso tono={avisoVence.grave ? 'freno' : 'cuidado'} texto={avisoVence.texto} /> : null}
            </Seccion>
          ) : null}

          {hayLotes ? (
            <Seccion titulo="Saldría de">
              {lotesDeSala.map((l, i) => {
                const fuera = descartados.has(l.clave);
                const va = reparto.find((r) => r.clave === l.clave);
                const dias = diasHasta(l.vence);
                return (
                  <View key={l.clave} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, opacity: fuera ? 0.5 : 1, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{l.lote || 'Sin lote'}</Text>
                    <Text style={{ color: dias != null && dias <= 180 ? MARCA.ambar : colorSistema.texto2, fontSize: 13 }}>{l.vence ? fmtVence(l.vence) : 'sin fecha'}</Text>
                    <Text style={{ width: 54, textAlign: 'right', fontWeight: '800', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{`${va ? va.toma : 0} u.`}</Text>
                    <Pressable hitSlop={6} style={{ minHeight: 44, justifyContent: 'center' }}
                      onPress={() => setDescartados((prev) => { const s = new Set(prev); if (s.has(l.clave)) s.delete(l.clave); else s.add(l.clave); return s; })}>
                      <Text style={{ color: colorSistema.acento, fontSize: 14 }}>{fuera ? 'Incluir' : 'No este'}</Text>
                    </Pressable>
                  </View>
                );
              })}
              <AvisoPedido aviso={avisos.lotes} />
            </Seccion>
          ) : null}

          {renglones.length ? (
            <Seccion titulo={`En la solicitud · ${renglones.length}`}>
              {renglones.map((r, i) => (
                <View key={`${r.clave}-${r.item.erp_product_id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <Text style={{ flex: 1, color: r.problema ? MARCA.rojo : colorSistema.texto, fontSize: 14 }} numberOfLines={2}>
                    {`${r.item.descripcion} · ${r.item.cantidad} ${r.item.presentacion_tipo} · de ${r.origen.sala}`}
                  </Text>
                  <Pressable hitSlop={6} onPress={() => quitarDelStore(i)} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.rojo, fontSize: 14 }}>Quitar</Text>
                  </Pressable>
                </View>
              ))}
              <AvisoPedido aviso={avisos.conProblema} />
            </Seccion>
          ) : null}

          <Seccion titulo="Para qué se pide">
            <Campo value={causa} onChangeText={setCausa} placeholder="Queda escrito en el movimiento" />
          </Seccion>
          <AvisoPedido aviso={avisos.repetido} />
          <AvisoPedido aviso={avisos.aMedias} />
          <AvisoPedido aviso={avisos.paraQue} />
          {error ? <Aviso tono="freno" texto={error} /> : null}

          <BotonGrande texto={enviando ? 'Enviando…' : 'Solicitar'} color={MARCA.azul} deshabilitado={enviando || !puedeEnviar} onPress={enviar} />
          <BotonGrande texto="Agregar y pedir otro producto" borde deshabilitado={!lineaLista || yaEstaEnLaLista || enviando}
            onPress={() => { agregar({ cerrar: false }); setBuscando(true); }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function BotonPaso({ texto, onPress, deshabilitado }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado}
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(127,127,127,0.18)', opacity: deshabilitado ? 0.35 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}
