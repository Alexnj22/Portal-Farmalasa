// Lo que llegó y NO venía en el pedido, NATIVO — la pantalla «Extras» del
// `RecepcionModal` del portal: buscar el producto, anotarlo con su
// presentación y cantidad, corregirlo o quitarlo.
//
// Cada extra se escribe EN EL MOMENTO (`agregarExtraAPedido`): nace como un
// renglón del pedido con `error_tipo = 'sobrante'`, así que aparece en
// Diferencias con sus dos salidas y reabrir la pantalla lo encuentra. Con una
// propuesta en curso, la cantidad es la que aceptó la otra parte: se muestra,
// no se toca. Las opciones y la lista salen del núcleo (`extrasDeRecepcion`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchPedidoItemsAll } from '@nucleo/data/pedidos';
import {
  actualizarExtraDePedido, agregarExtraAPedido, fetchLastDispatchInfo, fetchProductPreciosOpts, quitarExtraDePedido, searchAvailableProducts,
} from '@nucleo/data/recepcion';
import { extrasDeRenglones, opcionesDeExtra, opcionesDelCatalogo } from '@nucleo/utils/extrasDeRecepcion';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo } from '../../componentes/Progreso';

const opcionesDe = async (productId) => {
  const [{ data }, { data: ult }] = await Promise.all([
    Promise.resolve(fetchProductPreciosOpts(productId)).catch(() => ({ data: [] })),
    Promise.resolve(fetchLastDispatchInfo(productId)).catch(() => ({ data: [] })),
  ]);
  return opcionesDeExtra(opcionesDelCatalogo(data ?? []), ult?.[0] ?? null);
};

function Paso({ texto, onPress, deshabilitado }) {
  return (
    <Pressable disabled={deshabilitado} onPress={onPress}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.18)', opacity: deshabilitado ? 0.3 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

export default function ExtrasDelPedido() {
  const { pedidoId, sucId, numero } = useLocalSearchParams();
  const suc = Number(sucId);
  const [renglones, setRenglones] = useState(null);
  const [extras, setExtras] = useState([]);
  const [opciones, setOpciones] = useState({});
  const [texto, setTexto] = useState('');
  const termino = useTextoRebotado(texto, 300).trim();
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const rows = await fetchPedidoItemsAll(pedidoId, suc).catch(() => []);
    setRenglones(rows ?? []);
    const ex = extrasDeRenglones(rows ?? []);
    setExtras(ex);
    const ops = {};
    await Promise.all(ex.map(async (e) => { ops[e.erp_product_id] = await opcionesDe(e.erp_product_id); }));
    setOpciones((o) => ({ ...o, ...ops }));
  }, [pedidoId, suc]);
  useEffect(() => { cargar(); }, [cargar]);

  const excluir = useMemo(() => [...(renglones ?? []).map((r) => r.erp_product_id), ...extras.map((e) => e.erp_product_id)], [renglones, extras]);
  useEffect(() => {
    if (termino.length < 2) { setResultados([]); return undefined; }
    let vivo = true;
    setBuscando(true);
    Promise.resolve(searchAvailableProducts(termino, excluir)).then(({ data }) => { if (vivo) setResultados((data ?? []).slice(0, 8)); })
      .catch(() => {}).finally(() => { if (vivo) setBuscando(false); });
    return () => { vivo = false; };
  }, [termino, excluir]);

  const agregar = async (prod) => {
    setOcupado(true);
    try {
      const ops = await opcionesDe(prod.id);
      const f = ops[0]?.factor ?? 1;
      // Se escribe ANTES de pintarlo: si la base lo rechaza (el producto sí venía,
      // o esta sala no es la que recibe), se dice ahora.
      const { data: id, error } = await agregarExtraAPedido({ pedidoId, sucursalId: suc, productId: prod.id, cantidad: 1, factor: f, tipo: ops[0]?.label ?? null, nota: null });
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setOpciones((o) => ({ ...o, [prod.id]: ops }));
      setExtras((xs) => [...xs, { id: Number(id), erp_product_id: prod.id, nombre: prod.nombre, fPres: f, fQty: 1, nota: '', bloqueado: false }]);
      setTexto(''); setResultados([]);
    } catch (e) {
      fallo('No se pudo anotar', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };

  const escribir = async (e) => {
    const label = (opciones[e.erp_product_id] ?? []).find((o) => o.factor === e.fPres)?.label ?? null;
    const { error } = await actualizarExtraDePedido({ itemId: e.id, cantidad: e.fQty, factor: e.fPres, tipo: label, nota: e.nota || null });
    if (error) fallo('No se pudo guardar', mensajeAmigable(error));
  };
  // Un respiro de 400 ms por extra, como el portal: tocar «+» cinco veces es
  // una escritura, no cinco que pueden llegar desordenadas.
  const respiros = useRef({});
  useEffect(() => () => Object.values(respiros.current).forEach(clearTimeout), []);
  const editar = (i, cambios, guardarYa = true) => {
    const e = { ...extras[i], ...cambios };
    setExtras((xs) => xs.map((x, j) => (j === i ? e : x)));
    if (!guardarYa) return;
    clearTimeout(respiros.current[e.id]);
    respiros.current[e.id] = setTimeout(() => { delete respiros.current[e.id]; escribir(e); }, 400);
  };
  const quitar = (i) => Alert.alert('Quitar el extra', extras[i].nombre, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: async () => {
      const e = extras[i];
      const { error } = await quitarExtraDePedido(e.id);
      if (error) { fallo('No se pudo quitar', mensajeAmigable(error)); return; }
      setExtras((xs) => xs.filter((_, j) => j !== i));
    } },
  ]);

  if (renglones == null) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Llegó de más' }} /><ActivityIndicator style={{ marginTop: 40 }} /></>;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Llegó de más', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>{`Pedido #${numero ?? ''} · ${ERP_NAMES[suc] ?? ''}`}</Text>
        <Aviso texto="Lo que llegó y no venía en el pedido. Queda como diferencia y se resuelve con Bodega." />
        <Seccion titulo="Agregar un producto">
          <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Busca el producto" />
          {buscando ? <ActivityIndicator /> : resultados.map((p) => (
            <Pressable key={p.id} disabled={ocupado} onPress={() => agregar(p)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>
            </Pressable>
          ))}
        </Seccion>
        {extras.length ? (
          <Seccion titulo={`Anotados · ${extras.length}`}>
            {extras.map((e, i) => (
              <View key={e.id} style={{ gap: 8, paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{e.nombre}</Text>
                  {!e.bloqueado ? (
                    <Pressable onPress={() => quitar(i)} hitSlop={8} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Quitar</Text>
                    </Pressable>
                  ) : null}
                </View>
                {e.bloqueado ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${e.fQty} · ya tiene una propuesta en curso.`}</Text> : (
                  <>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {(opciones[e.erp_product_id] ?? []).map((o) => (
                        <Pressable key={o.factor} onPress={() => editar(i, { fPres: o.factor })}
                          style={{ minHeight: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center', backgroundColor: e.fPres === o.factor ? MARCA.azulClaro : 'rgba(127,127,127,0.16)' }}>
                          <Text style={{ color: e.fPres === o.factor ? '#fff' : colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>Cantidad que llegó</Text>
                      <Paso texto="−" deshabilitado={e.fQty <= 1} onPress={() => editar(i, { fQty: Math.max(1, e.fQty - 1) })} />
                      <Text style={{ width: 44, textAlign: 'center', color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{e.fQty}</Text>
                      <Paso texto="+" onPress={() => editar(i, { fQty: e.fQty + 1 })} />
                    </View>
                    <Campo multiline={false} value={e.nota} placeholder="Nota (opcional)" onChangeText={(t) => editar(i, { nota: t }, false)} onEndEditing={() => escribir(extras[i])} />
                  </>
                )}
              </View>
            ))}
          </Seccion>
        ) : null}
      </ScrollView>
    </>
  );
}
