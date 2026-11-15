// Los precios de un producto, NATIVOS — el detalle del widget «Consulta de
// precios» del portal (`PreciosDelProducto.jsx`), con la MISMA lógica del
// núcleo (`@nucleo/utils/presentacionesDePrecio`):
//
//   · hasta Mayoreo Plus PARA TODOS; el costo no viaja (la consulta no lo pide);
//   · las presentaciones se juntan por FACTOR y se cambian arriba, fijas
//     (`FijoArriba` + `Segmentos`); arranca en la que hay en la sala;
//   · si una presentación tiene más de un precio, una tarjeta por precio,
//     ordenadas por Regular;
//   · Regular y Preferente destacados, del mismo tamaño (usuario, 2026-11-15:
//     el Preferente es «el precio normal»); Público, Mayoreo y Mayoreo Plus
//     debajo;
//   · los lotes son informativos: los de la sala propia (sin sala, todas), sin
//     el área de vencidos.
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchPreciosDelProducto } from '@nucleo/data/productos';
import { fetchInventoryByProductIds } from '@nucleo/data/inventory';
import { COLUMNAS, DESTACADOS, RESTO, agruparPorPresentacion, presentacionesParaMostrar } from '@nucleo/utils/presentacionesDePrecio';
import { BRANCH_A_ERP, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_FIJA, BARRA_NATIVA } from '../../componentes/PilaDePestana';
import FijoArriba from '../../componentes/FijoArriba';
import Segmentos from '../../componentes/Segmentos';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Cargando, Vacio } from '../../componentes/formulario/Piezas';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { MAYUSCULAS } from '../../tema/mayusculas';

const unidadesTexto = (n) => (n > 1 ? `${n} unidades` : '1 unidad');

function Tarjeta({ variante, conTipo }) {
  return (
    <Vidrio radio={20}>
      {conTipo ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: MAYUSCULAS, letterSpacing: 0.4, paddingHorizontal: 14, paddingTop: 10 }}>{variante.nombre}</Text>
      ) : null}
      <View style={{ flexDirection: 'row' }}>
        {DESTACADOS.map((n, i) => (
          <View key={n.key} style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: `${MARCA.azul}1A`, borderLeftWidth: i ? 0.5 : 0, borderLeftColor: colorSistema.separador }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 11, fontWeight: '800', textTransform: MAYUSCULAS, letterSpacing: 0.6 }}>{n.label}</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] }} adjustsFontSizeToFit numberOfLines={1}>
              {formatMoney(variante.precios[n.key])}
            </Text>
          </View>
        ))}
      </View>
      {RESTO.map((n) => (
        <View key={n.key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{n.label}</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(variante.precios[n.key])}</Text>
        </View>
      ))}
    </Vidrio>
  );
}

export default function PrecioDeProducto() {
  const { id, nombre } = useLocalSearchParams();
  const productId = Number(id) || null;
  const { user } = useAuth();
  const miErp = BRANCH_A_ERP[Number(salaDelUsuario(user))] ?? null;
  const [datos, setDatos] = useState({ precios: null, lotes: [], error: null });
  const [elegida, setElegida] = useState(null);

  useEffect(() => {
    if (!productId) return undefined;
    let vivo = true;
    Promise.all([fetchPreciosDelProducto(productId, COLUMNAS), fetchInventoryByProductIds([productId]).catch(() => [])])
      .then(([{ data, error }, inv]) => {
        if (!vivo) return;
        const lotes = (inv || [])
          .filter((l) => !l.is_vencidos && (miErp == null || l.erp_sucursal_id === miErp))
          .map((l) => ({ ...l, _sala: ERP_NAMES[l.erp_sucursal_id] ?? `Sala ${l.erp_sucursal_id}` }))
          .sort((a, b) => ERP_ORDEN.indexOf(a.erp_sucursal_id) - ERP_ORDEN.indexOf(b.erp_sucursal_id));
        setDatos({ precios: error ? [] : (data ?? []), lotes, error: error ? mensajeAmigable(error) : null });
      });
    return () => { vivo = false; };
  }, [productId, miErp]);

  const grupos = useMemo(() => agruparPorPresentacion(presentacionesParaMostrar(datos.precios), datos.lotes), [datos]);
  const grupo = grupos.find((g) => g.clave === elegida) ?? grupos.find((g) => g.existencia > 0) ?? grupos[0] ?? null;
  const conSecciones = grupos.length > 1;
  const titulo = String(nombre || 'Precios');

  return (
    <>
      <Stack.Screen options={{ ...(conSecciones ? BARRA_FIJA : BARRA_NATIVA), title: titulo }} />
      {conSecciones ? (
        <FijoArriba>
          <Segmentos activa={grupo?.clave}
            onCambiar={(v) => { Haptics.selectionAsync().catch(() => {}); setElegida(v); }}
            opciones={grupos.map((g) => ({ id: g.clave, label: g.nombre }))} />
        </FijoArriba>
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }} contentInsetAdjustmentBehavior="automatic">
        {datos.precios === null ? <Cargando /> : null}
        {datos.error ? <Aviso tono="freno" texto={datos.error} /> : null}
        {datos.precios && !datos.error && !grupo ? <Vacio icono="Package" titulo="Este producto no tiene precios registrados" /> : null}
        {grupo ? (
          <>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
              <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{grupo.nombre}</Text>
              {` · ${unidadesTexto(grupo.unidades)}`}
              {grupo.variantes.length > 1 ? ` · ${grupo.variantes.length} precios` : ''}
            </Text>
            {grupo.variantes.map((v) => <Tarjeta key={v.id} variante={v} conTipo={grupo.conTipos} />)}

            <View style={{ gap: 8, marginTop: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: MAYUSCULAS, letterSpacing: 0.4 }}>{miErp != null ? 'En tu sala' : 'En las salas'}</Text>
                {grupo.existencia > 0 ? <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatQty(grupo.existencia)}</Text> : null}
              </View>
              {grupo.lotes.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {grupo.lotes.map((l, i) => (
                    <View key={`${l.erp_sucursal_id}|${l.lote}|${l.fecha_vencimiento}|${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 0.5, borderColor: colorSistema.separador, backgroundColor: colorSistema.fila }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontFamily: 'Menlo' }}>{l.lote || 'Sin lote'}</Text>
                      {miErp == null ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{l._sala}</Text> : null}
                      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatQty(l.cantidad)}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin existencia de esta presentación.</Text>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
