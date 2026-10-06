// Las presentaciones de un producto con sus precios — la «escalera» del
// expediente del portal (`ExpandedProductRow`, rama `comoPanel`): una tarjeta
// por presentación, el costo con su factor arriba (sólo con
// `productos_ver_costos`: si no, la base no lo manda) y cada nivel con su
// precio y su MARGEN. El color va en el margen y no en el precio: el precio es
// un dato, el margen un juicio. Un precio que cambió muestra el anterior
// tachado y la fecha del cambio.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { calcMargin } from '@nucleo/utils/preciosDeProducto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import Vidrio from '../Vidrio';

const fmtP = (v) => (v == null || v === '' || parseFloat(v) === 0 ? '—' : formatMoney(v));
const colorMargen = (m) => (m < 0 ? MARCA.rojo : m < 15 ? MARCA.ambar : MARCA.verde);

/** Último valor anterior de cada campo, por presentación (del changelog). */
export function cambiosPorPresentacion(changelog) {
  const mapa = {};
  (changelog || []).forEach((c) => {
    if (!mapa[c.id_presentacion]) mapa[c.id_presentacion] = {};
    const ex = mapa[c.id_presentacion][c.campo];
    if (!ex || new Date(c.detected_at) > new Date(ex.detected_at)) mapa[c.id_presentacion][c.campo] = { anterior: c.valor_anterior, detected_at: c.detected_at };
  });
  return mapa;
}

function Presentacion({ pp, niveles, cambios, conCosto }) {
  const activa = pp.activo !== false;
  return (
    <Vidrio radio={20}>
      <View style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>
            {pp.presentaciones?.tipo || 'Presentación'}
            {pp.descripcion ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>{`  ${pp.descripcion}`}</Text> : null}
          </Text>
          <Pildora texto={activa ? 'Activa' : 'Inactiva'} color={activa ? MARCA.verde : colorSistema.texto2} />
        </View>
        {conCosto ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingVertical: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>
              {`Costo${pp.factor != null && pp.factor !== '' ? ` · factor ${pp.factor}` : ''}`}
            </Text>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{fmtP(pp.costo)}</Text>
          </View>
        ) : Number(pp.factor) > 1 ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 13, paddingBottom: 6 }}>{`Factor ${pp.factor}`}</Text>
        ) : null}
        {niveles.filter((n) => Number(pp[n.key]) > 0 || cambios[n.key]).map((n) => {
          const m = conCosto && n.key !== 'precio_7' ? calcMargin(pp[n.key], pp.costo) : null;
          const ch = cambios[n.key];
          return (
            <View key={n.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador,
              backgroundColor: ch ? `${MARCA.ambar}14` : 'transparent', marginHorizontal: ch ? -14 : 0, paddingHorizontal: ch ? 14 : 0 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{n.label}</Text>
                {ch ? <Text style={{ color: MARCA.ambar, fontSize: 11, fontWeight: '600' }}>{`cambió el ${fechaTexto(ch.detected_at, { day: 'numeric', month: 'short' })}`}</Text> : null}
              </View>
              {ch ? <Text style={{ color: colorSistema.texto2, fontSize: 13, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>{fmtP(ch.anterior)}</Text> : null}
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: n.key === 'vineta' ? '800' : '600', fontVariant: ['tabular-nums'], minWidth: 74, textAlign: 'right' }}>{fmtP(pp[n.key])}</Text>
              {conCosto ? (
                <Text style={{ width: 52, textAlign: 'right', color: m == null ? colorSistema.texto2 : colorMargen(m), fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {m == null ? '—' : `${m.toFixed(1)}%`}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </Vidrio>
  );
}

export default function Precios({ precios, niveles, changelog, conCosto }) {
  const [verInactivas, setVerInactivas] = useState(false);
  const cambios = cambiosPorPresentacion(changelog);
  const inactivas = precios.filter((p) => p.activo === false).length;
  const visibles = verInactivas ? precios : precios.filter((p) => p.activo !== false);
  return (
    <View style={{ gap: 10 }}>
      {visibles.map((pp) => <Presentacion key={pp.id_presentacion} pp={pp} niveles={niveles} cambios={cambios[pp.id_presentacion] || {}} conCosto={conCosto} />)}
      {inactivas ? (
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setVerInactivas((v) => !v); }} hitSlop={8} style={{ alignSelf: 'center', minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ color: colorSistema.acento, fontSize: 15 }}>{verInactivas ? 'Ocultar inactivas' : `Mostrar ${inactivas} inactiva${inactivas === 1 ? '' : 's'}`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
