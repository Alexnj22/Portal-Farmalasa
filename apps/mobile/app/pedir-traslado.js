// Pedir a otra sala — la MISMA solicitud que arma el portal: el estado y las
// reglas son `hooks/usePedirTraslado` del núcleo (salas, lotes, presentación,
// vencimiento, reparto, composición de varias salas y envío) y los avisos salen
// de `avisosDelPedido`. Acá sólo se dibuja.
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { usePedirTraslado } from '@nucleo/hooks/usePedirTraslado';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { buscarInventarioGlobalV2, MAX_PRODUCTOS_BUSQUEDA } from '@nucleo/data/inventory';
import { MIN_LETRAS_BUSQUEDA, resumirPorProducto } from '@nucleo/utils/consultaInventario';
import { claveOrigen, diasHasta, fmtVence } from '@nucleo/utils/pedirTraslado';
import Boton from '../componentes/Boton';
import { Aviso, BotonChico, CampoNumero, CampoTexto, Tarjeta, Texto, Titulo } from '../componentes/comunes';
import { suave, useTema } from '../tema/tema';

const TONO = { danger: 'peligroTexto', warning: 'avisoTexto', neutral: 'texto3' };
function AvisoPedido({ aviso }) {
  const t = useTema();
  if (!aviso) return null;
  return <Text style={{ color: t.color[TONO[aviso.tono] || 'texto3'], fontWeight: '600', fontSize: t.texto.cuerpo + 1 }}>{aviso.texto}</Text>;
}

function Opcion({ activa, deshabilitada, onPress, children }) {
  const t = useTema();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: activa, disabled: deshabilitada }} disabled={deshabilitada} onPress={onPress}
      style={{ minHeight: t.tam.toque, paddingHorizontal: 12, justifyContent: 'center', borderRadius: t.radio.control, borderWidth: 1,
        borderColor: activa ? t.color.marca : t.color.borde, backgroundColor: activa ? suave(t.color.marca, 0.1) : t.color.tarjeta, opacity: deshabilitada ? 0.4 : 1 }}>
      <Text style={{ color: activa ? t.color.marca : t.color.texto, fontWeight: activa ? '800' : '600', fontSize: t.texto.cuerpo + 2 }}>{children}</Text>
    </Pressable>
  );
}

/** El buscador: un renglón por producto, con cuánto hay y en qué salas. */
function Buscador({ onElegir }) {
  const t = useTema();
  const [texto, setTexto, aplicado] = useBusqueda();
  const [estado, setEstado] = useState({ cargando: false, productos: [], total: 0, error: null });
  useEffect(() => {
    if (aplicado.length < MIN_LETRAS_BUSQUEDA) { setEstado({ cargando: false, productos: [], total: 0, error: null }); return; }
    let cancelado = false;
    setEstado(e => ({ ...e, cargando: true }));
    buscarInventarioGlobalV2(aplicado, MAX_PRODUCTOS_BUSQUEDA).then(r => {
      if (!cancelado) setEstado({ cargando: false, productos: resumirPorProducto(r.filas), total: r.total, error: r.error });
    });
    return () => { cancelado = true; };
  }, [aplicado]);
  const corto = texto.trim().length > 0 && texto.trim().length < MIN_LETRAS_BUSQUEDA;
  return (
    <FlatList
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 8 }}
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: 4 }}>
          <TextInput value={texto} onChangeText={setTexto} placeholder="Busca el producto o su principio activo" autoFocus
            placeholderTextColor={t.color.texto3} autoCorrect={false} returnKeyType="search"
            style={{ minHeight: t.tam.toque, borderRadius: t.radio.control, borderWidth: 1, borderColor: t.color.borde, backgroundColor: t.color.tarjeta, color: t.color.texto, paddingHorizontal: 12, fontSize: t.texto.cuerpo + 3 }} />
          {corto ? <Texto tenue>Escribe al menos {MIN_LETRAS_BUSQUEDA} letras.</Texto> : null}
          {estado.cargando ? <ActivityIndicator color={t.color.marca} /> : null}
          {estado.error ? <Aviso tono="danger">No se pudo buscar. Intenta de nuevo.</Aviso> : null}
          {!estado.cargando && aplicado.length >= MIN_LETRAS_BUSQUEDA && !estado.productos.length && !estado.error
            ? <Texto tenue>Ninguna sala tiene un producto con ese nombre.</Texto> : null}
          {estado.total > estado.productos.length ? <Texto tenue>Se muestran {estado.productos.length} de {estado.total}. Escribe más para acotar.</Texto> : null}
        </View>
      }
      data={estado.productos}
      keyExtractor={(p) => String(p.erp_product_id ?? p.descripcion)}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => onElegir(item)}
          style={({ pressed }) => ({ padding: 12, gap: 4, borderRadius: t.radio.tarjeta, borderWidth: 1, borderColor: t.color.borde, backgroundColor: t.color.tarjeta, opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ color: t.color.texto, fontWeight: '700', fontSize: t.texto.cuerpo + 2 }}>{item.descripcion}</Text>
          {item.principioActivo ? <Texto tenue numberOfLines={1}>{item.principioActivo}</Texto> : null}
          <Texto>{item.salas.map(s => `${s.sala} ${s.unidades}`).join(' · ') || 'Sin existencia'}</Texto>
        </Pressable>
      )}
    />
  );
}

export default function PedirTraslado() {
  const t = useTema();
  const p = usePedirTraslado({ alCerrar: () => {}, alTerminar: () => router.back() });
  const { producto, setElegido, donde, origenId, setOrigenId, sala, opcionesPres, presIdx, setPresIdx, cantidad, setCantidad,
    esAntibiotico, avisoVence, lotesDeSala, descartados, setDescartados, reparto, hayLotes, avisos,
    renglones, quitarDelStore, causa, setCausa, agregar, lineaLista, yaEstaEnLaLista, puedeEnviar, enviar, enviando, listo, resumen, error, miErp } = p;
  const [buscando, setBuscando] = useState(!producto);

  if (!miErp) {
    return (
      <View style={{ padding: 16 }}>
        <Stack.Screen options={{ title: 'Pedir a otra sala' }} />
        <Aviso tono="warning">Los traslados los pide una sala. Tu ficha no está asignada a ninguna.</Aviso>
      </View>
    );
  }

  if (listo) {
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <Stack.Screen options={{ title: 'Pedir a otra sala' }} />
        <Aviso tono="success">
          {resumen?.solicitudes > 1 ? `Salieron ${resumen.solicitudes} solicitudes: ${resumen.salas.join(', ')}.` : `Solicitud enviada a ${resumen?.salas?.[0] ?? 'la sala'}.`}
        </Aviso>
      </View>
    );
  }

  if (buscando || !producto) {
    return (
      <>
        <Stack.Screen options={{ title: 'Pedir a otra sala' }} />
        {renglones.length ? (
          <Pressable onPress={() => setBuscando(false)} style={{ padding: 12, backgroundColor: suave(t.color.marca, 0.1) }}>
            <Text style={{ color: t.color.marca, fontWeight: '700', textAlign: 'center' }}>En la solicitud · {renglones.length} — revisar y enviar ›</Text>
          </Pressable>
        ) : null}
        <Buscador onElegir={(item) => { setElegido({ erp_product_id: item.erp_product_id, descripcion: item.descripcion }); setBuscando(false); }} />
      </>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Pedir a otra sala' }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled"
        // En iPhone el teclado tapaba el campo que se escribe: esto corre el
        // contenido para que quede a la vista, y arrastrar lo cierra.
        automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag">
        <Tarjeta>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Titulo style={{ flex: 1 }}>{producto.descripcion}</Titulo>
            <BotonChico onPress={() => setBuscando(true)}>Cambiar</BotonChico>
          </View>
          {esAntibiotico ? <Text style={{ color: t.color.avisoTexto, fontWeight: '800' }}>Bajo Receta</Text> : null}

          <Texto tenue>De qué sala</Texto>
          {!donde.length ? <ActivityIndicator color={t.color.marca} /> : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {donde.map(d => (
                <Opcion key={claveOrigen(d)} activa={claveOrigen(d) === String(origenId)} onPress={() => setOrigenId(claveOrigen(d))}>
                  {d.sala} — {d.unidades}{esAntibiotico && d.vence ? ` · vence ${fmtVence(d.vence)}` : ''}
                </Opcion>
              ))}
            </View>
          )}

          {opcionesPres.length ? (
            <>
              <Texto tenue>Presentación y cantidad</Texto>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {opcionesPres.map(o => (
                  <Opcion key={String(o.value)} activa={String(o.value) === String(presIdx)} deshabilitada={o.disabled} onPress={() => setPresIdx(String(o.value))}>{o.label}</Opcion>
                ))}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <BotonChico etiqueta="Uno menos" deshabilitado={Number(cantidad) <= 1} onPress={() => setCantidad(String(Math.max(1, Number(cantidad || 1) - 1)))}>−</BotonChico>
                <CampoNumero valor={cantidad} onCambio={setCantidad} etiqueta="Cantidad" ancho={96} />
                <BotonChico etiqueta="Uno más" onPress={() => setCantidad(String(Number(cantidad || 0) + 1))}>+</BotonChico>
              </View>
            </>
          ) : null}
          <AvisoPedido aviso={avisos.existencia} />
          <AvisoPedido aviso={avisos.ningunaAlcanza} />
          {avisoVence ? <Text style={{ color: avisoVence.grave ? t.color.peligroTexto : t.color.avisoTexto, fontWeight: '700' }}>{avisoVence.texto}</Text> : null}
        </Tarjeta>

        {hayLotes ? (
          <Tarjeta>
            <Texto tenue>Saldría de</Texto>
            {lotesDeSala.map(l => {
              const fuera = descartados.has(l.clave);
              const va = reparto.find(r => r.clave === l.clave);
              const dias = diasHasta(l.vence);
              return (
                <View key={l.clave} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: fuera ? 0.5 : 1 }}>
                  <Text style={{ flex: 1, color: t.color.texto2 }} numberOfLines={1}>{l.lote || 'sin lote'}</Text>
                  <Text style={{ color: dias != null && dias <= 180 ? t.color.avisoTexto : t.color.texto3 }}>{l.vence ? fmtVence(l.vence) : 'sin fecha'}</Text>
                  <Text style={{ width: 56, textAlign: 'right', fontWeight: '800', color: t.color.texto }}>{va ? va.toma : 0} uds</Text>
                  <BotonChico onPress={() => setDescartados(prev => { const s = new Set(prev); if (s.has(l.clave)) s.delete(l.clave); else s.add(l.clave); return s; })}>
                    {fuera ? 'Incluir' : 'No este'}
                  </BotonChico>
                </View>
              );
            })}
            <AvisoPedido aviso={avisos.lotes} />
          </Tarjeta>
        ) : null}

        {renglones.length ? (
          <Tarjeta>
            <Texto tenue>En la solicitud · {renglones.length}</Texto>
            {renglones.map((r, i) => (
              <View key={`${r.clave}-${r.item.erp_product_id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, color: r.problema ? t.color.peligroTexto : t.color.texto }} numberOfLines={2}>
                  {r.item.descripcion} · {r.item.cantidad} {r.item.presentacion_tipo} · de {r.origen.sala}
                </Text>
                <BotonChico onPress={() => quitarDelStore(i)}>Quitar</BotonChico>
              </View>
            ))}
            <AvisoPedido aviso={avisos.conProblema} />
          </Tarjeta>
        ) : null}

        <CampoTexto valor={causa} onCambio={setCausa} etiqueta="Para qué se pide" placeholder="Para qué se pide — queda escrito en el movimiento" />
        <AvisoPedido aviso={avisos.repetido} />
        <AvisoPedido aviso={avisos.aMedias} />
        <AvisoPedido aviso={avisos.paraQue} />
        {error ? <Aviso tono="danger">{error}</Aviso> : null}

        <View style={{ gap: 8 }}>
          <Boton onPress={enviar} ocupado={enviando} deshabilitado={!puedeEnviar}>Solicitar</Boton>
          <BotonChico deshabilitado={!lineaLista || yaEstaEnLaLista || enviando}
            onPress={() => { agregar({ cerrar: false }); setBuscando(true); }}>
            Agregar y pedir otro producto
          </BotonChico>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
