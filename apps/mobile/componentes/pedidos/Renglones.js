// Los productos de un pedido en una sala, NATIVO — `ItemSections` del portal:
// lo que se envió, lo que bodega no tenía completo, lo que no tenía y lo que
// frenó una regla de despacho. Cada sección agrupada por laboratorio, y cada
// producto con su presentación de despacho y solicitado → enviado → recibido.
//
// El reparto (`seccionesDeRenglones`), el rótulo de la presentación y las
// cifras salen del núcleo: son los del portal. Sólo lectura — corregir el
// MIN/MAX desde la regla sigue siendo del portal.
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { calcSolicitado, rotuloDePresentacion, seccionesDeRenglones } from '@nucleo/utils/tableroDePedidos';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { FONDO, Pildora } from '../avisos/Piezas';

const DE_A = 20;

function porLaboratorio(filas) {
  const m = new Map();
  filas.forEach((r) => {
    const lab = r.products?.laboratorios?.nombre ?? 'Sin laboratorio';
    if (!m.has(lab)) m.set(lab, []);
    m.get(lab).push(r);
  });
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
    .map(([lab, rs]) => [lab, rs.sort((a, b) => String(a.products?.nombre ?? '').localeCompare(String(b.products?.nombre ?? ''), 'es'))]);
}

function Cifra({ rotulo, valor, color }) {
  return (
    <View style={{ alignItems: 'flex-end', minWidth: 52 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 }}>{rotulo}</Text>
      <Text style={{ color: color ?? colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor ?? '—'}</Text>
    </View>
  );
}

function Producto({ r, modo, primero }) {
  const sol = calcSolicitado(r);
  const enviado = r.cantidad_enviada ?? r.cantidad_asignada;
  // Un renglón todavía `pendiente` no se ha contado: lo recibido no es 0, es
  // «todavía no». Sin esto, un pedido en camino decía «Faltaron» en cada línea.
  const rec = r.status === 'pendiente' ? null : r.cantidad_recibida;
  const delta = rec == null || enviado == null ? null : rec - enviado;
  const estado = r.status === 'recibido' ? ['Recibido', MARCA.verde] : r.status === 'con_diferencia' ? ['Diferencia', MARCA.ambar] : null;
  return (
    <View style={{ paddingVertical: 9, gap: 5, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{r.products?.nombre ?? `Producto ${r.erp_product_id}`}</Text>
        {r.products?.es_antibiotico ? <Pildora texto="Bajo Receta" color={MARCA.rojo} /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Pildora texto={rotuloDePresentacion(r)} color={MARCA.azulClaro} />
          {modo === 'enviados' && estado ? <Pildora texto={estado[0]} color={estado[1]} /> : null}
          {r.es_extra ? <Pildora texto="Llegó de más" color={MARCA.violetaClaro} /> : null}
        </View>
        {sol != null ? <Cifra rotulo="PEDIDO" valor={sol} color={colorSistema.texto2} /> : null}
        {modo === 'enviados' ? (
          <>
            <Cifra rotulo="ENVIADO" valor={enviado} />
            <Cifra rotulo="RECIBIDO" valor={rec} color={delta == null || delta === 0 ? undefined : delta < 0 ? MARCA.rojo : MARCA.verde} />
          </>
        ) : modo === 'agotamiento' ? (
          <Cifra rotulo="ENVIADO" valor={enviado} color={MARCA.ambar} />
        ) : null}
      </View>
      {modo === 'enviados' && delta != null && delta !== 0 ? (
        <Text style={{ color: delta < 0 ? MARCA.rojo : MARCA.verde, fontSize: 12, fontWeight: '700' }}>{delta < 0 ? `Faltaron ${-delta}` : `${delta} de más`}</Text>
      ) : null}
      {r.nota_diferencia ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`“${r.nota_diferencia}”`}</Text> : null}
      {modo === 'regla' && r.products?.dispatch_rules?.dispatch_label ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Regla: ${r.products.dispatch_rules.dispatch_label}`}</Text> : null}
    </View>
  );
}

function SeccionDeRenglones({ titulo, nota, filas, modo, color }) {
  const [abierta, setAbierta] = useState(modo === 'enviados');
  const [cuantos, setCuantos] = useState(DE_A);
  const grupos = useMemo(() => porLaboratorio(filas), [filas]);
  if (!filas.length) return null;
  let vistos = 0;
  return (
    <View style={{ borderRadius: 16, backgroundColor: FONDO, overflow: 'hidden' }}>
      <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta((a) => !a); }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 48, opacity: pressed ? 0.6 : 1 })}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{titulo}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{filas.length}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{abierta ? '⌃' : '⌄'}</Text>
      </Pressable>
      {abierta ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 8 }}>
          {nota ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{nota}</Text> : null}
          {grupos.map(([lab, rs]) => {
            if (vistos >= cuantos) return null;
            const deEste = rs.slice(0, Math.max(0, cuantos - vistos));
            vistos += deEste.length;
            return (
              <View key={lab}>
                <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4 }}>{`${lab} · ${rs.length}`}</Text>
                {deEste.map((r, i) => <Producto key={r.id} r={r} modo={modo} primero={i === 0} />)}
              </View>
            );
          })}
          {filas.length > cuantos ? (
            <Pressable onPress={() => setCuantos((n) => n + 40)} style={{ minHeight: 40, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{`Ver ${Math.min(40, filas.length - cuantos)} más de ${filas.length - cuantos}`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function Renglones({ items }) {
  if (items == null) return null;
  const s = seccionesDeRenglones(items);
  if (!s.total) return <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Este pedido no tiene productos para esta sala.</Text>;
  return (
    <View style={{ gap: 10 }}>
      <SeccionDeRenglones titulo="Productos enviados" filas={s.enviados} modo="enviados" color={MARCA.verde} />
      <SeccionDeRenglones titulo="Stock insuficiente en bodega" filas={s.agotamiento} modo="agotamiento" color={MARCA.ambar}
        nota="Se envió menos de lo pedido: bodega no tenía para cubrir el MAX." />
      <SeccionDeRenglones titulo="Sin inventario en bodega" filas={s.sinStock} modo="sinStock" color={MARCA.ambar}
        nota="No se incluyeron por falta de existencia en bodega al momento del despacho." />
      <SeccionDeRenglones titulo="Revisar regla de despacho" filas={s.porRegla} modo="regla" color={MARCA.rojo}
        nota="La regla de despacho dejó el producto fuera. El MIN/MAX se corrige en el portal." />
    </View>
  );
}
