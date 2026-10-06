// El detalle de una solicitud, DESPLEGADO dentro de la tarjeta del aviso — el
// `NotificacionDetalle` del portal (que monta `DetalleSolicitud` con
// `enCampana`), en la app.
//
// Decidir desde el aviso sin esto es decidir a ciegas: qué producto se
// descarta, qué factura se anula, de cuánto a cuánto va un Min/Max. La tarjeta
// de arriba ya dice quién la pide, la venta y el motivo; acá va lo que falta
// —los renglones con su lote y vencimiento, las fotos de evidencia, la venta
// con lo que se vendió, el MIN/MAX de hoy y el propuesto con sus ventas y su
// despacho, lo aplicado, lo recibido, el motivo de rechazo y el historial—.
//
// La solicitud se LEE al desplegar (el aviso trae sólo su id) con la misma
// función del núcleo que usa el portal, `cargarFilaDeAviso`; un Min/Max pasa
// por `adaptarMinMax`, el mismo adaptador del centro de solicitudes. Este
// componente se monta al abrir y se desmonta al cerrar: no viaja por cada
// fila de la lista.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from 'react-native';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cargarFilaDeAviso, esAvisoDeMinMax } from '@nucleo/data/solicitudDeAviso';
import { adaptarMinMax } from '@nucleo/store/slices/requestsSlice';
import { fetchContextoDeSolicitudMinMax } from '@nucleo/data/minmaxRequests';
import { fetchInvoiceById, fetchInvoiceItemsForInvoice } from '@nucleo/data/ventas';
import { tieneSelloMh } from '@nucleo/data/facturacion';
import { ERP_NAMES } from '@nucleo/constants/erp';
import {
  ajustadasDe, buscadorDePersonas, contextoMovimiento, cuantoTardo, fmtFechaHora, lineasDe, motivoDeRechazo, rechazadasDe,
} from '@nucleo/utils/movimientoTexto';
import { ajusteSinCambio, fmtUltimaVenta } from '@nucleo/utils/minmaxSolicitud';
import { leerDespacho, leerMeses, leerPresentaciones, maxNoAlcanzaParaDespachar } from '@nucleo/utils/avisosDeOperacion';
import { getSignedFileUrl } from '@nucleo/utils/storageFiles';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Avatar from '../Avatar';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { Advertencia, FONDO, Fichas, Pildora, Rotulo } from './Piezas';

const GRIS = colorSistema.texto2;
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtDate = (iso) => (!iso ? '—' : fechaTexto(iso, { day: '2-digit', month: 'short' }));
const cifra = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v).toLocaleString('es-SV') : '—');
const ESTADOS_ANULADA = ['NULA', 'DTE INVALIDADO EN MH'];
const SIGNO_POR_TIPO = { INVENTORY_LOAD_REQUEST: '+', INVENTORY_DISCARD_REQUEST: '−', INVENTORY_TRANSFER_REQUEST: '' };

// ── Piezas ───────────────────────────────────────────────────────────────────

/** Un bloque con fondo, rótulo opcional y su contenido. */
function Caja({ rotulo, color, children, tinte }) {
  return (
    <View style={{ borderRadius: 14, backgroundColor: tinte ? `${tinte}1F` : FONDO, paddingHorizontal: 12, paddingVertical: 9, gap: 4 }}>
      {rotulo ? <Text style={{ color: color ?? GRIS, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>{rotulo}</Text> : null}
      {children}
    </View>
  );
}

/** Dos cajas lado a lado (el `grid-cols-2` del portal). */
function Par({ children }) {
  return <View style={{ flexDirection: 'row', gap: 8 }}>{children}</View>;
}
function Mitad({ children }) {
  return <View style={{ flex: 1, minWidth: 0 }}>{children}</View>;
}

const Fuerte = ({ children, color, tamano = 14 }) => (
  <Text style={{ color: color ?? colorSistema.texto, fontSize: tamano, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{children}</Text>
);
const Tenue = ({ children }) => <Text style={{ color: GRIS, fontSize: 12, fontWeight: '600' }}>{children}</Text>;

/** Una persona con su cara (la foto puede venir sin firmar: se firma acá). */
function Persona({ persona, foto, nombre, vacio = 'Sin asignar', tamano = 28 }) {
  const [firmada, setFirmada] = useState(null);
  const cruda = foto ?? (persona?.photo ? null : persona?.photo_url) ?? null;
  useEffect(() => {
    if (!cruda) return undefined;
    let vivo = true;
    getSignedFileUrl(cruda).then((u) => { if (vivo) setFirmada(u || null); }).catch(() => {});
    return () => { vivo = false; };
  }, [cruda]);
  const p = persona ?? (nombre ? { name: nombre } : null);
  if (!p) return <Tenue>{vacio}</Tenue>;
  const conFoto = firmada ? { ...p, photo: firmada } : (persona?.photo ? persona : { ...p, photo: null, photo_url: null });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Avatar empleado={conFoto} tamano={tamano} />
      <Text style={{ flexShrink: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{persona ? shortEmployeeName(persona) : (nombre || vacio)}</Text>
    </View>
  );
}

/** Las fotos de evidencia: miniaturas que se amplían a pantalla completa. */
function Fotos({ urls, titulo = 'Evidencia' }) {
  const [firmadas, setFirmadas] = useState(null);
  const [ampliada, setAmpliada] = useState(null);
  const lista = useMemo(() => (Array.isArray(urls) ? urls.filter(Boolean) : []), [urls]);
  useEffect(() => {
    if (!lista.length) return undefined;
    let vivo = true;
    Promise.all(lista.map((u) => getSignedFileUrl(u).catch(() => null))).then((r) => { if (vivo) setFirmadas(r); });
    return () => { vivo = false; };
  }, [lista]);
  if (!lista.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Rotulo>{titulo}</Rotulo>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(firmadas ?? lista.map(() => null)).map((src, i) => (src ? (
          <Pressable key={i} onPress={() => setAmpliada(src)} accessibilityLabel={`Ampliar ${titulo.toLowerCase()} ${i + 1}`}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}>
            <Image source={{ uri: src }} style={{ width: 76, height: 76, borderRadius: 12 }} />
          </Pressable>
        ) : (
          <View key={i} style={{ width: 76, height: 76, borderRadius: 12, backgroundColor: FONDO, alignItems: 'center', justifyContent: 'center' }}>
            {firmadas ? <Tenue>Sin foto</Tenue> : <ActivityIndicator />}
          </View>
        )))}
      </View>
      <Modal visible={!!ampliada} transparent animationType="fade" onRequestClose={() => setAmpliada(null)}>
        <Pressable onPress={() => setAmpliada(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}>
          {ampliada ? <Image source={{ uri: ampliada }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
          <Text style={{ color: '#fff', fontSize: 15, marginTop: 16 }}>Toca para cerrar</Text>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── Movimientos de inventario: carga, descarte, traslado ─────────────────────

function CabeceraMovimiento({ req, meta }) {
  const { motivo, sala, origen, unidades } = contextoMovimiento(meta);
  const esTraslado = req.type === 'INVENTORY_TRANSFER_REQUEST';
  const esCarga = req.type === 'INVENTORY_LOAD_REQUEST';
  return (
    <Caja rotulo={esTraslado ? 'Recorrido' : esCarga ? 'Se carga en' : 'Se descarga de'}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Fuerte>{esTraslado ? `${origen ?? 'Otra sala'} → ${sala ?? 'destino'}` : (sala ?? 'Sin sala')}</Fuerte>
          {motivo ? <Tenue>{motivo}</Tenue> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Fuerte tamano={20}>{unidades}</Fuerte>
          <Tenue>{unidades === 1 ? 'unidad' : 'unidades'}</Tenue>
        </View>
      </View>
    </Caja>
  );
}

function LineasMovimiento({ meta, signo }) {
  const items = lineasDe(meta);
  const rechazadas = rechazadasDe(meta);
  const ajustadas = ajustadasDe(meta);
  if (!items.length) return <Caja><Tenue>Esta solicitud no trae detalle de productos.</Tenue></Caja>;
  return (
    <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12, paddingVertical: 2 }}>
      {items.map((it, i) => {
        const motivoRechazo = rechazadas.get(i);
        const pedida = Number(it.cantidad) || 0;
        const actual = ajustadas.get(i) ?? pedida;
        const recortada = actual !== pedida;
        const unidad = it.presentacion_tipo ?? 'u';
        const existencia = Number.isFinite(Number(it.existencia)) ? Number(it.existencia) : null;
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{it.descripcion ?? `Producto #${it.erp_product_id}`}</Text>
              <Tenue>{[`${actual} ${unidad}`, existencia != null ? `había ${existencia}` : null].filter(Boolean).join(' · ')}</Tenue>
              {it.lote || it.numero_lote || it.vence ? (
                <Tenue>{[it.lote || it.numero_lote || 'sin lote', it.vence ? `vence ${fmtDate(it.vence)}` : null].filter(Boolean).join(' · ')}</Tenue>
              ) : null}
              {motivoRechazo ? <Text style={{ color: MARCA.rojo, fontSize: 12, fontWeight: '700' }}>{`No entró — ${motivoRechazo}`}</Text> : null}
              {recortada && !motivoRechazo ? <Text style={{ color: MARCA.ambar, fontSize: 12, fontWeight: '700' }}>{`Entraron ${actual} de las ${pedida} que se pidieron`}</Text> : null}
            </View>
            <Pildora texto={motivoRechazo ? '—' : `${signo}${actual}`} color={signo === '+' ? MARCA.verde : GRIS} />
          </View>
        );
      })}
    </View>
  );
}

// ── Min/Max ──────────────────────────────────────────────────────────────────

function ContextoMinMax({ meta, rechazada }) {
  const [ctx, setCtx] = useState(null);
  useEffect(() => {
    if (!meta.erp_product_id) return undefined;
    let vivo = true;
    fetchContextoDeSolicitudMinMax(meta.erp_product_id, meta.erp_sucursal_id).then((d) => { if (vivo) setCtx(d); });
    return () => { vivo = false; };
  }, [meta.erp_product_id, meta.erp_sucursal_id]);
  const meses = leerMeses(ctx?.ventas_meses);
  const despacho = leerDespacho(ctx?.despacho);
  const lista = leerPresentaciones(ctx?.presentaciones, despacho);
  const base = lista[0] ?? null;
  const total6 = meses.length ? meses.reduce((s, m) => s + m.unidades, 0) : meta.ventas_6m;
  const ultimo = meses[meses.length - 1] ?? null;
  const nombreUltimo = ultimo ? MESES_CORTOS[Number(ultimo.ym.slice(5, 7)) - 1] : null;
  const desp = despacho && despacho.unidades !== base?.factor ? despacho : null;
  const maxNuevo = meta.max_pedido == null || meta.max_pedido === '' ? null : Number(meta.max_pedido);
  const noAlcanza = !rechazada && maxNoAlcanzaParaDespachar({ despacho, maxNuevo });
  return (
    <>
      <Par>
        <Mitad><Caja rotulo="Vendidas en 6 meses"><Fuerte tamano={16}>{cifra(total6)}</Fuerte></Caja></Mitad>
        <Mitad><Caja rotulo={`Último mes${nombreUltimo ? ` · ${nombreUltimo}` : ''}`}><Fuerte tamano={16}>{cifra(ultimo?.unidades)}</Fuerte></Caja></Mitad>
      </Par>
      <Par>
        <Mitad><Caja rotulo="Vendidas este mes"><Fuerte tamano={16}>{cifra(meta.ventas_mes)}</Fuerte></Caja></Mitad>
        <Mitad>
          <Caja rotulo="En sala">
            <Fuerte tamano={16}>{meta.existencia != null && Number.isFinite(Number(meta.existencia)) ? `${cifra(meta.existencia)} und` : '—'}</Fuerte>
          </Caja>
        </Mitad>
      </Par>
      <Caja rotulo="Última venta"><Fuerte>{meta.ultima_venta ? fmtUltimaVenta(meta.ultima_venta) : '—'}</Fuerte></Caja>
      {base || despacho ? (desp ? (
        <Par>
          <Mitad>
            <Caja rotulo="Base">
              <Fuerte>{base?.tipo ?? '—'}</Fuerte>
              {base ? <Tenue>{`factor ${cifra(base.factor)}`}</Tenue> : null}
            </Caja>
          </Mitad>
          <Mitad>
            <Caja rotulo="Despacho">
              <Fuerte>{desp.etiqueta}</Fuerte>
              <Tenue>{desp.multiplo > 1 ? `${desp.multiplo} × ${cifra(desp.factor)} = ${cifra(desp.unidades)} u.` : `factor ${cifra(desp.factor)}`}</Tenue>
            </Caja>
          </Mitad>
        </Par>
      ) : (
        <Caja rotulo="Base y despacho">
          <Fuerte>{base?.tipo ?? despacho?.etiqueta}</Fuerte>
          <Tenue>{`factor ${cifra(base?.factor ?? despacho?.factor ?? 1)}`}</Tenue>
        </Caja>
      )) : null}
      {lista.length > 1 ? (
        <Caja rotulo="Presentaciones">
          <Fichas textos={lista.map((pr) => `${pr.tipo} ×${cifra(pr.factor)}`)} color={GRIS} />
        </Caja>
      ) : null}
      {noAlcanza ? (
        <Advertencia texto={`MAX ${cifra(meta.max_pedido)} es menos de lo que se despacha (${despacho.etiqueta}, ${cifra(despacho.unidades)} u.): el pedido no mandará nada.`} />
      ) : null}
    </>
  );
}

function BloqueMinMax({ req, meta }) {
  const aprobada = req?.status === 'APPROVED';
  const rechazada = req?.status === 'REJECTED';
  const nOnull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const sinCambio = ajusteSinCambio({ min: nOnull(meta.min_actual), max: nOnull(meta.max_actual) }, nOnull(meta.min_pedido), nOnull(meta.max_pedido));
  const sala = meta.branch_name || 'la sucursal';
  return (
    <>
      <Caja rotulo="Producto">
        <Fuerte>{meta.producto ?? `#${meta.erp_product_id}`}</Fuerte>
        {meta.branch_name ? <Tenue>{meta.branch_name}</Tenue> : null}
      </Caja>
      <Par>
        <Mitad><Caja rotulo={aprobada ? 'Antes' : 'Hoy'}><Fuerte>{`MIN ${meta.min_actual ?? '—'} · MAX ${meta.max_actual ?? '—'}`}</Fuerte></Caja></Mitad>
        <Mitad><Caja rotulo="Nuevo" color={MARCA.azulClaro} tinte={MARCA.azulClaro}><Fuerte color={MARCA.azulClaro}>{`MIN ${meta.min_pedido ?? '—'} · MAX ${meta.max_pedido ?? '—'}`}</Fuerte></Caja></Mitad>
      </Par>
      {sinCambio && !rechazada ? (
        <Advertencia color={MARCA.ambar} texto={`${aprobada ? 'No cambió nada: ' : 'Aprobarlo no cambia nada: '}${sala} ${aprobada ? 'ya estaba' : 'ya está'}${nOnull(meta.min_actual) === null ? ' sin MIN ni MAX' : ` en MIN ${meta.min_actual} · MAX ${meta.max_actual}`}, que es lo mismo que ${aprobada ? 'se pidió' : 'se pide'}.`} />
      ) : null}
      {!sinCambio && !rechazada && Number(meta.min_pedido) === 0 && Number(meta.max_pedido) === 0 ? (
        <Advertencia color={MARCA.ambar} texto={aprobada
          ? `Dejó de reponerse: el producto ya no entra en los pedidos de ${sala} hasta que alguien le fije un MIN y un MAX.`
          : `Deja de reponerse: aprobado esto, el producto no vuelve a entrar en los pedidos de ${sala} hasta que alguien le fije un MIN y un MAX.`} />
      ) : null}
      <ContextoMinMax meta={meta} rechazada={rechazada} />
    </>
  );
}

// ── La venta de una solicitud de facturación (compacta: la tarjeta ya dice el resto) ──

function LaVenta({ meta, empleados }) {
  const invoiceId = meta?.invoice_id ?? null;
  const [venta, setVenta] = useState(null);
  const [lineas, setLineas] = useState(null);
  useEffect(() => {
    if (!invoiceId) return undefined;
    let vivo = true;
    fetchInvoiceById(invoiceId).then(({ data }) => { if (vivo) setVenta(data ?? null); }).catch(() => {});
    fetchInvoiceItemsForInvoice(invoiceId).then(({ data }) => { if (vivo) setLineas(data ?? []); }).catch(() => { if (vivo) setLineas([]); });
    return () => { vivo = false; };
  }, [invoiceId]);
  const cargando = invoiceId ? lineas === null : false;
  const filas = lineas ?? [];
  const total = venta?.total ?? meta?.total;
  const vendedor = venta?.cod_vendedor ? (empleados || []).find((e) => String(e.code) === String(venta.cod_vendedor)) : null;
  const anulada = ESTADOS_ANULADA.includes(String(venta?.estado ?? '').toUpperCase());
  const conSello = tieneSelloMh(venta?.recibido_mh);
  // Un renglón sin descripción a veces es un ajuste que RESTA: si con él sumado
  // no cuadra y restándolo sí, se resta. La misma lógica que `LaVenta` del portal.
  const suma = (l) => l.reduce((t, it) => t + Number(it.total_linea || 0), 0);
  const sinDescripcion = filas.filter((it) => !it.descripcion);
  const sumaCruda = suma(filas);
  const sumaRestando = sumaCruda - 2 * suma(sinDescripcion);
  const cuadra = (x) => total != null && Math.abs(Number(total) - x) <= 0.02;
  const restar = !cuadra(sumaCruda) && sinDescripcion.length > 0 && cuadra(sumaRestando);
  const sumaMostrada = restar ? sumaRestando : sumaCruda;
  const hayDescuadre = filas.length > 0 && total != null && !cuadra(sumaMostrada);
  const unidades = filas.filter((it) => !(restar && !it.descripcion)).reduce((t, it) => t + Number(it.cantidad || 0), 0);
  return (
    <>
      {anulada ? <Advertencia texto={`Esta venta ya figura como anulada (${venta.estado}). No hace falta anularla de nuevo.`} /> : null}
      <Caja>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 8 }}>
          <View style={{ gap: 3 }}>
            <Rotulo>Atendió</Rotulo>
            {vendedor ? <Persona persona={vendedor} tamano={22} /> : <Fuerte>{venta?.cod_vendedor ? `Código ${venta.cod_vendedor}` : '—'}</Fuerte>}
          </View>
          {venta ? (
            <>
              <View style={{ gap: 3 }}>
                <Rotulo>Hacienda</Rotulo>
                <Fuerte color={conSello ? MARCA.verde : MARCA.ambar}>{conSello ? '✓ Con sello' : '! Sin sello'}</Fuerte>
              </View>
              <View style={{ gap: 3 }}>
                <Rotulo>Estado</Rotulo>
                <Fuerte color={anulada ? MARCA.rojo : undefined}>{venta.estado || '—'}</Fuerte>
              </View>
            </>
          ) : null}
        </View>
      </Caja>
      <Caja rotulo="Qué se vendió">
        {filas.length > 0 ? (
          <Tenue>{`${filas.length} ${filas.length === 1 ? 'renglón' : 'renglones'}${unidades > 0 ? ` · ${cifra(unidades)} ${unidades === 1 ? 'unidad' : 'unidades'}` : ''}`}</Tenue>
        ) : null}
        {cargando ? <ActivityIndicator style={{ marginVertical: 6 }} /> : filas.length === 0 ? (
          <Tenue>No hay detalle de productos guardado para esta venta.</Tenue>
        ) : filas.map((it, i) => {
          const resta = restar && !it.descripcion;
          const vence = it.fecha_vencimiento ? fechaTexto(it.fecha_vencimiento, { month: 'short', year: 'numeric' }) : null;
          const detalle = [it.presentacion, it.lote && `lote ${it.lote}`, vence && `vence ${vence}`].filter(Boolean).join(' · ');
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingTop: 7, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <Text style={{ color: GRIS, fontSize: 12, fontWeight: '700', width: 18 }}>{i + 1}</Text>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '700' }}>{it.descripcion || (resta ? 'Ajuste sobre la venta' : 'Sin descripción')}</Text>
                {detalle ? <Tenue>{detalle}</Tenue> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Fuerte tamano={13}>{`${resta ? '−' : ''}${formatMoney(it.total_linea || 0)}`}</Fuerte>
                {!resta ? <Tenue>{`${cifra(it.cantidad || 0)} × ${formatMoney(it.precio_unitario || 0)}`}</Tenue> : null}
              </View>
            </View>
          );
        })}
        {venta ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingTop: 8, marginTop: 2, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            <Text style={{ flex: 1, color: GRIS, fontSize: 12, fontWeight: '600' }}>
              {`Gravado ${formatMoney(venta.subtotal || 0)} · IVA ${formatMoney(venta.iva || 0)}${Number(venta.retencion || 0) > 0 ? ` · Retención ${formatMoney(venta.retencion)}` : ''}`}
            </Text>
            <Fuerte tamano={15}>{formatMoney(total || 0)}</Fuerte>
          </View>
        ) : null}
      </Caja>
      {hayDescuadre ? (
        <Advertencia color={MARCA.ambar} texto={`Los renglones suman ${formatMoney(sumaMostrada)} y la venta dice ${formatMoney(total)} — una diferencia de ${formatMoney(Math.abs(Number(total) - sumaMostrada))}. El detalle guardado no explica el total: revisa la venta antes de decidir.`} />
      ) : null}
    </>
  );
}

/** «ID de venta 123» — para ubicarla en el sistema de la caja. */
function IdVenta({ meta }) {
  const id = meta?.erp_invoice_id ?? meta?.erp_aplicado?.erp_invoice_id ?? null;
  return id ? <Tenue>{`ID de venta ${id}`}</Tenue> : null;
}

// ── El bloque de cada tipo ───────────────────────────────────────────────────

function BloquePorTipo({ req, meta, empleados }) {
  const t = req.type;
  if (t === 'INVENTORY_LOAD_REQUEST' || t === 'INVENTORY_DISCARD_REQUEST' || t === 'INVENTORY_TRANSFER_REQUEST') {
    return (
      <>
        <CabeceraMovimiento req={req} meta={meta} />
        <LineasMovimiento meta={meta} signo={SIGNO_POR_TIPO[t] ?? ''} />
        <Fotos urls={meta.evidencia_urls} />
      </>
    );
  }
  if (t === 'MINMAX_CHANGE_REQUEST') return <BloqueMinMax req={req} meta={meta} />;
  if (t === 'SHIFT_CHANGE') {
    return (
      <>
        {meta.targetEmployeeName || meta.date ? (
          <Caja rotulo="Cambio de turno">
            {meta.targetEmployeeName ? <Fuerte>{`↔ ${meta.targetEmployeeName}`}</Fuerte> : null}
            {meta.date ? <Tenue>{fechaTexto(meta.date, { weekday: 'long', day: '2-digit', month: 'long' })}</Tenue> : null}
          </Caja>
        ) : null}
        {meta.myShift || meta.targetShift ? (
          <Par>
            <Mitad><Caja rotulo={shortEmployeeName(req.employee) || 'Quien pide'}><Fuerte>{meta.myShift || '—'}</Fuerte></Caja></Mitad>
            <Mitad><Caja rotulo={shortEmployeeName(meta.targetEmployeeName) || 'Con quién'}><Fuerte>{meta.targetShift || '—'}</Fuerte></Caja></Mitad>
          </Par>
        ) : null}
      </>
    );
  }
  if (t === 'DISABILITY') {
    return (
      <>
        {meta.startDate ? (
          <Caja rotulo="Período">
            <Fuerte>{`${fmtDate(meta.startDate)}${meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}${meta.days ? ` · ${meta.days}d` : ''}`}</Fuerte>
            {Number(meta.days) > 3 ? <Text style={{ color: MARCA.ambar, fontSize: 12, fontWeight: '700' }}>Requiere boleta ISSS</Text> : null}
          </Caja>
        ) : null}
        {meta.docUrl ? <Fotos urls={[meta.docUrl]} titulo={meta.docName || 'Certificado adjunto'} /> : <Advertencia color={MARCA.ambar} texto="Sin certificado adjunto." />}
      </>
    );
  }
  if (t === 'VACATION' && meta.startDate) {
    return <Caja rotulo="Período"><Fuerte>{`${fmtDate(meta.startDate)}${meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}`}</Fuerte></Caja>;
  }
  if (t === 'PERMIT' && (meta.permissionDates || []).length > 0) {
    return (
      <Caja rotulo="Días de permiso">
        <Fichas textos={meta.permissionDates.map((d) => fechaTexto(d, { weekday: 'short', day: '2-digit', month: 'short' }))} color={MARCA.verde} />
      </Caja>
    );
  }
  if (t === 'OVERTIME' && (meta.date || meta.hours)) {
    return (
      <Caja rotulo="Horas extra">
        <Fuerte tamano={16}>{meta.hours ? `${meta.hours} h` : 'Sin especificar'}</Fuerte>
        {meta.date ? <Tenue>{fechaTexto(meta.date, { weekday: 'long', day: '2-digit', month: 'long' })}</Tenue> : null}
      </Caja>
    );
  }
  if (t === 'ADVANCE' && meta.amount) {
    return <Caja rotulo="Monto solicitado"><Fuerte tamano={16}>{`$${Number(meta.amount).toLocaleString('es-SV')}`}</Fuerte></Caja>;
  }
  if (t === 'CERTIFICATE' && meta.certificateType) {
    return (
      <Caja rotulo="Tipo">
        <Fuerte>{{ LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' }[meta.certificateType] || meta.certificateType}</Fuerte>
      </Caja>
    );
  }
  if ((t === 'ANNULMENT_REQUEST' || t === 'PAYMENT_CHANGE_REQUEST') && meta.correlativo) {
    return <><LaVenta meta={meta} empleados={empleados} /><IdVenta meta={meta} /></>;
  }
  if (t === 'VENDOR_CHANGE_REQUEST' && meta.correlativo) {
    return (
      <>
        <LaVenta meta={meta} empleados={empleados} />
        <Par>
          <Mitad><Caja rotulo="Atendió"><Persona foto={meta.current_vendor_photo} nombre={meta.current_vendor_name} vacio="Sin vendedor" /></Caja></Mitad>
          <Mitad><Caja rotulo="Pasa a" color={MARCA.azulClaro}><Persona foto={meta.new_vendor_photo} nombre={meta.new_vendor_name} /></Caja></Mitad>
        </Par>
        <IdVenta meta={meta} />
      </>
    );
  }
  if (t === 'CLIENT_CHANGE_REQUEST' && meta.correlativo) {
    return (
      <>
        <LaVenta meta={meta} empleados={empleados} />
        <Par>
          <Mitad><Caja rotulo="Cliente actual"><Fuerte>{meta.current_cliente || 'Sin nombre'}</Fuerte></Caja></Mitad>
          <Mitad>
            <Caja rotulo="Cambiar a" color={MARCA.azulClaro}>
              <Fuerte>{meta.new_client_name}</Fuerte>
              {meta.new_client_nit || meta.new_client_dui ? <Tenue>{meta.new_client_nit ? `NIT ${meta.new_client_nit}` : `DUI ${meta.new_client_dui}`}</Tenue> : null}
            </Caja>
          </Mitad>
        </Par>
        <IdVenta meta={meta} />
      </>
    );
  }
  if (t === 'CAJA_MOVIMIENTO_CHANGE' || t === 'ABONO_CREDITO_CHANGE') {
    const anula = meta.que === 'ANULAR';
    const esAbono = t === 'ABONO_CREDITO_CHANGE';
    return (
      <>
        <Caja rotulo={esAbono ? 'Abono a un crédito' : 'Movimiento de caja'}>
          <Fuerte>{esAbono ? (meta.cliente || `Crédito ${meta.credito_erp ?? '—'}`) : (meta.concepto || 'Sin concepto')}</Fuerte>
          {esAbono && meta.credito_erp ? <Tenue>{`Crédito ${meta.credito_erp}`}</Tenue> : null}
        </Caja>
        {anula ? (
          <Caja rotulo="Se pide anularlo" color={MARCA.rojo}>
            <Fuerte tamano={16}>{formatMoney(meta.monto_actual)}</Fuerte>
            <Tenue>{esAbono ? 'vuelve al saldo del crédito' : 'sale de la caja del día'}</Tenue>
          </Caja>
        ) : (
          <Par>
            <Mitad>
              <Caja rotulo={meta.que === 'FORMA' ? 'Forma actual' : 'Monto actual'}>
                <Fuerte>{meta.que === 'FORMA' ? (meta.forma_actual || '—') : formatMoney(meta.monto_actual)}</Fuerte>
              </Caja>
            </Mitad>
            <Mitad>
              <Caja rotulo="Cambiar a" color={MARCA.azulClaro}>
                <Fuerte color={MARCA.azulClaro}>{meta.que === 'FORMA' ? (meta.forma_nueva || '—') : formatMoney(meta.monto_nuevo)}</Fuerte>
                {meta.documento_nuevo ? <Tenue>{meta.documento_nuevo}</Tenue> : null}
              </Caja>
            </Mitad>
          </Par>
        )}
        {esAbono && !anula ? <Tenue>Se corrige quitando el abono y volviéndolo a hacer, así que el crédito va a mostrar los dos movimientos.</Tenue> : null}
        <Fotos urls={meta.comprobante_url ? [meta.comprobante_url] : null} titulo="Comprobante" />
      </>
    );
  }
  if (t === 'DIST_DESCUENTO') {
    const renglones = Array.isArray(meta.renglones) ? meta.renglones : [];
    return (
      <>
        <Caja rotulo="La venta">
          <Fuerte>{meta.cliente || 'Sin nombre'}</Fuerte>
          <Tenue>{`Descuento pedido: ${formatMoney(meta.total)}`}</Tenue>
          {meta.tope_pct != null ? <Tenue>{`Tope de la empresa: ${Number(meta.tope_pct)}% por producto`}</Tenue> : null}
        </Caja>
        {renglones.length > 0 ? (
          <Caja rotulo={renglones.length === 1 ? 'El producto' : `Los ${renglones.length} productos`}>
            {renglones.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 7, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '700' }}>{r?.descripcion}</Text>
                  <Tenue>{`${Number(r?.cantidad)} × ${formatMoney(r?.precio)} con IVA`}</Tenue>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Fuerte color={MARCA.rojo} tamano={13}>{`−${formatMoney(r?.descuento)}`}</Fuerte>
                  {r?.pct != null ? <Tenue>{`${Number(r.pct)}%`}</Tenue> : null}
                </View>
              </View>
            ))}
          </Caja>
        ) : null}
      </>
    );
  }
  if (t === 'ABONO_APROBACION') {
    const renglones = Array.isArray(meta.creditos) ? meta.creditos : [];
    const resuelto = renglones.some((r) => r?.decision);
    return (
      <>
        <Caja rotulo="El pago">
          <Fuerte>{meta.cliente || 'Sin nombre'}</Fuerte>
          <Fuerte tamano={16}>{`${formatMoney(meta.monto)}${meta.forma ? `  ·  ${meta.forma}` : ''}`}</Fuerte>
          <Tenue>{meta.ya_aplicado ? 'Ya aplicado en la caja' : 'Todavía sin aplicar'}</Tenue>
          {meta.detalle ? <Tenue>{meta.detalle}</Tenue> : null}
        </Caja>
        {renglones.length > 0 ? (
          <Caja rotulo={renglones.length === 1 ? 'El crédito que cubre' : `Los ${renglones.length} créditos que cubre`}>
            {renglones.map((r, i) => {
              const devuelto = r?.decision === 'RECHAZADO';
              return (
                <View key={`${r?.credito ?? i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 7, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '700' }}>{`Crédito ${r?.credito ?? '—'}`}</Text>
                    {r?.fecha ? <Tenue>{r.fecha}</Tenue> : null}
                    {devuelto && r?.motivo ? <Text style={{ color: MARCA.rojo, fontSize: 12, fontWeight: '600' }}>{r.motivo}</Text> : null}
                  </View>
                  <Fuerte tamano={13}>{formatMoney(r?.monto)}</Fuerte>
                  {resuelto ? (
                    <Pildora color={devuelto ? MARCA.rojo : MARCA.verde}
                      texto={devuelto ? (r?.deshecho === false ? 'Falta quitarlo' : meta.ya_aplicado ? 'Devuelto' : 'Sin cobrar') : 'Abonado'} />
                  ) : null}
                </View>
              );
            })}
          </Caja>
        ) : null}
        <Fotos urls={meta.comprobante_url ? [meta.comprobante_url] : null} titulo="Comprobante" />
      </>
    );
  }
  return null;
}

// ── Lo aplicado y lo recibido ────────────────────────────────────────────────

function Firmante({ acto, porId }) {
  const persona = acto?.by ? porId.get(String(acto.by)) : null;
  if (persona) return <Persona persona={persona} tamano={22} />;
  if (acto?.by_name) return <Fuerte>{acto.by_name}</Fuerte>;
  return null;
}

function BloqueAplicado({ req, aplicado, porId }) {
  if (!aplicado) return null;
  const esMovimiento = req.type?.startsWith('INVENTORY_');
  const origen = req.metadata?.origen_branch_name ?? null;
  const rotulo = req.type === 'INVENTORY_TRANSFER_REQUEST' ? (origen ? `Despachado desde ${origen}` : 'Despachado') : 'Aplicado';
  const que = esMovimiento
    ? `${aplicado.lineas ?? 0} ${aplicado.lineas === 1 ? 'producto' : 'productos'} · ${aplicado.unidades ?? 0} ${aplicado.unidades === 1 ? 'unidad' : 'unidades'}${Number.isFinite(Number(aplicado.total)) ? ` · ${formatMoney(aplicado.total)}` : ''}`
    : aplicado.campo === 'anulacion'
      ? (aplicado.solventado_internamente ? 'Factura anulada en el sistema' : 'Factura anulada')
      : `${aplicado.de || '—'} → ${aplicado.a || '—'}`;
  return (
    <Caja rotulo={rotulo} color={MARCA.verde} tinte={MARCA.verde}>
      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{`${que}${aplicado.by || aplicado.by_name ? ' · por' : ''}`}</Text>
      <Firmante acto={aplicado} porId={porId} />
      {aplicado.instruccion ? (
        <View style={{ gap: 2, marginTop: 2 }}>
          <Text style={{ color: MARCA.ambar, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>Falta hacer</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{aplicado.instruccion}</Text>
        </View>
      ) : null}
      {aplicado.hacienda?.sello ? <Tenue>{`Sello de Hacienda: ${aplicado.hacienda.sello}`}</Tenue> : null}
      {aplicado.concepto_recortado ? <Tenue>El detalle se guardó abreviado.</Tenue> : null}
      {Array.isArray(aplicado.avisos) && aplicado.avisos.length > 0 ? aplicado.avisos.map((a, i) => <Tenue key={i}>{`• ${a}`}</Tenue>) : null}
    </Caja>
  );
}

function BloqueRecibido({ req, recibido, despachado, porId }) {
  if (!recibido) return null;
  const destino = req.metadata?.branch_name;
  const cerroElPortal = !recibido.by_name;
  const tardanza = cuantoTardo(despachado?.at, recibido.at);
  const numero = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const lineas = numero(recibido.lineas);
  const unidades = numero(recibido.unidades);
  const total = numero(recibido.total);
  const partes = [
    lineas != null && `${lineas} ${lineas === 1 ? 'producto' : 'productos'}`,
    unidades != null && `${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`,
    total != null && formatMoney(total),
    cerroElPortal ? 'lo cerró el portal solo' : 'por',
  ].filter(Boolean).join(' · ');
  return (
    <Caja rotulo={destino ? `Recibido en ${destino}` : 'Recibido'} color={MARCA.verde} tinte={MARCA.verde}>
      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{partes}</Text>
      {!cerroElPortal ? <Firmante acto={recibido} porId={porId} /> : null}
      <Tenue>{`${fmtFechaHora(recibido.at)}${tardanza ? ` · ${tardanza} desde el despacho` : ''}`}</Tenue>
      {recibido.via === 'sistema' && recibido.msg ? <Tenue>{recibido.msg}</Tenue> : null}
    </Caja>
  );
}

// ── El detalle ───────────────────────────────────────────────────────────────

export default function DetalleDeAviso({ n }) {
  const empleados = useStaffStore((s) => s.employees);
  const personasDeSolicitudes = useStaffStore((s) => s.personasDeSolicitudes);
  const resolverPersonas = useStaffStore((s) => s.resolverPersonasDeSolicitudes);
  const [fila, setFila] = useState(null);
  const [error, setError] = useState('');
  const esMinMax = esAvisoDeMinMax(n);
  const id = n?.metadata?.request_id ?? null;

  useEffect(() => {
    if (!id) return undefined;
    let vivo = true;
    cargarFilaDeAviso(n)
      .then((f) => {
        if (!vivo) return;
        if (!f) { setError('Esta solicitud ya no está disponible.'); return; }
        setFila(f);
      })
      .catch((err) => { if (vivo) setError(mensajeAmigable(err, 'No se pudo abrir el detalle.')); });
    return () => { vivo = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps -- el aviso sólo importa por su id

  // Las dos personas pueden no estar en el maestro (los cargos `is_su` no se
  // listan): se piden al llegar la fila, y sólo lo que falte.
  useEffect(() => {
    if (!fila || !resolverPersonas) return;
    if (esMinMax) resolverPersonas([fila.requested_by_id], [fila.decided_by]);
    else resolverPersonas([fila.employee_id, fila.approver_id]);
  }, [fila, esMinMax, resolverPersonas]);

  const porId = useMemo(() => {
    const m = new Map();
    (empleados ?? []).forEach((e) => m.set(String(e.id), e));
    Object.entries(personasDeSolicitudes || {}).forEach(([k, p]) => { if (!m.has(k)) m.set(k, p); });
    return m;
  }, [empleados, personasDeSolicitudes]);

  const req = useMemo(() => {
    if (!fila) return null;
    if (esMinMax) {
      const enElMaestro = buscadorDePersonas(empleados);
      return adaptarMinMax(fila, (sid) => ERP_NAMES[sid],
        (k) => enElMaestro(k) ?? (k ? (personasDeSolicitudes?.[String(k)] ?? null) : null));
    }
    return { ...fila, employee: porId.get(String(fila.employee_id)) ?? null, approver: porId.get(String(fila.approver_id)) ?? null };
  }, [fila, esMinMax, empleados, porId, personasDeSolicitudes]);

  if (error) return <Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '700', paddingVertical: 6 }}>{error}</Text>;
  if (!req) return <ActivityIndicator style={{ marginVertical: 10 }} />;

  const meta = (typeof req.metadata === 'object' && req.metadata) ? req.metadata : {};
  const motivoRechazo = motivoDeRechazo(req);
  const isRejected = req.status === 'REJECTED';

  return (
    <View style={{ gap: 8 }}>
      <BloquePorTipo req={req} meta={meta} empleados={empleados} />
      <BloqueAplicado req={req} aplicado={meta.erp_aplicado ?? meta.erp_traslado} porId={porId} />
      <BloqueRecibido req={req} recibido={meta.erp_recibido} despachado={meta.erp_traslado} porId={porId} />
      {motivoRechazo ? (
        <Caja rotulo="Motivo de rechazo" color={MARCA.rojo} tinte={MARCA.rojo}>
          {motivoRechazo.titular ? <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '800' }}>{motivoRechazo.titular}</Text> : null}
          {motivoRechazo.detalle ? <Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '600' }}>{motivoRechazo.detalle}</Text> : null}
        </Caja>
      ) : null}
      {!isRejected && req.approver_note ? (
        <Caja rotulo="Nota de quien decidió" color={MARCA.verde} tinte={MARCA.verde}>
          <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{req.approver_note}</Text>
        </Caja>
      ) : null}
      {req.approvals?.length > 1 ? (
        <Caja rotulo="Historial">
          {req.approvals.map((ap, i) => {
            const quien = ap.approverId ? porId.get(String(ap.approverId)) ?? null : null;
            return (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingTop: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                {quien ? <Avatar empleado={quien} tamano={26} /> : <Text style={{ color: MARCA.verde, fontSize: 14 }}>✓</Text>}
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={{ color: MARCA.verde, fontSize: 13, fontWeight: '800' }}>{quien ? `${shortEmployeeName(quien)}${quien.role ? ` · ${quien.role}` : ''}` : `Nivel ${ap.level}`}</Text>
                  <Tenue>{fmtFechaHora(ap.approvedAt)}</Tenue>
                  {ap.approverNote ? <Text style={{ color: GRIS, fontSize: 12, fontStyle: 'italic' }}>{`“${ap.approverNote}”`}</Text> : null}
                </View>
              </View>
            );
          })}
        </Caja>
      ) : null}
    </View>
  );
}
