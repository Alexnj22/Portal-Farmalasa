// Gestión de stock, NATIVO — las dos preguntas de `GestionStockView` sobre la
// existencia de una sala:
//
//  · Sin venta: lo que lleva seis meses sin venderse, agrupado por ADÓNDE
//    mandarlo (`productos_parados_de_sala`, el mismo juez del aviso semanal).
//    «Armar envío» abre el formulario nativo de envío ARMADO (el `precarga`
//    del portal): a otra sala todo, a Bodega sólo presentaciones completas
//    (`productosDeEnvioSugerido`), y lo que salió con Min/Max se pide en 0/0.
//    Las tarjetas «A otra sala» / «A Bodega» filtran, igual que en el portal.
//  · Sin Min/Max: lo que se vende y el pedido no repone solo, con qué hacer con
//    cada uno. Desde acá se pide (o aplica, si el cargo aprueba) el Min/Max, y
//    se descarta o restaura una sugerencia.
//
// Agrupar, sugerir y validar salen del núcleo (`gestionDeStock`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchProductosParadosDeSala, fetchVendidosSinMinMax } from '@nucleo/data/inventarioTab';
import { fetchUnidadDeDespacho } from '@nucleo/data/inventory';
import { useStaffStore } from '@nucleo/store/staffStore';
import { deleteMinMaxIgnored, fetchMinMaxIgnored, upsertMinMaxIgnored } from '@nucleo/data/stockParams';
import { solicitarMinMax } from '@nucleo/data/minmaxRequests';
import { BRANCH_A_ERP, ERP_BODEGA, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import {
  conteosMinMax, csvDeParados, csvSinMinMax, cuantosArmables, FILTROS_MINMAX, gruposPorDestino, motivoDeMinMax, notaDeEnvioSugerido,
  ordenarSinMinMax, POR_ENVIO, problemaDeMinMax, productosDeEnvioSugerido, sugerenciaMinMax, totalesDeParados,
} from '@nucleo/utils/gestionDeStock';
import { esPocoParaMandar, nombreDeDespacho, paraBodega } from '@nucleo/utils/unidadDeDespacho';
import { porQueDesde } from '@nucleo/utils/productosParados';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import ConAurora from '../componentes/ConAurora';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { compartirCsv } from '../componentes/fiscal/csv';
import { dejarEnvioSugerido } from '../componentes/inventario/envioSugerido';

const VISIBLES = 8;
const COLOR_NIVEL = { agregar: MARCA.verde, evaluar: MARCA.ambar, encargo: MARCA.violeta, mayorista: MARCA.azulClaro, omitir: colorSistema.texto2 };
const corta = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short', year: 'numeric' }) : null);
const n = (x) => Number(x || 0).toLocaleString('es-SV');

/* Lo que la regla de despacho dice de esta fila: a Bodega, cuántas vuelven
 * (o que no vuelve nada); a otra sala, sólo si no llega a una presentación. */
function notaDeDespacho(existencia, u, aBodega) {
  if (!u || Number(u.unidades) <= 1) return null;
  const nombre = nombreDeDespacho(u);
  if (aBodega) {
    const b = paraBodega(existencia, u);
    if (b.completos === 0) return { texto: `No vuelve: no completa ${nombre}`, color: MARCA.rojo };
    return { texto: b.quedan > 0 ? `Vuelven ${b.viajan} de ${Number(existencia)} (en ${nombre})` : `Vuelven en ${nombre}`, color: colorSistema.texto2 };
  }
  return esPocoParaMandar(existencia, u) ? { texto: `Poco: ${Number(existencia)} de ${nombre}`, color: MARCA.ambar } : null;
}

function SinVenta({ sala, busqueda, filtro, puedeArmar, onExportar, onConMinmax, onRecargar }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [haciaDonde, setHaciaDonde] = useState(null);   // null | 'sala' | 'bodega' (las tarjetas)
  const [despacho, setDespacho] = useState(() => new Map());
  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchProductosParadosDeSala({ p_erp_sucursal_id: sala });
    setError(e ? mensajeAmigable(e) : null);
    const rows = Array.isArray(data) ? data : [];
    setFilas(rows);
    // Cómo se despacha cada uno: decide qué vuelve a Bodega y cuándo avisar
    // que es poco. Si falla, la lista se ve igual y a Bodega no se arma.
    fetchUnidadDeDespacho(rows.map((r) => r.erp_product_id)).then(setDespacho).catch(() => {});
  }, [sala]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    let rows = filtro === 'minmax' ? (filas || []).filter((r) => r.en_minmax) : (filas || []);
    if (haciaDonde === 'sala') rows = rows.filter((r) => Number(r.destino) !== ERP_BODEGA);
    if (haciaDonde === 'bodega') rows = rows.filter((r) => Number(r.destino) === ERP_BODEGA);
    return busqueda ? smartFilter(busqueda, rows, (r) => [r.producto, r.laboratorio]).results : rows;
  }, [filas, filtro, haciaDonde, busqueda]);
  const grupos = useMemo(() => gruposPorDestino(visibles, ERP_BODEGA), [visibles]);
  const t = useMemo(() => totalesDeParados(visibles, filas || [], ERP_BODEGA), [visibles, filas]);
  const veCostos = (filas || []).some((r) => r.costo != null);
  const nombreSala = ERP_NAMES[sala] || `Sucursal ${sala}`;

  useEffect(() => { onConMinmax(t.conMinmax); }, [t.conMinmax, onConMinmax]);
  useEffect(() => {
    onExportar(filas?.length ? async () => {
      const { headers, rows, nombre } = csvDeParados(grupos, sala, ERP_NAMES, hoySV());
      if (!rows.length) return;
      const ok = await compartirCsv({ headers, rows, nombre, modulo: 'inventario_sin_venta' });
      if (ok) useStaffStore.getState().appendAuditLog?.('EXPORT_SIN_VENTA', null, { vista: 'parados', sucursal: nombreSala, filtro, busqueda: busqueda || null, count: rows.length, desde: 'app' });
    } : null);
  }, [filas, grupos, sala, filtro, busqueda, nombreSala, onExportar]);

  const armar = (g) => {
    Haptics.selectionAsync().catch(() => {});
    dejarEnvioSugerido({
      origenErp: sala, destino: g.destino, motivo: 'Baja rotación',
      nota: notaDeEnvioSugerido(g.destino, ERP_BODEGA, nombreSala, ERP_NAMES[g.destino]),
      productos: productosDeEnvioSugerido(g, despacho, ERP_BODEGA, POR_ENVIO),
      filas: filas || [],
      alTerminar: onRecargar,
    });
    router.push({ pathname: '/enviar-producto', params: { sugerido: '1' } });
  };
  const alternarHacia = (v) => setHaciaDonde((x) => (x === v ? null : v));

  if (filas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      <FilaDeKpis>
        <Kpi icono="Package" rotulo="Sin venta" valor={n(t.productos)} color={MARCA.ambar} apoyo="productos · 6 meses" />
        {veCostos
          ? <Kpi icono="DollarSign" rotulo="Costo detenido" valor={formatMoney(t.costo)} color={MARCA.violeta} apoyo={`${n(t.unidades)} unidades`} />
          : <Kpi icono="Boxes" rotulo="Unidades" valor={n(t.unidades)} color={MARCA.azul} apoyo="en existencia" />}
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="Truck" rotulo="A otra sala" valor={n(t.aSala)} color={MARCA.azulClaro} pide={haciaDonde === 'sala'}
          apoyo={haciaDonde === 'sala' ? 'filtrando · toca para quitar' : 'allá sí se venden'} onPress={() => alternarHacia('sala')} />
        <Kpi icono="Archive" rotulo="A Bodega" valor={n(t.aBodega)} color={MARCA.violeta} pide={haciaDonde === 'bodega'}
          apoyo={haciaDonde === 'bodega' ? 'filtrando · toca para quitar' : 'no se venden en ninguna'} onPress={() => alternarHacia('bodega')} />
      </FilaDeKpis>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {!puedeArmar && grupos.length ? (
        <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto={`Estás viendo ${nombreSala}. Los envíos los arma quien trabaja en esa sala.`} /></View>
      ) : null}
      {grupos.map((g) => {
        const abierto = abiertos.has(g.destino);
        const lista = abierto ? g.filas : g.filas.slice(0, VISIBLES);
        const aBodega = g.destino === ERP_BODEGA;
        const armables = cuantosArmables(g, despacho, ERP_BODEGA);
        return (
          <View key={g.destino} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginHorizontal: 20, marginTop: 6 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>
                {`${aBodega ? 'Devolver a' : 'Mandar a'} ${ERP_NAMES[g.destino] || `Sucursal ${g.destino}`}`}
              </Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[`${g.filas.length} producto${g.filas.length === 1 ? '' : 's'}`, veCostos ? formatMoney(g.costo) : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {aBodega ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
                Ninguna sala vendió 3 o más en 6 meses · se devuelve por presentación completa
              </Text>
            ) : null}
            {lista.map((r) => {
              const otras = Array.isArray(r.vendido_en) ? r.vendido_en : [];
              const nota = notaDeDespacho(r.existencia, despacho.get(Number(r.erp_product_id)), aBodega);
              return (
                <View key={r.erp_product_id} style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={18}>
                    <View style={{ padding: 12, gap: 5 }}>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{r.producto}</Text>
                          {r.laboratorio ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{r.laboratorio}</Text> : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{n(r.existencia)}</Text>
                          <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{r.costo != null ? formatMoney(r.costo) : 'unidades'}</Text>
                        </View>
                      </View>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {r.desde ? `Sin venta desde ${corta(r.desde)} · ${porQueDesde(r)}${r.dias != null ? ` · ${r.dias} días` : ''}` : porQueDesde(r)}
                      </Text>
                      {nota ? <Text style={{ color: nota.color, fontSize: 13, fontWeight: '600' }}>{nota.texto}</Text> : null}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {otras.length ? otras.slice(0, 3).map((v) => (
                          <Pildora key={v.esid} texto={`${ERP_NAMES[v.esid] || `Suc.${v.esid}`} · ${n(v.unidades)}`}
                            color={Number(v.esid) === Number(g.destino) ? MARCA.verde : colorSistema.texto2} />
                        )) : <Pildora texto="No se vende en ninguna sala" color={colorSistema.texto2} />}
                        {r.en_minmax ? <Pildora texto={`Min ${r.min_qty ?? '—'} · Max ${r.max_qty ?? '—'}`} color={MARCA.ambar} /> : null}
                      </View>
                    </View>
                  </Vidrio>
                </View>
              );
            })}
            {g.filas.length > VISIBLES ? (
              <Pressable onPress={() => setAbiertos((s) => { const x = new Set(s); if (x.has(g.destino)) x.delete(g.destino); else x.add(g.destino); return x; })}
                style={{ minHeight: 44, justifyContent: 'center', marginHorizontal: 20 }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>{abierto ? 'Ver menos' : `Ver los ${g.filas.length}`}</Text>
              </Pressable>
            ) : null}
            {puedeArmar ? (
              <View style={{ marginHorizontal: 16, gap: 6 }}>
                <BotonGrande
                  texto={`Armar envío a ${ERP_NAMES[g.destino] || 'la sala'}${armables > POR_ENVIO ? ` · ${POR_ENVIO} de ${armables}` : aBodega && armables < g.filas.length ? ` · ${armables}` : ''}`}
                  color={aBodega ? MARCA.violeta : MARCA.azul} borde={aBodega}
                  deshabilitado={armables === 0 || (aBodega && despacho.size === 0)}
                  onPress={() => armar(g)} />
                {aBodega && armables === 0 && despacho.size > 0 ? (
                  <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>Ninguno completa su presentación de despacho.</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      {!grupos.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40, marginHorizontal: 20 }}>
          {busqueda || filtro !== 'todos' || haciaDonde ? 'Nada con ese filtro' : `Todo se vende en ${nombreSala}: nada lleva seis meses parado`}
        </Text>
      ) : null}
    </>
  );
}

function Ajuste({ fila, sala, puedePedir, puedeAplicar, descartado, onCerrar, onHecho, onDescartar }) {
  const { user } = useAuth();
  const s = fila ? sugerenciaMinMax(fila) : null;
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { if (s) { setMin(String(s.minSug ?? '')); setMax(String(s.maxSug ?? '')); } }, [fila]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!fila) return null;
  const problema = problemaDeMinMax(min, max);
  // Igual que el portal: pedir o aplicar sólo donde la sugerencia es agregar o evaluar.
  const ofrecer = s.level === 'agregar' || s.level === 'evaluar';
  const pedir = async () => {
    setEnviando(true); trabajando(puedeAplicar ? 'Aplicando…' : 'Pidiendo…');
    const r = await solicitarMinMax({
      erp_product_id: Number(fila.erp_product_id), erp_sucursal_id: Number(sala), product_name: fila.product_name,
      current_min: null, current_max: null, current_sales_6m: Number(fila.units_sold) || 0,
      requested_min: Number(min), requested_max: Number(max), reason: motivoDeMinMax(fila),
      requested_by: user?.email ?? '', requested_by_id: user?.id ?? null, requested_by_name: user?.name ?? null,
    }, { aplicar: puedeAplicar }, { sucursal: ERP_NAMES[sala], producto: fila.product_name, erp_product_id: fila.erp_product_id, min: Number(min), max: Number(max), desde: 'app' });
    setEnviando(false);
    if (!r.ok) { fallo('No se pudo pedir', mensajeAmigable({ message: r.error })); return; }
    if (r.aplicado) listo('Aplicado', `Min ${min} · Max ${max}`);
    else if (puedeAplicar) fallo('Quedó pedido', `No se pudo aplicar: resuélvelo en Solicitudes.`);
    else listo('Pedido', 'Lo aprueba quien aprueba Min/Max.');
    onHecho(fila.erp_product_id, r.aplicado ? 'aplicado' : 'pedido');
  };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }} numberOfLines={2}>{fila.product_name}</Text>
              <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Pildora texto={s.label} color={COLOR_NIVEL[s.level]} />
              <Pildora texto={s.reason} color={colorSistema.texto2} />
            </View>
            <Seccion titulo="En los últimos seis meses">
              <Text style={{ color: colorSistema.texto, fontSize: 15, lineHeight: 22 }}>
                {`${n(fila.units_sold)} unidades · ${formatMoney(fila.revenue)}\n${s.months} de 6 meses con venta · ${s.invoices} factura${s.invoices === 1 ? '' : 's'} (${s.avgPerInv.toFixed(1)} por factura)`}
              </Text>
            </Seccion>
            {!ofrecer ? (
              <Aviso tono="nota" texto="La sugerencia es no agregarle Min/Max: no se ofrece pedirlo." />
            ) : puedePedir ? (
              <>
                <Seccion titulo={puedeAplicar ? 'Min y Max que se aplican' : 'Min y Max que se piden'}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginLeft: 4 }}>Min</Text>
                      <Campo multiline={false} value={min} onChangeText={(v) => setMin(v.replace(/[^\d]/g, ''))} keyboardType="number-pad" style={{ textAlign: 'center', fontSize: 20, fontWeight: '700' }} />
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginLeft: 4 }}>Max</Text>
                      <Campo multiline={false} value={max} onChangeText={(v) => setMax(v.replace(/[^\d]/g, ''))} keyboardType="number-pad" style={{ textAlign: 'center', fontSize: 20, fontWeight: '700' }} />
                    </View>
                  </View>
                </Seccion>
                {problema && (min || max) ? <Aviso tono="nota" texto={problema} /> : null}
                <BotonGrande texto={enviando ? 'Enviando…' : (puedeAplicar ? 'Aplicar Min/Max' : 'Pedir Min/Max')} color={MARCA.verde}
                  deshabilitado={enviando || !!problema} onPress={pedir} />
              </>
            ) : <Aviso tono="nota" texto="Tu cargo no puede pedir ajustes de Min/Max." />}
            <BotonGrande texto={descartado ? 'Volver a sugerirlo' : 'Descartar la sugerencia'} borde color={descartado ? MARCA.azulClaro : MARCA.rojo}
              onPress={() => onDescartar(fila.erp_product_id, !descartado)} />
          </ScrollView>
        </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}

function SinMinMax({ sala, busqueda, filtro, orden, puedePedir, puedeAplicar, onConteos, onFiltro, onExportar }) {
  const [filas, setFilas] = useState(null);
  const [ignorados, setIgnorados] = useState(() => new Set());
  const [hechos, setHechos] = useState(() => new Map());
  const [error, setError] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [mostrar, setMostrar] = useState(30);
  const cargar = useCallback(async () => {
    const [{ data, error: e }, ign] = await Promise.all([fetchVendidosSinMinMax({ p_erp_sucursal_id: sala }), fetchMinMaxIgnored(sala)]);
    setError(e ? mensajeAmigable(e) : null);
    setFilas(Array.isArray(data) ? data : []);
    if (!ign?.error) setIgnorados(new Set((ign?.data ?? []).map((r) => r.erp_product_id)));
  }, [sala]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]);
  useEffect(() => { setMostrar(30); }, [filtro, busqueda]);

  const conteos = useMemo(() => conteosMinMax(filas || [], ignorados), [filas, ignorados]);
  const ultimo = useRef(null);
  useEffect(() => { const k = JSON.stringify(conteos); if (k !== ultimo.current) { ultimo.current = k; onConteos(conteos); } }, [conteos, onConteos]);
  const filtradas = useMemo(() => {
    let rows = filtro === 'ignorado'
      ? (filas || []).filter((r) => ignorados.has(r.erp_product_id))
      : (filas || []).filter((r) => !ignorados.has(r.erp_product_id) && sugerenciaMinMax(r).level === filtro);
    if (busqueda) rows = smartFilter(busqueda, rows, (r) => [r.product_name, r.laboratorio]).results;
    const [campo, dir] = orden.split(':');
    return ordenarSinMinMax(rows, campo, dir);
  }, [filas, filtro, ignorados, busqueda, orden]);
  const venta6m = useMemo(() => (filas || []).reduce((s, r) => s + Number(r.revenue || 0), 0), [filas]);
  const nombreSala = ERP_NAMES[sala] || `Sucursal ${sala}`;

  useEffect(() => {
    onExportar(filtradas.length ? async () => {
      const { headers, rows, nombre } = csvSinMinMax(filtradas, ignorados, sala, ERP_NAMES, hoySV());
      const ok = await compartirCsv({ headers, rows, nombre, modulo: 'inventario_sin_venta' });
      if (ok) useStaffStore.getState().appendAuditLog?.('EXPORT_SIN_VENTA', null, { vista: 'sin_minmax', sucursal: nombreSala, filtro, busqueda: busqueda || null, count: rows.length, desde: 'app' });
    } : null);
  }, [filtradas, ignorados, sala, filtro, busqueda, nombreSala, onExportar]);

  const descartar = async (id, si) => {
    setIgnorados((p) => { const x = new Set(p); if (si) x.add(id); else x.delete(id); return x; });
    const { error: e } = si ? await upsertMinMaxIgnored(sala, id) : await deleteMinMaxIgnored(sala, id);
    if (e) {
      setIgnorados((p) => { const x = new Set(p); if (si) x.delete(id); else x.add(id); return x; });
      fallo('No se pudo guardar', mensajeAmigable(e));
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    setAbierta(null);
  };

  if (filas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      <FilaDeKpis>
        <Kpi icono="ClipboardList" rotulo="Sin Min/Max" valor={n(filas.length)} color={MARCA.ambar} apoyo="se venden y no se reponen solos" />
        <Kpi icono="DollarSign" rotulo="Venta 6 meses" valor={formatMoney(venta6m)} color={MARCA.azul} apoyo="de estos productos" />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="Plus" rotulo="Agregar Min/Max" valor={n(conteos.agregar)} color={MARCA.verde} pide={filtro === 'agregar'}
          apoyo="la rotación lo justifica" onPress={() => onFiltro('agregar')} />
        <Kpi icono="AlertTriangle" rotulo="Evaluar" valor={n(conteos.evaluar)} color={MARCA.ambar} pide={filtro === 'evaluar'}
          apoyo="rotación moderada" onPress={() => onFiltro('evaluar')} />
      </FilaDeKpis>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {!filas.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24, marginHorizontal: 20 }}>
          {`Todo lo que se vende en ${nombreSala} ya tiene Min/Max`}
        </Text>
      ) : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${FILTROS_MINMAX.find((f) => f.value === filtro)?.label} · ${n(filtradas.length)} producto${filtradas.length === 1 ? '' : 's'}`}</Text>
      {filtradas.slice(0, mostrar).map((r) => {
        const s = sugerenciaMinMax(r);
        const hecho = hechos.get(r.erp_product_id);
        return (
          <Pressable key={r.erp_product_id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(r); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={18} interactivo>
              <View style={{ padding: 12, gap: 5 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{r.product_name}</Text>
                    {r.laboratorio ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{r.laboratorio}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{formatMoney(r.revenue)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${n(r.units_sold)} u. en 6 meses`}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {hecho ? <Pildora texto={hecho === 'aplicado' ? 'Min/Max aplicado' : 'Min/Max pedido'} color={MARCA.verde} />
                    : <Pildora texto={s.label} color={COLOR_NIVEL[s.level]} />}
                  <Pildora texto={s.reason} color={colorSistema.texto2} />
                </View>
              </View>
            </Vidrio>
          </Pressable>
        );
      })}
      {filtradas.length > mostrar ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setMostrar((m) => m + 30)} /></View> : null}
      {filas.length && !filtradas.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
          {busqueda ? 'Ningún producto con esa búsqueda' : 'Nada en este grupo'}
        </Text>
      ) : null}
      <Ajuste fila={abierta} sala={sala} puedePedir={puedePedir} puedeAplicar={puedeAplicar}
        descartado={abierta ? ignorados.has(abierta.erp_product_id) : false}
        onCerrar={() => setAbierta(null)} onDescartar={descartar}
        onHecho={(id, estado) => { setHechos((m) => new Map(m).set(id, estado)); setAbierta(null); }} />
    </>
  );
}

export default function GestionStock() {
  const { user, getScope, hasPermission } = useAuth();
  const propia = BRANCH_A_ERP[user?.branchId ?? user?.branch_id];
  const [salaElegida, setSala] = useState(null);
  const sala = salaElegida ?? (propia && propia !== ERP_BODEGA ? propia : 5);
  const [pestana, setPestana] = useState('parados');
  const [filtro, setFiltro] = useState('agregar');
  const [filtroParados, setFiltroParados] = useState('todos');   // 'todos' | 'minmax'
  const [conMinmax, setConMinmax] = useState(null);
  const [orden, setOrden] = useState('revenue:desc');
  const [conteos, setConteos] = useState(null);
  // La descarga la arma la pestaña visible (es la que tiene las filas).
  const [exportar, setExportar] = useState(null);
  const alExportar = useCallback((fn) => setExportar(() => fn), []);
  const alConMinmax = useCallback((c) => setConMinmax(c), []);
  const recargar = useCallback(() => setLlave((k) => k + 1), []);
  const [texto, setTexto] = useState('');
  const [llave, setLlave] = useState(0);
  const [recargando, setRecargando] = useState(false);

  const puedeArmar = getScope?.('traslados') === 'ALL' || Number(propia) === Number(sala);
  const puedePedir = hasPermission('dash_minmax_req', 'can_view');
  const alcance = getScope?.('requests_minmax');
  const puedeAplicar = hasPermission('requests_minmax', 'can_approve') && (alcance === 'ALL' || (alcance !== 'MINE' && Number(propia) === Number(sala)));

  const salas = ERP_ORDEN.filter((e) => e !== ERP_BODEGA);
  const grupos = [
    { id: 'sala', titulo: 'Sala', activa: String(sala), porDefecto: String(propia && propia !== ERP_BODEGA ? propia : 5), onCambiar: (v) => setSala(Number(v)),
      opciones: salas.map((e) => ({ id: String(e), label: ERP_NAMES[e] })) },
    ...(pestana === 'sin_minmax' ? [{ id: 'filtro', titulo: 'Qué hacer', activa: filtro, porDefecto: 'agregar', onCambiar: setFiltro,
      opciones: FILTROS_MINMAX.map((f) => ({ id: f.value, label: conteos ? `${f.label} · ${conteos[f.value]}` : f.label })) },
    { id: 'orden', titulo: 'Ordenar por', activa: orden, porDefecto: 'revenue:desc', onCambiar: setOrden,
      opciones: [
        { id: 'revenue:desc', label: 'Venta, de mayor a menor' }, { id: 'revenue:asc', label: 'Venta, de menor a mayor' },
        { id: 'units_sold:desc', label: 'Unidades, de más a menos' }, { id: 'units_sold:asc', label: 'Unidades, de menos a más' },
        { id: 'product_name:asc', label: 'Producto, A → Z' }, { id: 'product_name:desc', label: 'Producto, Z → A' },
      ] }] : [{ id: 'mostrar', titulo: 'Qué productos se ven', activa: filtroParados, porDefecto: 'todos', onCambiar: setFiltroParados,
      opciones: [{ id: 'todos', label: 'Todos' }, { id: 'minmax', label: conMinmax != null ? `Con Min/Max · ${conMinmax}` : 'Con Min/Max' }] }]),
  ];
  const alConteos = useCallback((c) => setConteos(c), []);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Gestión de stock', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Producto o laboratorio', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} extra={exportar ? { icono: 'square.and.arrow.up', etiqueta: 'Descargar', onPress: exportar } : null} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={() => { setRecargando(true); setLlave((k) => k + 1); setTimeout(() => setRecargando(false), 600); }} />}>
        <FiltrosActivos grupos={grupos} />
        <Segmentos activa={pestana} onCambiar={(v) => { setExportar(null); setPestana(v); }} opciones={[{ id: 'parados', label: 'Sin venta' }, { id: 'sin_minmax', label: 'Sin Min/Max' }]} />
        {pestana === 'parados'
          ? <SinVenta key={`p${sala}-${llave}`} sala={sala} busqueda={texto.trim()} filtro={filtroParados} puedeArmar={puedeArmar}
            onExportar={alExportar} onConMinmax={alConMinmax} onRecargar={recargar} />
          : <SinMinMax key={`m${sala}-${llave}`} sala={sala} busqueda={texto.trim()} filtro={filtro} orden={orden} puedePedir={puedePedir} puedeAplicar={puedeAplicar}
            onConteos={alConteos} onFiltro={setFiltro} onExportar={alExportar} />}
      </ScrollView>
    </>
  );
}
