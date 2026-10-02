// Lo que se vendió de un producto en el período, NATIVO — el detalle que el
// portal abre al expandir un producto en Ventas › Productos: el total y las
// unidades, en qué sala y quién lo vendió (`get_product_drill_summary`), los
// últimos tres meses (`get_product_trend`) y las ventas una por una, con el
// precio como lo pagó el cliente (`precioALaVista`: el crédito fiscal sin IVA).
// Tocar una venta abre la factura.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchLineasDeVentaDelProducto, fetchResumenDelProductoVendido, fetchTendenciaDelProducto } from '@nucleo/data/ventas';
import { precioALaVista } from '@nucleo/utils/ventasPeriodo';
import { fechaTexto, etiquetaMes } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { ordenDeSala } from '@nucleo/constants/erp';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import Avatar from '../../componentes/Avatar';
import { MARCA } from '../../componentes/inicio/marca';

const POR_PAGINA = 20;

function Barra({ rotulo, valor, parte, apoyo, izquierda = null }) {
  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {izquierda}
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{rotulo}</Text>
        {apoyo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{apoyo}</Text> : null}
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor}</Text>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(1, Math.round(parte * 100))}%`, height: 4, backgroundColor: MARCA.azulClaro }} />
      </View>
    </View>
  );
}

export default function ProductoVendido() {
  const { id, nombre, fini, ffin, sala } = useLocalSearchParams();
  const sucursales = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const porCodigo = useMemo(() => new Map((empleados || []).map((e) => [e.code, e])), [empleados]);
  const nombreDeSala = (b) => (sucursales || []).find((x) => Number(x.id) === Number(b))?.name ?? `Sala ${b}`;
  const [resumen, setResumen] = useState(null);
  const [meses, setMeses] = useState([]);
  const [lineas, setLineas] = useState([]);
  const [cuantas, setCuantas] = useState(POR_PAGINA);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const branch = sala ? Number(sala) : null;
    const p = { p_erp_product_id: Number(id), p_fini: fini, p_ffin: ffin, p_branch_id: branch };
    const [r, t, l] = await Promise.all([
      fetchResumenDelProductoVendido(p),
      fetchTendenciaDelProducto({ p_erp_product_id: Number(id), p_branch_id: branch, p_fini: fini, p_ffin: ffin }),
      fetchLineasDeVentaDelProducto(p),
    ]);
    if (r.error || l.error) { setError('No se pudo cargar el detalle.'); return; }
    setError(null);
    setResumen(r.data ?? null);
    setMeses(t.data || []);
    setLineas([...(l.data || [])].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))));
  }, [id, fini, ffin, sala]);
  useEffect(() => { cargar(); }, [cargar]);

  const salas = [...(resumen?.por_sucursal || [])].sort((a, b) => b.neto - a.neto || ordenDeSala(a.branch_id) - ordenDeSala(b.branch_id));
  const totalSalas = salas.reduce((s, x) => s + parseFloat(x.neto || 0), 0) || 1;
  const vendedores = resumen?.por_vendedor || [];
  const mayorVendedor = Math.max(1, ...vendedores.map((v) => parseFloat(v.neto || 0)));
  const mayorMes = Math.max(1, ...meses.map((m) => parseFloat(m.neto || 0)));

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Lo que se vendió' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <View style={{ gap: 4, marginHorizontal: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{nombre}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
            {[sala ? nombreDeSala(sala) : 'Todas las salas', `${fechaTexto(fini, { day: 'numeric', month: 'short' })} – ${fechaTexto(ffin, { day: 'numeric', month: 'short' })}`].join(' · ')}
          </Text>
        </View>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {resumen ? (
          <View style={{ marginHorizontal: -16 }}>
            <FilaDeKpis>
              <Kpi icono="TrendingUp" rotulo="Vendido" apoyo="como lo pagó el cliente" valor={formatMoney(resumen.total_display, { decimales: 0 })} color={MARCA.verde} />
              <Kpi icono="Package" rotulo="Unidades" apoyo={`${resumen.total_count} venta${resumen.total_count === 1 ? '' : 's'}`} valor={Number(resumen.total_cantidad_base || 0).toLocaleString('es-SV')} color={MARCA.azul} />
            </FilaDeKpis>
          </View>
        ) : null}
        {meses.length ? (
          <Seccion titulo="Últimos meses" pie="Sin IVA.">
            {meses.map((m) => (
              <Barra key={m.month} rotulo={etiquetaMes(String(m.month).slice(0, 7))} valor={formatMoney(m.neto, { decimales: 0 })}
                apoyo={`${Number(m.cantidad || 0).toLocaleString('es-SV')} u.`} parte={parseFloat(m.neto || 0) / mayorMes} />
            ))}
          </Seccion>
        ) : null}
        {!sala && salas.length > 1 ? (
          <Seccion titulo="Por sala">
            {salas.map((s) => (
              <Barra key={s.branch_id} rotulo={nombreDeSala(s.branch_id)} valor={formatMoney(s.neto, { decimales: 0 })}
                apoyo={`${Number(s.cantidad_base || 0).toLocaleString('es-SV')} u.`} parte={parseFloat(s.neto || 0) / totalSalas} />
            ))}
          </Seccion>
        ) : null}
        {vendedores.length ? (
          <Seccion titulo="Quién lo vendió">
            {vendedores.slice(0, 10).map((v) => {
              const emp = porCodigo.get(v.cod_vendedor);
              return (
                <Barra key={v.cod_vendedor} rotulo={emp ? shortEmployeeName(emp) : `Código ${v.cod_vendedor}`}
                  izquierda={<Avatar empleado={emp ?? { name: String(v.cod_vendedor) }} tamano={28} />}
                  valor={formatMoney(v.neto, { decimales: 0 })} apoyo={`${Number(v.cantidad_base || 0).toLocaleString('es-SV')} u.`}
                  parte={parseFloat(v.neto || 0) / mayorVendedor} />
              );
            })}
          </Seccion>
        ) : null}
        {lineas.length ? (
          <Seccion titulo={`Ventas · ${lineas.length}`}>
            {lineas.slice(0, cuantas).map((l, i) => {
              const { precio, neto } = precioALaVista(l);
              const emp = porCodigo.get(l.cod_vendedor);
              return (
                <Pressable key={l.item_id ?? i} disabled={!l.invoice_id}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/venta/[id]', params: { id: String(l.invoice_id) } }); }}
                  style={({ pressed }) => ({ gap: 4, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{l.cliente || 'Consumidor final'}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(neto)}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                    {[fechaTexto(l.fecha, { day: 'numeric', month: 'short' }), sala ? null : nombreDeSala(l.branch_id), emp ? shortEmployeeName(emp) : null,
                      `${l.cantidad} × ${formatMoney(precio)}`].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {l.presentacion ? <Pildora texto={l.presentacion} color={colorSistema.texto2} /> : null}
                    {l.tipo_documento ? <Pildora texto={l.tipo_documento} color={MARCA.azulClaro} /> : null}
                    {l.lote ? <Pildora texto={`Lote ${l.lote}`} color={MARCA.azulClaro} /> : null}
                  </View>
                </Pressable>
              );
            })}
            {lineas.length > cuantas ? <BotonGrande texto="Ver más" borde onPress={() => setCuantas((n) => n + POR_PAGINA)} /> : null}
          </Seccion>
        ) : null}
      </ScrollView>
    </>
  );
}
