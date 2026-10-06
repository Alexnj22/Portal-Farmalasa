// Los tres historiales de la ficha del producto, como el expediente del portal:
// compras (con la clasificación Nuevo / Reentrada / Regular, la primera y la
// última, y el costo unitario de cada una — sólo con `productos_ver_costos`),
// precios (sin los snapshots repetidos del sync) y cambios en la ficha. Las
// reglas salen del núcleo (`clasificarCompras`, `historialDePreciosSinRepetir`).
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { clasificarCompras, comprasOrdenadas, historialDePreciosSinRepetir } from '@nucleo/utils/preciosDeProducto';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import Vidrio from '../Vidrio';

const fecha = (d) => (d ? fechaTexto(d, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const COLOR_CLASIF = { Nuevo: MARCA.verde, Reentrada: MARCA.violetaClaro, Regular: MARCA.azulClaro };

function VerMas({ total, visibles, abierto, onCambiar, unidad }) {
  if (total <= visibles) return null;
  const resto = total - visibles;
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(!abierto); }} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center', alignSelf: 'center' }}>
      <Text style={{ color: colorSistema.acento, fontSize: 15 }}>{abierto ? 'Ver menos' : `Ver ${resto} ${unidad}${resto === 1 ? '' : 's'} anterior${resto === 1 ? '' : 'es'}`}</Text>
    </Pressable>
  );
}

export function HistorialDeCompras({ purchases, conCosto }) {
  const [todo, setTodo] = useState(false);
  if (!conCosto) return <Text style={{ color: colorSistema.texto2, fontSize: 14, fontStyle: 'italic' }}>Sin permiso para ver costos de compra.</Text>;
  const filas = comprasOrdenadas(purchases);
  if (!filas.length) return <Text style={{ color: colorSistema.texto2, fontSize: 14, fontStyle: 'italic' }}>Sin historial de compras registrado.</Text>;
  const clasif = clasificarCompras(purchases);
  const fechas = filas.map((r) => new Date(r.purchase_receipts.fecha));
  const visibles = todo ? filas : filas.slice(0, 8);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {clasif ? <Pildora texto={clasif} color={COLOR_CLASIF[clasif]} /> : null}
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
          {`Primera ${fecha(new Date(Math.min(...fechas)))} · última ${fecha(new Date(Math.max(...fechas)))} · ${filas.length} compra${filas.length === 1 ? '' : 's'}`}
        </Text>
      </View>
      <Vidrio radio={18}>
        <View style={{ paddingHorizontal: 14 }}>
          {visibles.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{r.purchase_receipts?.proveedor || 'Sin proveedor'}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${fecha(r.purchase_receipts?.fecha)} · ${formatQty(r.cantidad ?? 0)} u.`}</Text>
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {Number(r.precio_unitario) > 0 ? formatMoney(r.precio_unitario, { decimales: 4 }) : '—'}
              </Text>
            </View>
          ))}
        </View>
      </Vidrio>
      <VerMas total={filas.length} visibles={8} abierto={todo} onCambiar={setTodo} unidad="compra" />
    </View>
  );
}

export function HistorialDePrecios({ history, niveles }) {
  const [todo, setTodo] = useState(false);
  const filas = historialDePreciosSinRepetir(history);
  if (!filas.length) return <Text style={{ color: colorSistema.texto2, fontSize: 14, fontStyle: 'italic' }}>Sin historial de precios registrado.</Text>;
  const visibles = todo ? filas : filas.slice(0, 8);
  return (
    <View style={{ gap: 10 }}>
      {visibles.map((r, i) => (
        <Vidrio key={`${r.id_presentacion}-${r.valid_from}-${i}`} radio={18}>
          <View style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: 9 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{r.presentaciones?.tipo || '—'}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{fecha(r.valid_from)}</Text>
            </View>
            {niveles.filter((n) => Number(r[n.key]) > 0).map((n) => (
              <View key={n.key} style={{ flexDirection: 'row', paddingVertical: 6, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }}>{n.label}</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{formatMoney(r[n.key])}</Text>
              </View>
            ))}
          </View>
        </Vidrio>
      ))}
      <VerMas total={filas.length} visibles={8} abierto={todo} onCambiar={setTodo} unidad="cambio" />
    </View>
  );
}

// Los campos internos que no se muestran (claves foráneas sin valor anterior).
const OCULTOS = new Set(['laboratorio_id']);

export function CambiosEnLaFicha({ prodLog }) {
  const [todo, setTodo] = useState(false);
  const filas = (prodLog || []).filter((c) => !(OCULTOS.has(c.campo) && !c.valor_anterior));
  if (!filas.length) return <Text style={{ color: colorSistema.texto2, fontSize: 14, fontStyle: 'italic' }}>Sin cambios registrados.</Text>;
  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
  const delMes = filas.filter((c) => new Date(c.detected_at) >= inicioMes);
  const base = delMes.length || Math.min(5, filas.length);
  const visibles = todo ? filas : (delMes.length ? delMes : filas.slice(0, 5));
  return (
    <View style={{ gap: 8 }}>
      <Vidrio radio={18} tinte={`${MARCA.ambar}14`}>
        <View style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
          {visibles.map((c, i) => (
            <View key={i} style={{ paddingVertical: 8, gap: 2, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${fechaTexto(c.detected_at, { day: 'numeric', month: 'short' })} · ${c.campo}`}</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
                <Text style={{ color: colorSistema.texto2, textDecorationLine: 'line-through' }}>{c.valor_anterior || '—'}</Text>
                {`  →  ${c.valor_nuevo || '—'}`}
              </Text>
            </View>
          ))}
        </View>
      </Vidrio>
      <VerMas total={filas.length} visibles={base} abierto={todo} onCambiar={setTodo} unidad="cambio" />
    </View>
  );
}
