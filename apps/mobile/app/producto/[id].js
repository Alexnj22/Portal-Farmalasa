// Un producto, nativo: cuánto hay en total, en qué salas y en qué lotes —lo
// que vence primero, primero—. Es la «consulta de inventario» de la app: se
// llega desde el buscador (pestaña Buscar) o desde cualquier lista que nombre
// un producto.
//
// Los números salen del núcleo, igual que en el portal: las filas de
// `v_inventario_lotes` (`fetchInventoryByProductIds`), las unidades con el
// factor ya aplicado (`unidadesDe`) y los lotes por sala con
// `lotesEnUnidades`. Los del área de vencidos de Bodega no cuentan como
// existencia (misma regla que `resumirPorProducto`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { fetchInventoryByProductIds } from '@nucleo/data/inventory';
import { fetchPreciosDelProducto } from '@nucleo/data/productos';
import { useAuth } from '@nucleo/context/AuthContext';
import { COLUMNAS_DE_PRECIO, nivelesVisibles } from '@nucleo/utils/preciosDeProducto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { lotesEnUnidades, unidadesDe } from '@nucleo/utils/unidadesInventario';
import { diasHasta, fmtVence } from '@nucleo/utils/pedirTraslado';
import { ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { formatQty as formatNumber } from '@nucleo/utils/formatNumber';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import Vidrio from '../../componentes/Vidrio';

// Cuándo un vencimiento merece color: rojo si ya pasó o falta un mes, naranja
// hasta tres meses.
const colorVence = (d) => {
  const n = diasHasta(d);
  if (n == null) return colorSistema.texto2;
  if (n <= 30) return colorSistema.rojo;
  if (n <= 90) return colorSistema.naranja;
  return colorSistema.texto2;
};

const uds = (n) => `${formatNumber(n)} ${n === 1 ? 'unidad' : 'unidades'}`;

export default function Producto() {
  const { id, nombre } = useLocalSearchParams();
  const { maxPriceLevel } = useAuth();
  const [filas, setFilas] = useState(null);
  const [precios, setPrecios] = useState([]);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setError(null);
      const [r, p] = await Promise.all([
        fetchInventoryByProductIds([Number(id)]),
        fetchPreciosDelProducto(Number(id), COLUMNAS_DE_PRECIO),
      ]);
      setFilas((r || []).filter((f) => !f.is_vencidos));
      // Sólo las presentaciones vigentes; sin permiso para verlos, la base no
      // devuelve filas y la sección no se dibuja.
      setPrecios((p?.data || []).filter((x) => x.activo !== false));
    } catch (e) {
      setError(e?.message ?? String(e));
      setFilas([]);
    }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const salas = useMemo(() => {
    const porSala = new Map();
    (filas || []).forEach((f) => {
      if (!porSala.has(f.erp_sucursal_id)) porSala.set(f.erp_sucursal_id, []);
      porSala.get(f.erp_sucursal_id).push(f);
    });
    return ERP_ORDEN.filter((s) => porSala.has(s)).map((s) => {
      const lotes = lotesEnUnidades(porSala.get(s));
      return { id: s, nombre: ERP_NAMES[s] ?? `Sala ${s}`, lotes, unidades: lotes.reduce((a, l) => a + l.unidades, 0) };
    }).filter((s) => s.unidades > 0);
  }, [filas]);

  const total = (filas || []).reduce((a, f) => a + unidadesDe(f), 0);
  const titulo = filas?.[0]?.descripcion ?? nombre ?? 'Producto';

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: '' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <View style={{ gap: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 26, fontWeight: '800', letterSpacing: -0.3 }}>{titulo}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Código {id}</Text>
        </View>

        {filas === null ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 30 }}>Cargando…</Text>
        ) : error ? (
          <Text style={{ color: colorSistema.rojo, textAlign: 'center', marginTop: 30 }}>No se pudo cargar. Desliza hacia abajo para intentar de nuevo.</Text>
        ) : (
          <>
            <Vidrio radio={22}>
              <View style={{ padding: 16, flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatNumber(total)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>
                  {total === 1 ? 'unidad' : 'unidades'} en {salas.length} {salas.length === 1 ? 'sala' : 'salas'}
                </Text>
              </View>
            </Vidrio>

            {salas.length ? salas.map((s) => (
              <Vidrio key={s.id} radio={20}><View style={{ paddingHorizontal: 14 }}>
                <View style={{ flexDirection: 'row', paddingVertical: 12, alignItems: 'baseline' }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{s.nombre}</Text>
                  <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatNumber(s.unidades)}</Text>
                </View>
                {s.lotes.map((l) => (
                  <View key={l.clave} style={{ flexDirection: 'row', gap: 10, paddingVertical: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                    <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }} numberOfLines={1}>
                      {l.lote ? `Lote ${l.lote}` : 'Sin lote'}
                    </Text>
                    <Text style={{ color: colorVence(l.vence), fontSize: 14 }}>{l.vence ? `${diasHasta(l.vence) < 0 ? 'venció' : 'vence'} ${fmtVence(l.vence)}` : 'sin fecha'}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 14, fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'right' }}>{formatNumber(l.unidades)}</Text>
                  </View>
                ))}
              </View></Vidrio>
            )) : (
              <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 20 }}>Sin existencias en ninguna sala.</Text>
            )}
            {salas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>{uds(total)} · lo que vence primero va primero</Text> : null}

            {precios.length ? (
              <View style={{ gap: 8 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16, marginTop: 8 }}>Precios</Text>
                {precios.map((p) => (
                  <Vidrio key={p.id_presentacion} radio={20}><View style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
                    <View style={{ flexDirection: 'row', paddingVertical: 10, alignItems: 'baseline', gap: 8 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{p.presentaciones?.tipo || p.descripcion || 'Presentación'}</Text>
                      {Number(p.factor) > 1 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`x${p.factor}`}</Text> : null}
                    </View>
                    {nivelesVisibles(maxPriceLevel).filter((n) => Number(p[n.key]) > 0).map((n) => (
                      <View key={n.key} style={{ flexDirection: 'row', paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 15 }}>{n.label}</Text>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: n.key === 'vineta' ? '800' : '500', fontVariant: ['tabular-nums'] }}>{formatMoney(p[n.key])}</Text>
                      </View>
                    ))}
                  </View></Vidrio>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
