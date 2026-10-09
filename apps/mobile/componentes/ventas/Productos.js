// La vista «Productos» de Ventas en la app — la pestaña del mismo nombre del
// portal: qué se vendió en el período, de más a menos, con sus unidades (las
// presentaciones por su factor), lo que dejó sin IVA, el costo y el margen.
// Arriba los totales del período, contra el período anterior equivalente.
// La fila y los totales salen del núcleo (`filaDeProductoVendido`,
// `totalesDeProductos`); los que alguien ocultó de Ventas no salen, igual que
// en el portal. Tocar uno abre lo que vendió por sala, por vendedor y por mes.
//
// Como el portal: «Ver ocultos» muestra SÓLO los ocultos para destaparlos, el
// filtro por laboratorio, y mantener presionado un producto lo oculta (o lo
// vuelve a mostrar) para todos (`alternarProductoOcultoEnVentas`). Con
// «Ocultar montos» las cifras salen como puntos.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { alternarProductoOcultoEnVentas, fetchTotalVendidoPorProductos, fetchVentasPorProducto } from '@nucleo/data/ventas';
import {
  cuantosOcultos, diasDelRango, filaDeProductoVendido, laboratoriosDeProductos, montoPrivado, periodoAnterior, productosSegunOcultos,
  totalesDeProductos, variacionPorDia,
} from '@nucleo/utils/ventasPeriodo';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

const POR_PAGINA = 40;
const conSigno = (pct) => (pct == null ? null : `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% por día`);
const colorDeMargen = (m) => (m == null ? colorSistema.texto2 : m < 10 ? MARCA.rojo : m < 25 ? MARCA.ambar : MARCA.verde);
export const ORDENES_DE_PRODUCTOS = [
  { id: 'neto', label: 'Más ingreso' }, { id: 'cantidad_base', label: 'Más unidades' },
  { id: 'utilidad', label: 'Más utilidad' }, { id: 'margen', label: 'Mayor margen' },
];

export default function Productos({ fini, ffin, sala, busqueda, verCifras, orden = 'neto', verOcultos = false, laboratorio = 'todos', onLaboratorios, privado = false }) {
  const [todas, setTodas] = useState(null);
  const [vuelta, setVuelta] = useState(0);
  const [previo, setPrevio] = useState(null);
  const [error, setError] = useState(null);
  const [cuantos, setCuantos] = useState(POR_PAGINA);

  useEffect(() => {
    let vivo = true;
    const branch = sala ? Number(sala) : null;
    const { prevFini, prevFfin } = periodoAnterior(fini, ffin);
    Promise.all([
      fetchVentasPorProducto({ p_fini: fini, p_ffin: ffin, p_branch_id: branch }),
      fetchTotalVendidoPorProductos({ p_fini: prevFini, p_ffin: prevFfin, p_branch_id: branch }),
    ]).then(([act, ant]) => {
      if (!vivo) return;
      if (act.error) throw act.error;
      setError(null);
      setTodas((act.data || []).map(filaDeProductoVendido));
      setPrevio({ neto: parseFloat(ant.data || 0), dias: diasDelRango(prevFini, prevFfin) });
    }).catch(() => { if (vivo) { setError('No se pudieron cargar los productos.'); setTodas([]); } });
    return () => { vivo = false; };
  }, [fini, ffin, sala, vuelta]);

  const base = useMemo(() => (todas == null ? null : productosSegunOcultos(todas, verOcultos)), [todas, verOcultos]);
  const labs = useMemo(() => laboratoriosDeProductos(base), [base]);
  useEffect(() => { onLaboratorios?.(labs); }, [labs, onLaboratorios]);
  const filas = useMemo(() => (base == null ? null : laboratorio === 'todos' ? base : base.filter((r) => String(r.laboratorio_id) === laboratorio)), [base, laboratorio]);
  const ocultos = cuantosOcultos(todas);
  const m = (t) => montoPrivado(t, privado);

  const alternarOculto = (r) => {
    const ocultar = !r.oculto_en_ventas;
    Alert.alert(ocultar ? 'Ocultar el producto' : 'Volver a mostrar',
      ocultar ? `«${r.descripcion}» deja de salir en Ventas para todos. Se puede volver a mostrar desde «Ver ocultos».` : `«${r.descripcion}» vuelve a salir en Ventas para todos.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: ocultar ? 'Ocultar' : 'Mostrar', style: ocultar ? 'destructive' : 'default', onPress: async () => {
          const { error: e } = await alternarProductoOcultoEnVentas({ p_erp_product_id: r.erp_product_id, p_oculto: ocultar }, { producto: r.descripcion, desde: 'app' });
          if (e) { fallo('No se pudo cambiar', mensajeAmigable(e)); return; }
          listo(ocultar ? 'Producto oculto' : 'Producto visible', '');
          setVuelta((v) => v + 1);
        } },
      ]);
  };

  const tot = useMemo(() => totalesDeProductos(filas), [filas]);
  const lista = useMemo(() => {
    const base = busqueda
      ? smartFilter(busqueda, filas || [], (r) => [r.descripcion, r.laboratorio_nombre, ...r.presentaciones.map((p) => p.presentacion)]).results
      : (filas || []);
    return [...base].sort((a, b) => (b[orden] ?? -Infinity) - (a[orden] ?? -Infinity));
  }, [filas, busqueda, orden]);
  useEffect(() => { setCuantos(POR_PAGINA); }, [busqueda, orden, laboratorio, verOcultos]);   // eslint-disable-line react-hooks/set-state-in-effect -- vuelve al principio al cambiar la lista

  if (filas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  const dias = diasDelRango(fini, ffin);

  return (
    <>
      {verCifras ? (
        <>
          <FilaDeKpis>
            <Kpi icono="TrendingUp" rotulo="Ingresos sin IVA" valor={m(formatMoney(tot.neto, { decimales: 0 }))} color={MARCA.azul}
              apoyo={previo ? conSigno(variacionPorDia(tot.neto, dias, previo.neto, previo.dias)) : null} />
            <Kpi icono="Wallet" rotulo="Utilidad" valor={m(formatMoney(tot.utilidad, { decimales: 0 }))} color={MARCA.verde}
              apoyo={privado ? null : `margen ${tot.margen.toFixed(1)}%`} />
          </FilaDeKpis>
        </>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
        {`${lista.length.toLocaleString('es-SV')} producto${lista.length === 1 ? '' : 's'}${verOcultos ? ' ocultos' : ocultos ? ` · ${ocultos} ocultos de Ventas` : ''} · mantén presionado para ${verOcultos ? 'volver a mostrar' : 'ocultar'}`}
      </Text>
      {lista.slice(0, cuantos).map((r, i) => (
        <Pressable key={r.erp_product_id ?? r.descripcion}
          onPress={() => { if (privado) return; Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/producto-vendido/[id]', params: { id: String(r.erp_product_id), nombre: r.descripcion, fini, ffin, sala: sala ?? '' } }); }}
          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); alternarOculto(r); }} delayLongPress={350}
          style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <Vidrio radio={20} interactivo>
            <View style={{ padding: 14, gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Text style={{ width: 26, color: i < 3 ? MARCA.ambar : colorSistema.texto2, fontSize: 15, fontWeight: '800', textAlign: 'center' }}>{i + 1}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{r.descripcion}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                    {[r.laboratorio_nombre, `${r.cantidad_base.toLocaleString('es-SV')} unidades`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{m(formatMoney(r.neto, { decimales: 0 }))}</Text>
                  {r.margen != null && !privado ? <Pildora texto={`${r.margen.toFixed(0)}%`} color={colorDeMargen(r.margen)} /> : null}
                </View>
              </View>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: colorSistema.separador, overflow: 'hidden', marginLeft: 38 }}>
                <View style={{ width: privado ? '0%' : `${Math.max(1, Math.round((r.neto / tot.mayor) * 100))}%`, height: 4, backgroundColor: MARCA.azulClaro }} />
              </View>
            </View>
          </Vidrio>
        </Pressable>
      ))}
      {lista.length > cuantos ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setCuantos((n) => n + POR_PAGINA)} /></View> : null}
      {!lista.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
          {busqueda ? 'Ningún producto con esa búsqueda' : verOcultos ? 'No hay productos ocultos' : 'Sin ventas en este período'}
        </Text>
      ) : null}
    </>
  );
}
