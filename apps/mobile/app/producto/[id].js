// Un producto, NATIVO — su ficha completa, como el expediente del catálogo del
// portal (`ExpandedProductRow`) más la consulta de existencias de la app:
//
//   · la foto grande (y, con el permiso del catálogo, tomarla o cambiarla);
//   · cuánto hay, en qué salas y en qué lotes —lo que vence primero, primero—;
//   · el aviso de «pérdida» o «margen bajo <15 %» (núcleo: `alertaDeMargen`);
//   · cada presentación con su costo y factor, sus precios y su margen;
//   · la ficha: devolutivo/ND, categoría, principios activos y ubicaciones;
//   · los historiales de compras, de precios y de cambios.
//
// Los costos y márgenes sólo con `productos_ver_costos` (la base no los manda
// sin él); los niveles de precio, hasta el tope del cargo (`nivelesVisibles`).
// Editar (foto, devolutivo, categoría) pide `productos_tab_catalogo`, el mismo
// permiso que abre el catálogo del portal donde se edita.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchInventoryByProductIds } from '@nucleo/data/inventory';
import { fetchFichaDeProducto, fetchProductDetail, fetchUbicacionesDeProducto, updateProductDevolutivo } from '@nucleo/data/productos';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { COLUMNAS_DE_PRECIO, alertaDeMargen, nivelesVisibles, specialLossLabel } from '@nucleo/utils/preciosDeProducto';
import { lotesEnUnidades, unidadesDe } from '@nucleo/utils/unidadesInventario';
import { diasHasta, fmtVence } from '@nucleo/utils/pedirTraslado';
import { ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { formatQty as formatNumber } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import Foto from '../../componentes/producto/Foto';
import Precios from '../../componentes/producto/Precios';
import Categoria from '../../componentes/producto/Categoria';
import { CambiosEnLaFicha, HistorialDeCompras, HistorialDePrecios } from '../../componentes/producto/Historiales';
import { fallo } from '../../componentes/Progreso';

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

function Titulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16, marginTop: 6 }}>{texto}</Text>;
}

const textoUbicacion = (u) => {
  const sala = [u.vitrina ? `Vitrina ${u.vitrina}` : null, u.estante ? `Estante ${u.estante}` : null, u.peldano ? `peldaño ${u.peldano}` : null].filter(Boolean).join(' · ');
  const bodega = [u.bodega_numero ? `bodega ${u.bodega_numero}` : null, u.bodega_peldano ? `peldaño ${u.bodega_peldano}` : null].filter(Boolean).join(' · ');
  return [sala, bodega].filter(Boolean).join(' — ') || '—';
};

export default function Producto() {
  const { id, nombre } = useLocalSearchParams();
  const productId = Number(id);
  const { maxPriceLevel, hasPermission } = useAuth();
  const conCosto = hasPermission('productos_ver_costos');
  const puedeEditar = hasPermission('productos_tab_catalogo');
  const branches = useStaffStore((s) => s.branches);
  const [ficha, setFicha] = useState(null);
  const [filas, setFilas] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [eligiendoCategoria, setEligiendoCategoria] = useState(false);
  const [guardandoND, setGuardandoND] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setError(null);
      const [inv, f, det, ub] = await Promise.all([
        fetchInventoryByProductIds([productId]),
        fetchFichaDeProducto(productId),
        fetchProductDetail(productId, COLUMNAS_DE_PRECIO, conCosto),
        fetchUbicacionesDeProducto(productId),
      ]);
      setFilas((inv || []).filter((x) => !x.is_vencidos));
      setFicha(f?.data ?? null);
      const [{ data: precios }, { data: changelog }, { data: prodLog }, { data: principles }, { data: purchases }, { data: precioHistory }] = det;
      setDetalle({ precios: precios || [], changelog: changelog || [], prodLog: prodLog || [], principles: principles || [], purchases: purchases || [], precioHistory: precioHistory || [] });
      setUbicaciones(ub?.data || []);
    } catch (e) {
      setError(e?.message ?? String(e));
      setFilas((x) => x ?? []);
    }
  }, [productId, conCosto]);
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

  const niveles = useMemo(() => nivelesVisibles(maxPriceLevel), [maxPriceLevel]);
  const alerta = useMemo(() => (conCosto && detalle ? alertaDeMargen(detalle.precios, niveles) : { peor: null, especiales: [] }), [conCosto, detalle, niveles]);
  const nombreSala = useMemo(() => new Map((branches || []).map((b) => [Number(b.id), b.name])), [branches]);

  const total = (filas || []).reduce((a, f) => a + unidadesDe(f), 0);
  const titulo = ficha?.nombre ?? filas?.[0]?.descripcion ?? nombre ?? 'Producto';
  const devolutivo = ficha ? !!ficha.devolutivo : true;

  const alternarND = async (esND) => {
    if (!ficha || guardandoND) return;
    setGuardandoND(true);
    const nuevo = !esND;
    const { error: e } = await updateProductDevolutivo(productId, nuevo, { producto: ficha.nombre, desde: 'app' });
    setGuardandoND(false);
    if (e) { fallo('No se pudo guardar', mensajeAmigable(e)); return; }
    Haptics.selectionAsync().catch(() => {});
    setFicha((f) => ({ ...f, devolutivo: nuevo }));
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: '' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Foto productId={productId} url={ficha?.foto_url} puedeCambiar={puedeEditar && !!ficha} onCambiada={(u) => setFicha((f) => ({ ...f, foto_url: u }))} />
        <View style={{ gap: 6 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800', letterSpacing: -0.3 }}>{titulo}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
            {[ficha?.laboratorios?.nombre, `Código ${id}`, ficha?.codigo_barras ? `Barras ${ficha.codigo_barras}` : null].filter(Boolean).join(' · ')}
          </Text>
          {ficha ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {ficha.es_antibiotico ? <Pildora texto="Bajo Receta" color={MARCA.rojo} /> : null}
              {ficha.activo === false ? <Pildora texto="Inactivo" color={colorSistema.texto2} /> : null}
              {!devolutivo ? <Pildora texto="No devolutivo (ND)" color={MARCA.ambar} /> : null}
              {ficha.perecedero ? <Pildora texto="Perecedero" color={MARCA.azulClaro} /> : null}
              {ficha.tipo_medicamento ? <Pildora texto={ficha.tipo_medicamento} color={MARCA.violetaClaro} /> : null}
            </View>
          ) : null}
        </View>

        {error ? <Aviso tono="freno" texto="No se pudo cargar. Desliza hacia abajo para intentar de nuevo." /> : null}

        {alerta.peor !== null && alerta.peor < 15 ? (
          <Vidrio radio={18} tinte={alerta.peor < 0 ? `${MARCA.rojo}22` : `${MARCA.ambar}22`}>
            <View style={{ padding: 14, gap: 2 }}>
              <Text style={{ color: alerta.peor < 0 ? MARCA.rojo : MARCA.ambar, fontSize: 16, fontWeight: '800' }}>{alerta.peor < 0 ? 'Pérdida detectada' : 'Margen bajo'}</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
                {alerta.peor < 0 ? 'Alguna presentación tiene precio de venta por debajo del costo.' : 'Alguna presentación tiene margen inferior al 15 %. Estándar farmacéutico: 20–35 %.'}
              </Text>
            </View>
          </Vidrio>
        ) : null}
        {alerta.especiales.length ? (
          <Vidrio radio={18} tinte="rgba(232,121,249,0.16)">
            <View style={{ padding: 14, gap: 2 }}>
              <Text style={{ color: '#E879F9', fontSize: 16, fontWeight: '800' }}>Pérdida en precio especial</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`${alerta.especiales.map(specialLossLabel).join(' y ')} está por debajo del costo en alguna presentación.`}</Text>
            </View>
          </Vidrio>
        ) : null}

        {filas === null ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 10 }}>Cargando…</Text>
        ) : (
          <>
            <Titulo texto="Existencias" />
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
                    <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }}>{l.lote ? `Lote ${l.lote}` : 'Sin lote'}</Text>
                    <Text style={{ color: colorVence(l.vence), fontSize: 14 }}>{l.vence ? `${diasHasta(l.vence) < 0 ? 'venció' : 'vence'} ${fmtVence(l.vence)}` : 'sin fecha'}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 14, fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'right' }}>{formatNumber(l.unidades)}</Text>
                  </View>
                ))}
              </View></Vidrio>
            )) : (
              <Text style={{ color: colorSistema.texto2, textAlign: 'center' }}>Sin existencias en ninguna sala.</Text>
            )}
            {salas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>{uds(total)} · lo que vence primero va primero</Text> : null}
            <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/minmax-producto', params: { producto: String(productId), nombre: titulo } }); }}
              hitSlop={8} style={{ alignSelf: 'center', minHeight: 36, justifyContent: 'center' }}>
              <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>Ver su Mín·Máx por sala</Text>
            </Pressable>
          </>
        )}

        {detalle?.precios?.length ? (
          <>
            <Titulo texto="Presentaciones y precios" />
            <Precios precios={detalle.precios} niveles={niveles} changelog={detalle.changelog} conCosto={conCosto} />
          </>
        ) : null}

        {ficha ? (
          <Seccion titulo="Ficha">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>No devolutivo (ND)</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{devolutivo ? 'Se puede devolver al proveedor antes de vencer.' : 'El proveedor NO acepta la devolución.'}</Text>
              </View>
              <Switch value={!devolutivo} disabled={!puedeEditar || guardandoND} onValueChange={(v) => alternarND(v)} trackColor={{ true: MARCA.ambar }} />
            </View>
            <Pressable disabled={!puedeEditar} onPress={() => { Haptics.selectionAsync().catch(() => {}); setEligiendoCategoria(true); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Categoría</Text>
              <Text style={{ color: ficha.tipo_medicamento ? colorSistema.texto : colorSistema.texto2, fontSize: 16 }}>{ficha.tipo_medicamento || 'Sin categoría'}</Text>
              {puedeEditar ? <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text> : null}
            </Pressable>
          </Seccion>
        ) : null}

        {detalle ? (
          <Seccion titulo="Principios activos">
            {detalle.principles.length ? detalle.principles.map((p, i) => (
              <Dato key={p.id ?? i} primero={i === 0} rotulo={p.nombre} valor={p.concentracion || '—'} />
            )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{ficha?.principio_activo || 'Sin principios activos registrados.'}</Text>}
          </Seccion>
        ) : null}

        {ubicaciones.length ? (
          <Seccion titulo="Ubicaciones">
            {ubicaciones.map((u, i) => <Dato key={u.branch_id} primero={i === 0} rotulo={nombreSala.get(Number(u.branch_id)) ?? `Sala ${u.branch_id}`} valor={textoUbicacion(u)} />)}
          </Seccion>
        ) : null}

        {detalle ? (
          <>
            <Titulo texto="Historial de compras" />
            <HistorialDeCompras purchases={detalle.purchases} conCosto={conCosto} />
            <Titulo texto="Historial de precios" />
            <HistorialDePrecios history={detalle.precioHistory} niveles={niveles} />
            <Titulo texto="Cambios en el producto" />
            <CambiosEnLaFicha prodLog={detalle.prodLog} />
          </>
        ) : null}
      </ScrollView>
      {eligiendoCategoria && ficha ? (
        <Categoria productId={productId} actual={ficha.tipo_medicamento} onCerrar={() => setEligiendoCategoria(false)}
          onGuardada={(cat) => { setFicha((f) => ({ ...f, tipo_medicamento: cat })); setEligiendoCategoria(false); }} />
      ) : null}
    </>
  );
}
