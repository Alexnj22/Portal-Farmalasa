// Cargar compra, NATIVO — la vista del portal (`CargarCompraView`): las
// facturas de compra que llegaron por correo y todavía no se cargaron (con sus
// pistas «¿Ya cargada?», «¿Es gasto?», «¿Anulada?» y las facturas en papel),
// los productos de proveedor «por confirmar», los productos erróneos, lo que
// está por llegar y el registro de lo cargado. Tocar una factura abre la
// compra armada (`propuesta-compra/[id]`), donde se revisa y se carga en
// Bodega. Las consultas y escrituras son las del núcleo (`cargarCompra`), las
// mismas del portal; con las compras en pausa, la app no carga.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Presionable as Pressable } from '../componentes/Tocable';
import Indicador from '../componentes/Indicador';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  adelantarPropuesta, apartarRenglon, barrerDocumentos, confirmarProducto, descartarFacturaEnPapel, devolverDocumento, fetchDocumentosSinCargar,
  fetchEstadosDeCarga, fetchFacturasEnPapel, fetchPausaDeCompras, fetchPistasSinCargar, fetchProductosPorConfirmar,
} from '@nucleo/data/cargarCompra';
import { docDePapel, pareceAnulada } from '@nucleo/utils/cargaDeCompra';
import { useStaffStore } from '@nucleo/store/staffStore';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Vacio, Cargando } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import FijoArriba from '../componentes/FijoArriba';
import Vidrio from '../componentes/Vidrio';
import BuscadorProducto from '../componentes/compras/BuscadorProducto';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando, cerrarProgreso } from '../componentes/Progreso';
import { Accion, Cuenta, PausaDeCompras, colorDe, estadoDeCarga, tomarSacada } from '../componentes/compras/carga';
import { PestanaErroneos, PestanaPorLlegar, PestanaRegistro } from '../componentes/compras/PestanasDeCarga';
import FacturaEnPapel from '../componentes/compras/FacturaEnPapel';

const PERIODOS = [{ id: '30', label: 'Último mes' }, { id: '60', label: 'Últimos 2 meses' }, { id: '180', label: 'Últimos 6 meses' }];
const ESTADOS = [{ id: 'pendientes', label: 'Sin resolver' }, { id: 'apartados', label: 'No son productos' }, { id: 'resueltos', label: 'Confirmados' }, { id: 'todos', label: 'Todos' }];
const ORIGEN = { codigo_barras: ['Código de barras', MARCA.verde], aprendido: ['Ya confirmado', MARCA.verde], parecido: ['Por parecido', MARCA.ambar] };
const plural = (n, uno, muchos) => `${n} ${Number(n) === 1 ? uno : muchos}`;
const fmtFecha = (iso) => fechaNumerica(iso, { anio: 'corto', vacio: '—' });
const POR_PAGINA = 40;

/** Abre la compra armada de una factura (o de una en papel). */
const abrir = (d) => {
  Haptics.selectionAsync().catch(() => {});
  router.push({ pathname: '/propuesta-compra/[id]', params: {
    id: d.manual_id ? 'papel' : String(d.document_id), ...(d.manual_id ? { manual: String(d.manual_id) } : {}),
    proveedor: d.proveedor_ficha ?? d.emisor_nombre, nit: d.emisor_nit ?? '', fecha: d.fecha_emision ?? '', total: String(d.monto_total ?? ''),
  } });
};

function Facturas({ busca, dias, puedeEditar, escribiendo, setEscribiendo }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [hasta, setHasta] = useState(POR_PAGINA);
  const [estados, setEstados] = useState({});
  const [pistas, setPistas] = useState({});
  const [papeles, setPapeles] = useState([]);
  const [sacada, setSacada] = useState(null);
  const cargarPapeles = useCallback(async () => {
    const { facturas } = await fetchFacturasEnPapel();
    setPapeles(facturas ?? []);
  }, []);
  const cargar = useCallback(async () => {
    cargarPapeles();
    const { filas: f, error: e } = await fetchDocumentosSinCargar(Number(dias));
    setError(e?.message ?? '');
    setFilas(f ?? []);
    const ids = (f ?? []).map((x) => x.document_id);
    const [{ estados: es }, { pistas: ps }] = await Promise.all([fetchEstadosDeCarga(ids), fetchPistasSinCargar(ids)]);
    setEstados(es ?? {}); setPistas(ps ?? {});
  }, [dias, cargarPapeles]);
  useFocusEffect(useCallback(() => { const s = tomarSacada(); if (s) setSacada(s); cargar(); }, [cargar]));
  useEffect(() => { setHasta(POR_PAGINA); }, [busca, dias]); // eslint-disable-line react-hooks/set-state-in-effect -- volver a la primera tanda al cambiar el filtro
  const visibles = useMemo(() => (busca.trim() ? (filas ?? []).filter((f) => tokenMatch(busca, f.emisor_nombre, f.proveedor_ficha, f.codigo_generacion)) : (filas ?? [])), [filas, busca]);
  // Las tres primeras se leen por adelantado: son las que se abren.
  useEffect(() => { if (puedeEditar) visibles.slice(0, 3).forEach((f) => f.document_id && adelantarPropuesta(f.document_id)); }, [visibles, puedeEditar]);
  const t = useMemo(() => (filas ?? []).reduce((a, f) => ({ monto: a.monto + Number(f.monto_total || 0), renglones: a.renglones + Number(f.renglones || 0), viejos: a.viejos + (Number(f.dias_desde) > 15 ? 1 : 0) }), { monto: 0, renglones: 0, viejos: 0 }), [filas]);
  const sinEstado = (filas ?? []).filter((f) => !estados[f.document_id]);
  const ya = sinEstado.filter((f) => pistas[f.document_id]?.compra).length;
  const gasto = sinEstado.filter((f) => !pistas[f.document_id]?.compra && pistas[f.document_id]?.gasto).length;
  const anulada = sinEstado.filter((f) => pareceAnulada(f, pistas[f.document_id])).length;

  const deshacerSacada = async () => {
    const { doc: d, proveedor } = sacada;
    const { error: e } = await devolverDocumento(d.document_id, proveedor);
    if (e) { fallo('No se pudo', e === 'FORBIDDEN' ? 'No tienes permiso para devolverla a la lista.' : e); return; }
    useStaffStore.getState().appendAuditLog('COMPRA_DEVUELTA_A_LA_COLA', String(d.document_id), { proveedor: d.emisor_nombre, todo_el_proveedor: proveedor, desde: 'app' });
    setSacada(null);
    listo('Volvió a la lista', d.emisor_nombre);
    cargar();
  };
  const descartar = (m) => Alert.alert('Descartar factura en papel', `La factura ${m.numero} de ${m.proveedor_nombre} sale de la lista sin cargarse.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Descartar', style: 'destructive', onPress: async () => {
      const { error: e } = await descartarFacturaEnPapel(m.id);
      if (e) { fallo('No se pudo descartar', e); return; }
      cargarPapeles();
    } },
  ]);
  const etiqueta = (f) => {
    const pista = pistas[f.document_id];
    if (!estados[f.document_id] && pareceAnulada(f, pista)) return ['¿Anulada?', 'ambar'];
    if (!estados[f.document_id] && pista?.compra) return ['¿Ya cargada?', 'ambar'];
    if (!estados[f.document_id] && pista?.gasto) return ['¿Es gasto?', 'gris'];
    const e = estadoDeCarga(estados[f.document_id]);
    return e[0] === 'Pendiente' ? null : e;
  };
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16 }}>
        <Cuenta rotulo="Sin cargar" valor={filas?.length} sub={`${t.renglones} productos`} />
        <Cuenta rotulo="Monto" valor={filas ? formatMoney(t.monto) : null} sub="que esperan" color={MARCA.ambar} />
        <Cuenta rotulo="+15 días" valor={filas ? t.viejos : null} sub="facturas" color={t.viejos ? MARCA.ambar : undefined} />
      </View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {sacada ? (
        <View style={{ marginHorizontal: 16 }}>
          <Vidrio radio={20}>
            <View style={{ padding: 14, gap: 4 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{sacada.proveedor ? `Nada de ${sacada.doc.emisor_nombre} aparece ya en la lista.` : `La factura de ${sacada.doc.emisor_nombre} salió de la lista.`}</Text>
              <View style={{ flexDirection: 'row', gap: 20 }}>
                <Accion texto="Deshacer" onPress={deshacerSacada} />
                <Accion texto="Listo" color={colorSistema.texto2} onPress={() => setSacada(null)} />
              </View>
            </View>
          </Vidrio>
        </View>
      ) : null}
      {puedeEditar ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Factura en papel" borde onPress={() => setEscribiendo('nueva')} /></View> : null}
      {papeles.length ? (
        <View style={{ marginHorizontal: 16, gap: 6 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginLeft: 4 }}>{`Facturas en papel por cargar · ${papeles.length}`}</Text>
          <Vidrio radio={20}>
            <View style={{ paddingVertical: 4 }}>
              {papeles.map((m, i) => (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <Pressable onPress={() => abrir(docDePapel(m))} style={({ pressed }) => ({ flex: 1, gap: 2, minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{m.proveedor_nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{`${m.tipo_doc} ${m.serie ? `${m.serie} · ` : ''}${m.numero} · ${fmtFecha(m.fecha_emision)} · ${formatMoney(m.total)}`}</Text>
                  </Pressable>
                  {puedeEditar ? <Accion texto="Descartar" color={MARCA.rojo} onPress={() => descartar(m)} /> : null}
                  <Accion texto="Cargar" onPress={() => abrir(docDePapel(m))} />
                </View>
              ))}
            </View>
          </Vidrio>
        </View>
      ) : null}
      <View style={{ marginHorizontal: 16 }}><Aviso texto="El portal arma la compra desde la factura: producto, cantidad, costo, lote y vencimiento. Revísala con «Revisar carga» y súbela a Bodega con «Cargar en Bodega». Cada producto que confirmes queda guardado y ese proveedor no vuelve a preguntar." /></View>
      {ya || gasto || anulada ? (
        <View style={{ marginHorizontal: 16 }}>
          <Aviso tono="cuidado" texto={[ya ? `${ya} parece${ya === 1 ? '' : 'n'} ya cargada${ya === 1 ? '' : 's'} a mano con otro número («¿Ya cargada?»).` : null,
            gasto ? `${gasto} parece${gasto === 1 ? '' : 'n'} gasto y no mercadería («¿Es gasto?»).` : null,
            anulada ? `${anulada} tiene${anulada === 1 ? '' : 'n'} una nota de crédito por el total («¿Anulada?»).` : null,
            'Ábrelas para confirmarlo y sacarlas de la lista.'].filter(Boolean).join(' ')} />
        </View>
      ) : null}
      {filas == null ? <Indicador /> : !visibles.length ? <Vacio titulo="Sin facturas esperando carga en este período." /> : (
        <View style={{ marginHorizontal: 16 }}>
          <Vidrio radio={20}>
            <View style={{ paddingVertical: 4 }}>
              {visibles.slice(0, hasta).map((f, i) => {
                const et = etiqueta(f);
                return (
                  <Pressable key={f.document_id} onPress={() => abrir(f)}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56,
                      borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, backgroundColor: pressed ? 'rgba(127,127,127,0.15)' : 'transparent' })}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{f.proveedor_ficha ?? f.emisor_nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{[fmtFecha(f.fecha_emision), plural(f.renglones, 'producto', 'productos'), !f.tiene_pdf ? 'sin archivo impreso' : null].filter(Boolean).join(' · ')}</Text>
                      {et ? <View style={{ flexDirection: 'row' }}><Pildora texto={et[0]} color={colorDe(et[1])} /></View> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(f.monto_total)}</Text>
                      {f.dias_desde > 15 ? <Pildora texto={`${f.dias_desde} días`} color={MARCA.ambar} /> : <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${f.dias_desde} d`}</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Vidrio>
          {visibles.length > hasta ? <View style={{ marginTop: 10 }}><BotonGrande texto={`Ver más (${visibles.length - hasta})`} borde onPress={() => setHasta((h) => h + POR_PAGINA)} /></View> : null}
        </View>
      )}
      {escribiendo ? (
        <FacturaEnPapel inicial={escribiendo === 'nueva' ? null : escribiendo} onCerrar={() => setEscribiendo(null)}
          onGuardada={async (manualId) => {
            setEscribiendo(null);
            const { facturas } = await fetchFacturasEnPapel();
            setPapeles(facturas ?? []);
            const m = (facturas ?? []).find((x) => x.id === manualId);
            if (m) abrir(docDePapel(m));
          }} />
      ) : null}
    </View>
  );
}

function PorConfirmar({ busca, estado, puedeEditar }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [hasta, setHasta] = useState(POR_PAGINA);
  // La búsqueda va a la base (filtra antes del tope de 500); se espera a que
  // se deje de escribir, y una respuesta vieja no pisa a la nueva.
  const [buscaQ, setBuscaQ] = useState(busca.trim());
  useEffect(() => { const t = setTimeout(() => setBuscaQ(busca.trim()), 300); return () => clearTimeout(t); }, [busca]);
  const pedido = useRef(0);
  const cargar = useCallback(async () => {
    const n = ++pedido.current;
    const { filas: f, error: e } = await fetchProductosPorConfirmar(estado, buscaQ);
    if (n !== pedido.current) return;
    setError(e?.message ?? '');
    setFilas(f ?? []);
  }, [estado, buscaQ]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al cambiar el estado
  useEffect(() => { setHasta(POR_PAGINA); }, [busca, estado]); // eslint-disable-line react-hooks/set-state-in-effect -- volver a la primera tanda al cambiar el filtro
  const visibles = useMemo(() => filas ?? [], [filas]); // ya vienen filtradas por la base
  const t = useMemo(() => {
    const r = { preguntas: 0, renglones: 0, sinCandidato: 0 };
    for (const f of filas ?? []) {
      if (estado === 'pendientes' && (f.resuelto || f.ignorado)) continue;
      r.preguntas++; r.renglones += Number(f.renglones || 0); if (!f.sugerido_product_id) r.sinCandidato++;
    }
    return r;
  }, [filas, estado]);

  const barrer = async () => {
    trabajando('Leyendo las facturas…');
    for (let vuelta = 0; vuelta < 30; vuelta++) {
      const { resultado, error: e } = await barrerDocumentos({ dias: 90, tanda: 40 });
      if (e) { fallo('No se pudo actualizar', String(e?.message ?? e)); return; }
      trabajando(`Leídos ${resultado.leidos} · quedan ${resultado.restantes}`);
      if (resultado.leidos === 0 || resultado.restantes === 0) break;
    }
    cerrarProgreso();
    await cargar();
  };
  const confirmar = (f, producto) => Alert.alert('Confirmar el producto', `«${f.descripcion}» de ${f.proveedor} es ${producto.nombre}. Se resuelve en todas las facturas donde aparece, hoy y en adelante.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Confirmar', onPress: async () => {
      setOcupado(f.id);
      const { error: e } = await confirmarProducto(f.emisor_nit, f.llave, producto.id, { proveedor: f.proveedor, producto: producto.nombre, renglones: f.renglones, desde: 'app' });
      setOcupado(null);
      if (e) { fallo('No se pudo confirmar', String(e?.message ?? e)); return; }
      listo('Confirmado', producto.nombre); setAbierto(null); await cargar();
    } },
  ]);
  const apartar = (f, deshacer) => Alert.alert(deshacer ? 'Devolver a la lista' : 'No es un producto', deshacer ? 'Vuelve a la cola de por confirmar.' : `«${f.descripcion}» deja de preguntarse (un flete, un servicio, un descuento).`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: deshacer ? 'Devolver' : 'Apartar', onPress: async () => {
      setOcupado(f.id);
      const { error: e } = await apartarRenglon(f.id, deshacer, { proveedor: f.proveedor, codigo: f.codigo_proveedor, descripcion: f.descripcion, renglones: f.renglones, desde: 'app' });
      setOcupado(null);
      if (e) { fallo('No se pudo', String(e?.message ?? e)); return; }
      await cargar();
    } },
  ]);

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16 }}>
        <Cuenta rotulo={ESTADOS.find((e) => e.id === estado)?.label} valor={filas ? t.preguntas : null} sub="productos distintos" />
        <Cuenta rotulo="Productos de la factura" valor={filas ? t.renglones : null} sub="que destraban" />
        {estado === 'pendientes' ? <Cuenta rotulo="Sin candidato" valor={filas ? t.sinCandidato : null} sub="a mano" color={t.sinCandidato ? MARCA.ambar : undefined} /> : null}
      </View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <View style={{ marginHorizontal: 16 }}>
        <Aviso texto={estado === 'apartados' ? 'Lo que se marcó como que no es un producto. Si fue un error, toca «Devolver a la lista».' : 'Cada fila es un producto de un proveedor. Al confirmarla se resuelven todas las facturas donde aparece, las de hoy y las que vengan.'} />
      </View>
      {puedeEditar ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Actualizar la lista" borde onPress={barrer} /></View> : null}
      {filas == null ? <Cargando /> : !visibles.length ? (estado === 'pendientes' ? <Vacio titulo="Sin productos por confirmar" detalle="Si llegaron facturas nuevas, toca «Actualizar la lista»." tono="bien" /> : <Vacio titulo="Nada en esta lista." />) : (
        visibles.slice(0, hasta).map((f) => {
          const o = ORIGEN[f.sugerido_origen];
          return (
            <View key={f.id} style={{ marginHorizontal: 16, opacity: f.ignorado ? 0.65 : 1 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 14, gap: 6 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.sugerido_nombre ?? 'Sin candidato'}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{f.descripcion}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[f.proveedor, f.codigo_proveedor ? `código ${f.codigo_proveedor}` : null, `${plural(f.renglones, 'vez', 'veces')} en ${plural(f.documentos, 'factura', 'facturas')}`].filter(Boolean).join(' · ')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {f.ignorado ? <Pildora texto="Apartado" color={colorSistema.texto2} /> : null}
                    {f.resuelto ? <Pildora texto="Confirmado" color={MARCA.verde} /> : null}
                    {!f.resuelto && !f.ignorado && o ? <Pildora texto={`${o[0]}${f.sugerido_origen === 'parecido' && f.sugerido_similitud != null ? ` · ${Math.round(f.sugerido_similitud * 100)}%` : ''}`} color={o[1]} /> : null}
                  </View>
                  {puedeEditar ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                      {!f.resuelto && !f.ignorado && f.sugerido_product_id ? <Accion texto="Es correcto" color={MARCA.verde} ocupado={ocupado === f.id} onPress={() => confirmar(f, { id: f.sugerido_product_id, nombre: f.sugerido_nombre })} /> : null}
                      {!f.ignorado ? <Accion texto={f.resuelto ? 'Es otro' : f.sugerido_product_id ? 'Es otro' : 'Elegir'} ocupado={ocupado === f.id} onPress={() => setAbierto(abierto === f.id ? null : f.id)} /> : null}
                      {!f.resuelto && !f.ignorado ? <Accion texto="No es un producto" color={colorSistema.texto2} ocupado={ocupado === f.id} onPress={() => apartar(f, false)} /> : null}
                      {f.ignorado ? <Accion texto="Devolver a la lista" ocupado={ocupado === f.id} onPress={() => apartar(f, true)} /> : null}
                    </View>
                  ) : null}
                  {abierto === f.id ? <BuscadorProducto onElegir={(p) => confirmar(f, p)} onCancelar={() => setAbierto(null)} /> : null}
                </View>
              </Vidrio>
            </View>
          );
        })
      )}
      {visibles.length > hasta ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`Ver más (${visibles.length - hasta})`} borde onPress={() => setHasta((h) => h + POR_PAGINA)} /></View> : null}
    </View>
  );
}

const PESTANAS = [{ id: 'facturas', label: 'Facturas' }, { id: 'confirmar', label: 'Por confirmar' }, { id: 'erroneos', label: 'Erróneos' },
  { id: 'por_llegar', label: 'Por llegar' }, { id: 'registro', label: 'Registro' }];

export default function CargarCompra() {
  const { hasPermission } = useAuth();
  // El mismo permiso que la web (CargarCompraView): quien carga tiene `cargar_compra`.
  const puedeEditar = hasPermission('cargar_compra', 'can_edit') || hasPermission('compras', 'can_edit');
  const [tab, setTab] = useState('facturas');
  const [busca, setBusca] = useState('');
  const [dias, setDias] = useState('30');
  const [estado, setEstado] = useState('pendientes');
  const [pausa, setPausa] = useState(null);
  const [escribiendo, setEscribiendo] = useState(null);
  const leerPausa = useCallback(() => { fetchPausaDeCompras().then(({ estado: e }) => setPausa(e)); }, []);
  useFocusEffect(leerPausa);
  useEffect(() => { leerPausa(); }, [tab, leerPausa]);
  const pausada = !!pausa?.pausada;
  const grupos = tab === 'facturas'
    ? [{ id: 'periodo', titulo: 'Período', activa: dias, porDefecto: '30', onCambiar: setDias, opciones: PERIODOS }]
    : tab === 'confirmar' ? [{ id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'pendientes', onCambiar: setEstado, opciones: ESTADOS }] : [];
  const conBuscador = tab !== 'erroneos';
  return (
    <>
      <Stack.Screen options={{ ...BARRA_FIJA, title: 'Cargar compra',
        headerSearchBarOptions: conBuscador ? { placeholder: tab === 'confirmar' ? 'Proveedor, producto o código' : 'Proveedor o número de factura', onChangeText: (e) => setBusca(e.nativeEvent.text) } : undefined }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <FijoArriba><Segmentos activa={tab} onCambiar={setTab} opciones={PESTANAS} /></FijoArriba>
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
        {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
        <PausaDeCompras estado={pausa} onCambio={setPausa} />
        {tab === 'facturas' ? <Facturas busca={busca} dias={dias} puedeEditar={puedeEditar} escribiendo={escribiendo} setEscribiendo={setEscribiendo} />
          : tab === 'confirmar' ? <PorConfirmar busca={busca} estado={estado} puedeEditar={puedeEditar} />
          : tab === 'erroneos' ? <PestanaErroneos puedeEditar={puedeEditar} pausada={pausada} />
          : tab === 'por_llegar' ? <PestanaPorLlegar puedeEditar={puedeEditar} pausada={pausada} busca={busca} />
          : <PestanaRegistro busca={busca} />}
      </ScrollView>
    </>
  );
}
