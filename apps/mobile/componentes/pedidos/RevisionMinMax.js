// Ajustar el MIN·MAX desde el pedido, NATIVO — la fila de revisión de
// `ItemSections` del portal: para cada renglón marcado `revision_minmax`
// (no se despachó por la regla o el stock), las ventas de 6 meses, el MIN y
// el MAX vigentes de esa sala, y guardar otro par, restaurar el original o
// dejarlo en 0/0 (sale del próximo pedido).
//
// Pide `minmax.can_edit` y NO `pedidos.can_edit` (2026-08-15: el permiso de
// pedidos lo tienen los cargos de sala, que reciben, y no deben reescribir el
// MIN·MAX del catálogo). Validación (`validarMinMax`) y escritura
// (`guardarMinMaxDesdePedido`) son del núcleo, las mismas del portal.
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { effectiveMinMaxPair, fetchStockParamsForRevision, guardarMinMaxDesdePedido } from '@nucleo/data/stockParams';
import { mensajeDeMinMax, validarMinMax } from '@nucleo/utils/minmaxDesdePedido';
import { colorSistema } from '../Formulario';
import { Campo } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

const clave = (r) => `${r.erp_product_id}_${r.erp_sucursal_id}`;

function Fila({ row, psp, onGuardado }) {
  const ef = effectiveMinMaxPair(psp);
  const original = { min: String(ef.min ?? 0), max: String(ef.max ?? 0) };
  const [val, setVal] = useState(original);
  const [ocupado, setOcupado] = useState(false);
  const error = validarMinMax(val);
  const cambio = val.min !== original.min || val.max !== original.max;

  const guardar = (min, max, titulo) => Alert.alert(titulo, `${row.products?.nombre ?? row.product_name ?? 'Producto'}: MIN ${original.min} / MAX ${original.max} → MIN ${min} / MAX ${max}.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Guardar', onPress: async () => {
      setOcupado(true);
      try {
        const { error: e } = await guardarMinMaxDesdePedido(row.id, min, max, {
          erp_product_id: row.erp_product_id, product: row.products?.nombre ?? row.product_name, sucursal_id: row.erp_sucursal_id,
          old_min: ef.min ?? 0, old_max: ef.max ?? 0, pedido_id: row.pedido_id, desde: 'app',
        });
        if (e) throw e;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo('MIN·MAX guardado', `MIN ${min} · MAX ${max}`);
        onGuardado(row, min, max);
      } catch (e) {
        setVal(original);
        fallo('No se pudo guardar', mensajeDeMinMax(e));
      } finally {
        setOcupado(false);
      }
    } },
  ]);

  return (
    <View style={{ gap: 6, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{row.products?.nombre ?? row.product_name}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Ventas 6 meses: ${psp === undefined ? '—' : `${psp?.units_sold_6m ?? 0} und.`}`}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>MIN</Text>
        <View style={{ width: 70 }}><Campo multiline={false} keyboardType="number-pad" editable={!ocupado} value={val.min} onChangeText={(t) => setVal((v) => ({ ...v, min: t.replace(/\D/g, '') }))} style={{ textAlign: 'center' }} /></View>
        <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>MAX</Text>
        <View style={{ width: 70 }}><Campo multiline={false} keyboardType="number-pad" editable={!ocupado} value={val.max} onChangeText={(t) => setVal((v) => ({ ...v, max: t.replace(/\D/g, '') }))} style={{ textAlign: 'center' }} /></View>
      </View>
      {cambio && error ? <Text style={{ color: MARCA.rojo, fontSize: 12 }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        <Accion texto="Guardar" color={MARCA.verde} deshabilitado={ocupado || !cambio || !!error} onPress={() => guardar(parseInt(val.min, 10), parseInt(val.max, 10), 'Guardar MIN·MAX')} />
        <Accion texto="Restaurar" deshabilitado={ocupado || !cambio} onPress={() => setVal(original)} />
        <Accion texto="0 / 0" color={MARCA.rojo} deshabilitado={ocupado} onPress={() => guardar(0, 0, 'Dejar en 0 / 0 (sale del próximo pedido)')} />
      </View>
    </View>
  );
}

function Accion({ texto, color = MARCA.azulClaro, onPress, deshabilitado }) {
  return (
    <Pressable disabled={deshabilitado} onPress={onPress} style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', opacity: deshabilitado ? 0.35 : pressed ? 0.6 : 1 })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function RevisionMinMax({ items }) {
  const revisar = (items ?? []).filter((i) => i.revision_minmax);
  const [psp, setPsp] = useState(null);
  const claveDeLista = revisar.map((r) => r.id).join(',');
  useEffect(() => {
    if (!revisar.length) return undefined;
    let vigente = true;
    Promise.resolve(fetchStockParamsForRevision([...new Set(revisar.map((r) => r.erp_product_id))], [...new Set(revisar.map((r) => r.erp_sucursal_id))]))
      .then(({ data }) => {
        if (!vigente || !data) return;
        const m = {};
        for (const p of data) m[`${p.erp_product_id}_${p.erp_sucursal_id}`] = p;
        setPsp(m);
      }).catch(() => {});
    return () => { vigente = false; };
  }, [claveDeLista]); // eslint-disable-line react-hooks/exhaustive-deps -- la lista cambia por sus ids
  if (!revisar.length) return null;
  const alGuardar = (row, min, max) => setPsp((m) => ({ ...m, [clave(row)]: { ...(m?.[clave(row)] ?? {}), min_units: min, max_units: max, manual_min: null, manual_max: null } }));
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>No se despacharon por la regla o el stock de bodega: ajusta su MIN·MAX en esta sala.</Text>
      {psp == null ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Cargando…</Text>
        : revisar.map((r) => <Fila key={`${r.id}-${psp[clave(r)]?.min_units ?? ''}-${psp[clave(r)]?.max_units ?? ''}`} row={r} psp={psp[clave(r)]} onGuardado={alGuardar} />)}
    </View>
  );
}
