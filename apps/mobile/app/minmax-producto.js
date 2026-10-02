// Mín·Máx de un producto, NATIVO — la ficha de UN producto en todas las salas:
// existencia, el par vigente, el borrador si lo hay y la alerta. Quien
// administra Mín·Máx ajusta el par de una sala desde acá; la revisión de toda
// la sala (publicar, descartar en lote, la matriz ABC·XYZ) sigue en el portal,
// porque es trabajo de escritorio de dos personas.
//
// Guardar usa `planDeGuardadoMinMax` del núcleo, la misma decisión del portal:
// EN VIVO si la sala ya publicó y la fila no tiene borrador, si no al BORRADOR;
// Bodega guarda un delta sobre la suma de las salas; un A o B a 0·0 pregunta.
// Con alcance de una sala, sólo se edita la propia (como en el portal).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { buscarProductosMinMax } from '@nucleo/data/minmaxRequests';
import { fetchResumenDelProductoPorSala, fetchStockParams, salaTieneMinMaxPublicado, upsertStockParams } from '@nucleo/data/stockParams';
import { planDeGuardadoMinMax } from '@nucleo/utils/minmaxGuardar';
import { BRANCH_A_ERP, ERP_BODEGA, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const ALERTA = {
  out_of_stock: ['Agotado', MARCA.rojo], below_min: ['Bajo el MIN', MARCA.ambar], ok: ['En rango', MARCA.verde],
  above_max: ['Sobre el MAX', MARCA.violeta], over_max: ['Sobre el MAX', MARCA.violeta],
};
const COLUMNAS = 'abc_class, draft_abc_class, draft_status, draft_min, draft_max, min_units, max_units, manual_min, manual_max, is_hidden';

function Sala({ fila, puedeEditar, onGuardar }) {
  const [abierta, setAbierta] = useState(false);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [alerta, colorAlerta] = ALERTA[fila.alert_status] ?? [fila.alert_status ?? '—', colorSistema.texto2];
  const borrador = fila.draft_status === 'pending';
  const abrir = () => {
    if (!puedeEditar) return;
    Haptics.selectionAsync().catch(() => {});
    setMin(String(borrador ? fila.draft_min ?? '' : fila.effective_min ?? ''));
    setMax(String(borrador ? fila.draft_max ?? '' : fila.effective_max ?? ''));
    setAbierta((a) => !a);
  };
  return (
    <View style={{ gap: 8 }}>
      <Pressable onPress={abrir} disabled={!puedeEditar} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
        <Vidrio radio={20} interactivo={puedeEditar}>
          <View style={{ padding: 14, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{ERP_NAMES[fila.erp_sucursal_id] ?? fila.erp_sucursal_id}</Text>
              <Pildora texto={alerta} color={colorAlerta} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Cifra rotulo="Existencia" valor={fila.current_stock ?? 0} />
              <Cifra rotulo="MIN · MAX" valor={`${fila.effective_min ?? '—'} · ${fila.effective_max ?? '—'}`} />
              {borrador ? <Cifra rotulo="Borrador" valor={`${fila.draft_min ?? '—'} · ${fila.draft_max ?? '—'}`} color={MARCA.ambar} /> : null}
            </View>
            {fila.is_hidden ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Oculto en esta sala.</Text> : null}
          </View>
        </Vidrio>
      </Pressable>
      {abierta ? (
        <Vidrio radio={20}>
          <View style={{ padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>MIN</Text>
                <Campo multiline={false} value={min} onChangeText={(v) => setMin(v.replace(/\D/g, ''))} keyboardType="number-pad" style={{ textAlign: 'center', fontSize: 22, fontWeight: '800' }} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>MAX</Text>
                <Campo multiline={false} value={max} onChangeText={(v) => setMax(v.replace(/\D/g, ''))} keyboardType="number-pad" style={{ textAlign: 'center', fontSize: 22, fontWeight: '800' }} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><BotonGrande texto="Guardar" color={MARCA.azul} onPress={async () => { if (await onGuardar(fila, min, max)) setAbierta(false); }} /></View>
              <View style={{ flex: 1 }}><BotonGrande texto="Poner 0" borde color={MARCA.rojo} onPress={async () => { if (await onGuardar(fila, '0', '0')) setAbierta(false); }} /></View>
            </View>
          </View>
        </Vidrio>
      ) : null}
    </View>
  );
}

function Cifra({ rotulo, valor, color }) {
  return (
    <View style={{ flex: 1, padding: 10, borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.13)' }}>
      <Text style={{ color: color ?? colorSistema.texto, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{valor}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{rotulo}</Text>
    </View>
  );
}

export default function MinMaxProducto() {
  const { producto: productoParam, nombre: nombreParam } = useLocalSearchParams();
  const { user, hasPermission, getScope } = useAuth();
  const canManage = hasPermission('minmax', 'can_edit');
  const todas = getScope?.('minmax') === 'ALL';
  const miErp = BRANCH_A_ERP[Number(salaDelUsuario(user))] ?? null;
  const [texto, setTexto, aplicado] = useBusqueda();
  const [resultados, setResultados] = useState([]);
  const [producto, setProducto] = useState(productoParam ? { id: Number(productoParam), nombre: nombreParam ?? '' } : null);
  const [filas, setFilas] = useState(null);

  useEffect(() => {
    if (producto || aplicado.trim().length < 2) { setResultados([]); return undefined; }
    let vivo = true;
    buscarProductosMinMax(aplicado.trim(), 20).then((r) => { if (vivo) setResultados(r.filas || []); });
    return () => { vivo = false; };
  }, [aplicado, producto]);

  const cargar = useCallback(async () => {
    if (!producto) return;
    const { data } = await fetchResumenDelProductoPorSala({ p_erp_product_id: producto.id });
    const extra = await Promise.all((data ?? []).map((r) => fetchStockParams(producto.id, r.erp_sucursal_id, COLUMNAS).then(({ data: d }) => d).catch(() => null)));
    setFilas((data ?? []).map((r, i) => ({ ...r, ...(extra[i] ?? {}), effective_min: r.effective_min, effective_max: r.effective_max, draft_status: r.draft_status ?? extra[i]?.draft_status }))
      .sort((a, b) => ERP_ORDEN.indexOf(a.erp_sucursal_id) - ERP_ORDEN.indexOf(b.erp_sucursal_id)));
  }, [producto]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]);

  // El piso de Bodega: la suma de lo vigente en las salas.
  const pisos = useMemo(() => {
    const salas = (filas ?? []).filter((f) => f.erp_sucursal_id !== ERP_BODEGA);
    return { min: salas.reduce((s, f) => s + (Number(f.effective_min) || 0), 0), max: salas.reduce((s, f) => s + (Number(f.effective_max) || 0), 0) };
  }, [filas]);

  const guardar = async (fila, min, max, confirmado = false) => {
    const { publicado } = await salaTieneMinMaxPublicado(fila.erp_sucursal_id);
    const row = { ...fila, pub_min: pisos.min, pub_max: pisos.max };
    const plan = planDeGuardadoMinMax({ row, productId: producto.id, sucursalId: fila.erp_sucursal_id, min, max, hayPublicado: !!publicado, confirmado });
    if (plan.sinCambio) return true;
    if (plan.error) { fallo('No se puede guardar', plan.error); return false; }
    if (plan.confirmarCero) {
      return new Promise((resolve) => Alert.alert('¿Poner en 0?', `${producto.nombre} es de los que más se venden en ${ERP_NAMES[fila.erp_sucursal_id]}. Con 0·0 deja de reponerse.`, [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Poner en 0', style: 'destructive', onPress: async () => resolve(await guardar(fila, min, max, true)) },
      ]));
    }
    trabajando('Guardando el MIN·MAX…');
    const { error } = await upsertStockParams(plan.payload);
    if (error) { fallo('No se pudo guardar', mensajeAmigable(error)); return false; }
    useStaffStore.getState().appendAuditLog?.(plan.accion, String(producto.id), { ...plan.detalle, product: producto.nombre, desde: 'app' });
    listo(plan.tipo === 'borrador' ? 'Quedó en el borrador' : 'MIN·MAX actualizado', `${ERP_NAMES[fila.erp_sucursal_id]} · ${plan.minNum ?? 0} · ${plan.maxNum ?? 0}`);
    await cargar();
    return true;
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Mín·Máx', headerLargeTitle: !producto }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {!producto ? (
            <Seccion titulo="Producto">
              <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Nombre o principio activo" autoCorrect={false} />
              {resultados.map((p) => (
                <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setProducto({ id: p.id, nombre: p.nombre }); }}
                  style={({ pressed }) => ({ paddingVertical: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>
                  {p.principio_activo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{p.principio_activo}</Text> : null}
                </Pressable>
              ))}
            </Seccion>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{producto.nombre}</Text>
                <Pressable onPress={() => { setProducto(null); setFilas(null); }} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cambiar</Text>
                </Pressable>
              </View>
              {canManage ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Toca una sala para ajustar su MIN·MAX.</Text> : null}
              {filas == null ? null : filas.length ? filas.map((f) => (
                <Sala key={f.erp_sucursal_id} fila={f} onGuardar={guardar}
                  puedeEditar={canManage && (todas || Number(f.erp_sucursal_id) === Number(miErp))} />
              )) : <Aviso tono="nota" texto="Este producto no tiene MIN·MAX en ninguna sala." />}
            </>
          )}
          {canManage && todas ? (
            <BotonGrande texto="Revisar la sala completa (portal)" borde
              onPress={() => router.push({ pathname: '/portal', params: { ruta: '/minmax', nombre: 'Min / Max' } })} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
