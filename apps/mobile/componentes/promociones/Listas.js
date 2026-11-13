// Las pestañas secundarias de Promociones en la app — Descuentos, Excedentes y
// Pagos, Rebajas —, con los mismos datos que el portal (`TabDescuentos`, `TabExcedentes`,
// `TabPagos`, `TabRebajas`). Un descuento se corrige, se borra o se lleva a la app de
// clientes; Pagos se mira; un excedente se aprueba o se niega
// con `decidirExcedente`, la misma llamada del portal (negar exige el motivo,
// como lo exige la base).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { borrarDescuento, fetchDescuentos, fetchRebajasEnVentas, fotoParaApp } from '@nucleo/data/descuentos';
import { fetchOfertaDeDescuento } from '@nucleo/data/ofertasClientes';
import { decidirExcedente, fetchExcedentes } from '@nucleo/data/promociones';
import { fetchPagosBonoProducto } from '@nucleo/data/bonosProducto';
import {
  PAGO_BONO_HECHO, SECCIONES_DE_DESCUENTOS, csvExcedentes, csvPagosBono, descuentosPorEstado, estadoDescuento, fmtMoneda, fmtUnidades, fmtVigencia,
  mensajeDeCarga, ofertaDesdeDescuento, pagoBonoPendiente,
} from '@nucleo/utils/promocionesUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { comoDescuenta, csvRebajas } from '@nucleo/utils/rebajasVenta';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { correrMes, etiquetaMes, fechaTexto, hoySV, mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, Cargando } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import { MARCA } from '../inicio/marca';
import { colorDeVariante } from '../colorDeVariante';
import { guardar } from '../comercial/elegido';
import { guardarOferta } from '../ofertas/acentos';
import { fallo, listo } from '../Progreso';
import Tocable from '../Tocable';
import Subfiltro from '../Subfiltro';
import { compartirCsv } from '../fiscal/csv';
import { Vacio as VacioBase } from '../formulario/Piezas';
import { MAYUSCULAS } from '../../tema/mayusculas';

const Vacio = ({ texto }) => <VacioBase titulo={texto} />;
// «Descargar CSV» de lo que se ve, con el mismo archivo del portal (núcleo).
export function DescargarCsv({ cuenta, csv }) {
  const compartir = () => { compartirCsv({ ...csv(), modulo: 'promociones' }).catch((e) => fallo('No se pudo compartir', e?.message || '')); };
  return (
    <View style={{ marginHorizontal: 20, flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{cuenta}</Text>
      <Tocable onPress={compartir} hitSlop={8} accessibilityRole="button">
        <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Descargar CSV</Text>
      </Tocable>
    </View>
  );
}

const Tarjeta = ({ children }) => <View style={{ marginHorizontal: 16 }}><Vidrio radio={20}><View style={{ padding: 14, gap: 6 }}>{children}</View></Vidrio></View>;

// ── Descuentos: lo que baja el precio en la caja ────────────────────────────
// Como `TabDescuentos`: en tres secciones (descontando, programados,
// terminados), y con permiso «Corregir» (`descuento/[id]`), «Borrar» (no hay
// «apagar» en la caja: o se mueve el fin, o se borra) y «En la app» (arma la
// oferta de la app de clientes desde el descuento, con la foto del momento).
export function Descuentos({ busqueda, salaDe, sala = '', estado = '', onAlcance, puedeEditar = false, puedeApp = false }) {
  const [datos, setDatos] = useState(null);
  const [alcanceTodo, setAlcanceTodo] = useState(false);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const cargar = useCallback(() => fetchDescuentos()
    .then((d) => { setDatos(d.descuentos); setAlcanceTodo(d.alcanceTodo === true); onAlcance?.(d.alcanceTodo === true); setError(null); })
    .catch((e) => { setError(mensajeDeCarga(e, 'No se pudieron cargar los descuentos.')); setDatos((x) => x ?? []); }), []);
  useEffect(() => { cargar(); }, [cargar]);
  const hoy = hoySV();
  // Como el portal: «En todas las salas» también descuenta en la sala elegida.
  const filas = useMemo(() => (datos || []).filter((d) => (!busqueda || tokenMatch(busqueda, d.descripcion, ...(d.productos || []).map((p) => p.nombre)))
    && (!sala || d.todas_las_salas || String(d.branch_id) === String(sala))
    && (!estado || estadoDescuento(d, hoy).clave === estado)), [datos, busqueda, sala, estado, hoy]);
  const porEstado = useMemo(() => descuentosPorEstado(filas, hoy), [filas, hoy]);

  const corregir = (d) => { guardar('descuento-alcance', alcanceTodo); router.push({ pathname: '/descuento/[id]', params: { id: String(d.id) } }); };
  const borrar = (d) => Alert.alert('¿Borrar el descuento?',
    `«${d.descripcion}» deja de aplicarse en el acto, en todas las ventas. Si sólo quieres que termine antes, corrígele la fecha de fin en vez de borrarlo.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => {
        setOcupado(d.id);
        try { await borrarDescuento(d.id); listo('Descuento borrado', 'Ya no se aplica en la caja.'); cargar(); }
        catch (e) { fallo('No se pudo borrar el descuento', mensajeAmigable(e)); }
        setOcupado(null);
      } },
    ]);
  const enLaApp = async (d) => {
    setOcupado(d.id);
    try {
      // La foto se pide AL ABRIR: entre que se cargó la lista y el toque, alguien pudo corregir el descuento.
      const [foto, previa] = await Promise.all([fotoParaApp(d.id), fetchOfertaDeDescuento(d.id)]);
      const oferta = ofertaDesdeDescuento(d, foto, previa);
      guardarOferta(oferta);
      router.push({ pathname: '/oferta/[id]', params: { id: oferta.id ? String(oferta.id) : 'nueva' } });
    } catch (e) { fallo('No se pudo leer el descuento', mensajeAmigable(e)); }
    setOcupado(null);
  };

  if (datos == null) return <Cargando />;
  const accion = (texto, color, onPress, off) => (
    <Tocable disabled={off} onPress={onPress} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center', opacity: off ? 0.4 : 1 }}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Tocable>
  );
  return (
    <>
      <FilaDeKpis>
        <Kpi icono="Percent" rotulo="Descontando" valor={String(porEstado.activos.length)} color={MARCA.verde} />
        <Kpi icono="CalendarClock" rotulo="Programados" valor={String(porEstado.programados.length)} color={MARCA.azulClaro} />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="CheckCircle2" rotulo="Terminados" valor={String(porEstado.terminados.length)} color={colorSistema.texto2} />
        <Kpi icono="Package" rotulo="Productos" valor={fmtUnidades(new Set(filas.flatMap((d) => (d.productos || []).map((p) => p.id))).size)} color={MARCA.azulClaro}
          apoyo="distintos con descuento" />
      </FilaDeKpis>
      <View style={{ marginHorizontal: 16 }}><Aviso texto="Los descuentos nacen al crear la promoción. Aquí se ven todos —incluidos los que se cargaron sin promoción— y se corrigen o se quitan." /></View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {SECCIONES_DE_DESCUENTOS.map(({ clave, titulo, sub }) => (porEstado[clave].length ? (
        <View key={clave} style={{ gap: 10 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: MAYUSCULAS, marginHorizontal: 20 }}>{`${titulo} · ${porEstado[clave].length} — ${sub}`}</Text>
          {porEstado[clave].map((d) => {
            const e = estadoDescuento(d, hoy);
            const productos = d.productos || [];
            return (
              <Tarjeta key={d.id ?? `${d.descripcion}-${d.inicio}`}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{d.descripcion}</Text>
                  <Pildora texto={e.rotulo} color={colorDeVariante(e.variant)} />
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {[d.monto != null ? comoDescuenta(d) : null, fmtVigencia(d.inicio, d.fin), d.todas_las_salas ? 'Todas las salas' : (salaDe(d.branch_id) ?? d.sala_rotulo), `${productos.length} producto${productos.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                </Text>
                {d.promocion ? <Text style={{ color: MARCA.azulClaro, fontSize: 12, fontWeight: '600' }}>{`De la promoción «${d.promocion}»`}</Text> : null}
                {/* `en_app`: null = sin oferta; true publicada; false armada sin publicar. */}
                {d.en_app === true ? <Pildora texto="En la app" color={MARCA.verde} />
                  : d.en_app === false ? <Pildora texto="App: sin publicar" color={colorSistema.texto2} /> : null}
                {productos.slice(0, 6).map((p) => (
                  <Text key={p.id ?? p.nombre} style={{ color: colorSistema.texto, fontSize: 13 }}>
                    {`· ${p.nombre}${p.precio != null ? ` — ${formatMoney(p.precio)}` : ''}`}
                  </Text>
                ))}
                {productos.length > 6 ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`y ${productos.length - 6} más`}</Text> : null}
                {(puedeEditar || (puedeApp && clave !== 'terminados')) && d.id ? (
                  <View style={{ flexDirection: 'row', gap: 18, flexWrap: 'wrap' }}>
                    {puedeEditar ? accion('Corregir', MARCA.azulClaro, () => corregir(d), ocupado === d.id) : null}
                    {puedeApp && clave !== 'terminados' ? accion(d.en_app == null ? 'En la app' : 'Oferta en la app', MARCA.verde, () => enLaApp(d), ocupado === d.id) : null}
                    {puedeEditar ? accion('Borrar', MARCA.rojo, () => borrar(d), ocupado === d.id) : null}
                  </View>
                ) : null}
              </Tarjeta>
            );
          })}
        </View>
      ) : null))}
      {!filas.length && !error ? <Vacio texto={busqueda || sala || estado ? 'Ningún descuento con ese filtro' : 'Sin descuentos'} /> : null}
    </>
  );
}

// ── Excedentes: lo vendido por encima del lote ──────────────────────────────
export function Excedentes({ busqueda, puedeAprobar }) {
  const [todas, setTodas] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const cargar = useCallback(() => fetchExcedentes('por_decidir').then(setTodas).catch((e) => { setError(mensajeDeCarga(e, 'No se pudieron cargar los excedentes.')); setTodas([]); }), []);
  useEffect(() => { cargar(); }, [cargar]);
  const filas = useMemo(() => (todas || []).filter((f) => !busqueda || tokenMatch(busqueda, f.persona, f.promocion, f.producto, f.sala)), [todas, busqueda]);
  const total = filas.reduce((a, f) => a + (Number(f.monto) || 0), 0);
  const personas = new Set(filas.map((f) => f.persona)).size;

  const decidir = async (f, aprobar, motivo) => {
    setOcupado(f.id);
    try {
      await decidirExcedente(f.id, aprobar, motivo);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(aprobar ? 'Excedente aprobado' : 'Excedente negado', aprobar ? 'Suma a lo de esa persona.' : 'Queda el motivo para quien vendió.');
      setTodas((xs) => (xs || []).filter((x) => x.id !== f.id));
    } catch (e) {
      fallo('No se pudo registrar la decisión', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setOcupado(null);
    }
  };
  const aprobar = (f) => Alert.alert('Aprobar el excedente', `${shortEmployeeName(f.persona)} cobra ${fmtMoneda(f.monto)} por ${fmtUnidades(f.unidades)} unidades de más. No está acordado con el laboratorio.`, [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Aprobar', onPress: () => decidir(f, true, null) },
  ]);
  const negar = (f) => Alert.prompt('Negar el excedente', 'El motivo es obligatorio: es lo único que le queda a quien vendió para reclamar.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Negar', style: 'destructive', onPress: (m) => { const t = String(m ?? '').trim(); if (!t) { fallo('Falta el motivo', ''); return; } decidir(f, false, t); } },
  ], 'plain-text');

  if (todas == null) return <Cargando />;
  return (
    <>
      {filas.length ? (
        <FilaDeKpis>
          <Kpi icono="Package" rotulo="Por decidir" valor={String(filas.length)} color={MARCA.ambar} pide
            apoyo={`${fmtUnidades(filas.reduce((a, f) => a + (Number(f.unidades) || 0), 0))} unidades de más`} />
          <Kpi icono="DollarSign" rotulo="Serían" valor={fmtMoneda(total)} color={MARCA.azulClaro} apoyo={`${personas} persona${personas === 1 ? '' : 's'}`} />
        </FilaDeKpis>
      ) : null}
      {filas.length ? (
        <View style={{ marginHorizontal: 16 }}>
          <Aviso tono="cuidado" texto="Ese bono no está acordado con el laboratorio: no se paga hasta que alguien lo apruebe, y mientras tanto no suma a lo de nadie." />
        </View>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {filas.length ? <DescargarCsv cuenta={`${filas.length} por decidir`} csv={() => csvExcedentes(filas)} /> : null}
      {filas.map((f) => (
        <Tarjeta key={f.id}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{shortEmployeeName(f.persona)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[f.sala, f.promocion].filter(Boolean).join(' · ')}</Text>
            </View>
            <Text style={{ color: MARCA.azulClaro, fontSize: 17, fontWeight: '800' }}>{fmtMoneda(f.monto)}</Text>
          </View>
          <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{f.producto}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${fmtUnidades(f.unidades)} de más${f.lote_total != null ? ` · lote ${fmtUnidades(f.lote_total)}` : ''}`}</Text>
          {puedeAprobar ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Tocable disabled={ocupado === f.id} onPress={() => aprobar(f)} style={({ pressed }) => ({ flex: 1, minHeight: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.verde, opacity: ocupado === f.id ? 0.5 : pressed ? 0.8 : 1 })}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Aprobar</Text>
              </Tocable>
              <Tocable disabled={ocupado === f.id} onPress={() => negar(f)} style={({ pressed }) => ({ flex: 1, minHeight: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: MARCA.rojo, opacity: ocupado === f.id ? 0.5 : pressed ? 0.8 : 1 })}>
                <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '700' }}>Negar</Text>
              </Tocable>
            </View>
          ) : null}
        </Tarjeta>
      ))}
      {!filas.length && !error ? <Vacio texto={busqueda ? 'Ningún excedente con esa búsqueda' : 'Sin excedentes por decidir'} /> : null}
    </>
  );
}

// ── Pagos: el bono de las promociones terminadas ────────────────────────────
const PAGADO = PAGO_BONO_HECHO;

export function Pagos({ busqueda, soloPendientes }) {
  const [todas, setTodas] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let vivo = true;
    fetchPagosBonoProducto().then((d) => { if (vivo) setTodas(d); }).catch((e) => { if (vivo) { setError(mensajeDeCarga(e, 'No se pudieron cargar los pagos.')); setTodas([]); } });
    return () => { vivo = false; };
  }, []);
  const promos = useMemo(() => (todas || []).filter((p) => (!soloPendientes || pagoBonoPendiente(p))
    && (!busqueda || tokenMatch(busqueda, p.promocion, ...(p.salas || []).map((x) => x.sala)))), [todas, busqueda, soloPendientes]);
  if (todas == null) return <Cargando />;
  const pendiente = promos.reduce((a, p) => a + (p.salas || []).reduce((b, s) => b + Number(s.total || 0) - Number(s.pagado || 0), 0), 0);
  const planilla = promos.reduce((a, p) => a + Number(p.administracion || 0), 0);
  return (
    <>
      <View style={{ marginHorizontal: 16 }}>
        <Aviso texto="El bono de los vendedores se paga en «Mi caja» de cada sala; el de bodega, desde la caja de Salud 3; el de administración va a la planilla." />
      </View>
      {promos.length ? (
        <FilaDeKpis>
          <Kpi icono="Wallet" rotulo="Por pagar en salas" valor={fmtMoneda(pendiente)} color={pendiente > 0 ? MARCA.ambar : MARCA.verde} pide={pendiente > 0} apoyo={`${promos.length} promoción${promos.length === 1 ? '' : 'es'}`} />
          <Kpi icono="Landmark" rotulo="A planilla" valor={fmtMoneda(planilla)} color={MARCA.azulClaro} apoyo="administración" />
        </FilaDeKpis>
      ) : null}
      {promos.length ? <DescargarCsv cuenta={`${promos.length} promoción${promos.length === 1 ? '' : 'es'}`} csv={() => csvPagosBono(promos)} /> : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {promos.map((p) => (
        <Tarjeta key={p.promocion_id}>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{p.promocion}</Text>
          {(p.salas || []).map((s, i) => (
            <View key={s.branch_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{s.sala}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${s.personas} persona${Number(s.personas) === 1 ? '' : 's'} · bono ${fmtMoneda(s.total)} · pagado ${fmtMoneda(s.pagado)}`}</Text>
              </View>
              <Pildora texto={Number(s.pendientes) > 0 ? `${s.pendientes} por pagar` : 'Pagado'} color={Number(s.pendientes) > 0 ? MARCA.ambar : MARCA.verde} />
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 12, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12 }}>
              {`Bodega (sale de Salud 3): ${fmtMoneda(p.bodega?.monto)}${p.bodega && Number(p.bodega.monto) > 0 ? (PAGADO.has(p.bodega.estado) ? ' · pagado' : ' · por pagar') : ''}`}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Administración (planilla): ${fmtMoneda(p.administracion)}`}</Text>
          </View>
        </Tarjeta>
      ))}
      {!promos.length && !error ? <Vacio texto={busqueda ? 'Ningún pago con esa búsqueda' : soloPendientes ? 'Sin pagos pendientes' : 'Sin promociones con bono terminadas'} /> : null}
    </>
  );
}

// ── Rebajas: lo que de verdad se rebajó en las ventas ───────────────────────
// Como `TabRebajas` del portal (`rebajas_en_ventas`): es de campaña si ese día,
// en esa sala, el producto tenía un descuento vigente y la rebaja es justo la
// del descuento; lo demás es un precio cambiado al vender. Las tarjetas eligen
// qué se mira; el mes se mueve con ‹ ›; el CSV es el mismo del portal.
function porQueNoEsDeCampana(r) {
  const c = `«${r.campana_cercana}»`;
  if (r.cercana_motivo === 'fuera_de_fecha') return `Es la rebaja de ${c}, que terminó el ${fechaTexto(r.cercana_fin)}`;
  if (r.cercana_motivo === 'otra_sala') return `Es la rebaja de ${c}, que no vale en esta sucursal`;
  return `Tenía ${c}, pero la rebaja no es la de ese descuento`;
}

export function Rebajas({ busqueda, sala = '', salaDe }) {
  const mesDeHoy = mesSV();
  const [periodo, setPeriodo] = useState(mesDeHoy);
  const [vista, setVista] = useState('campana');
  const [carga, setCarga] = useState({ clave: null, datos: null, error: null });
  const clave = `${periodo}|${sala}`;
  useEffect(() => {
    let vivo = true;
    const [desde, hasta] = rangoDelMes(periodo);
    fetchRebajasEnVentas({ desde, hasta, branchId: sala || null })
      .then((d) => { if (vivo) setCarga({ clave, datos: d, error: null }); })
      .catch((e) => { if (vivo) setCarga({ clave, datos: null, error: mensajeDeCarga(e, 'No se pudieron revisar las rebajas. Vuelve a intentar en un momento.') }); });
    return () => { vivo = false; };
  }, [periodo, sala, clave]);
  const listo_ = carga.clave === clave;
  const datos = listo_ ? carga.datos : null;
  const q = (busqueda || '').trim();
  const campanas = useMemo(() => (datos?.porCampana ?? []).filter((c) => !q || tokenMatch(q, c.descripcion)), [datos, q]);
  const aMano = useMemo(() => (datos?.aMano ?? []).filter((r) => !q || tokenMatch(q, r.producto, r.vendedor, r.correlativo, r.cliente)), [datos, q]);
  const nombreSala = (id) => salaDe(id) ?? '';
  const lista = vista === 'campana' ? campanas : aMano;

  return (
    <>
      <View style={{ marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Tocable onPress={() => setPeriodo((p) => correrMes(p, -1))} hitSlop={8} accessibilityLabel="Mes anterior" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 22 }}>‹</Text>
        </Tocable>
        <Tocable onPress={() => setPeriodo(mesDeHoy)} style={{ flex: 1, alignItems: 'center', minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{etiquetaMes(periodo)}</Text>
          {periodo !== mesDeHoy ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Toca para volver a este mes</Text> : null}
        </Tocable>
        <Tocable onPress={() => setPeriodo((p) => correrMes(p, 1))} disabled={periodo >= mesDeHoy} hitSlop={8} accessibilityLabel="Mes siguiente"
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: periodo >= mesDeHoy ? 0.3 : 1 }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 22 }}>›</Text>
        </Tocable>
      </View>
      {!listo_ ? <Cargando /> : carga.error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={carga.error} /></View> : (
        <>
          <FilaDeKpis>
            <Kpi icono="Percent" rotulo="De campaña" valor={fmtMoneda(datos.resumen.campana.monto)} color={MARCA.verde}
              apoyo={`${datos.resumen.campana.renglones} ${datos.resumen.campana.renglones === 1 ? 'venta' : 'ventas'}`} onPress={() => setVista('campana')} />
            <Kpi icono="PenLine" rotulo="A mano" valor={fmtMoneda(datos.resumen.a_mano.monto)} color={datos.resumen.a_mano.renglones > 0 ? MARCA.ambar : colorSistema.texto2}
              apoyo={`${datos.resumen.a_mano.renglones} ${datos.resumen.a_mano.renglones === 1 ? 'venta' : 'ventas'}`} pide={datos.resumen.a_mano.renglones > 0} onPress={() => setVista('a_mano')} />
          </FilaDeKpis>
          <Subfiltro activa={vista} onCambiar={setVista} opciones={[{ id: 'campana', label: 'De campaña' }, { id: 'a_mano', label: 'A mano' }]} />
          <Text style={{ marginHorizontal: 20, color: colorSistema.texto2, fontSize: 12 }}>
            Es de campaña cuando ese día el producto tenía un descuento vigente en la sala y la rebaja es exactamente la del descuento. Lo demás es un precio cambiado al vender.
          </Text>
          {lista.length ? (
            <DescargarCsv cuenta={vista === 'campana' ? `${campanas.length} campaña${campanas.length === 1 ? '' : 's'}` : `${aMano.length} rebaja${aMano.length === 1 ? '' : 's'} a mano`}
              csv={() => csvRebajas(vista, { porCampana: campanas, aMano }, periodo, nombreSala)} />
          ) : null}
          {vista === 'campana' ? campanas.map((c) => (
            <Tarjeta key={c.id}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{c.descripcion}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <Pildora texto={comoDescuenta(c)} color={MARCA.azulClaro} />
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${fechaTexto(c.inicio)} – ${fechaTexto(c.fin)}`}</Text>
                {c.borrada ? <Pildora texto="Ya no existe" color={colorSistema.texto2} /> : null}
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                {`${c.renglones} ${c.renglones === 1 ? 'venta' : 'ventas'} · ${fmtUnidades(Number(c.unidades))} u. · cobrado ${fmtMoneda(c.cobrado)}`}
              </Text>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{`Rebajado ${fmtMoneda(c.rebajado)}`}</Text>
            </Tarjeta>
          )) : aMano.slice(0, 200).map((r) => (
            <Tarjeta key={r.id}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{r.producto}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: MARCA.ambar, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{`−${fmtMoneda(r.rebaja)}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${r.porcentaje} %`}</Text>
                </View>
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${fechaTexto(r.fecha)} · ${r.correlativo} · ${Number(r.cantidad)} ${r.presentacion || ''}`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                {[r.vendedor ? shortEmployeeName({ name: r.vendedor }) : 'Sin ficha', nombreSala(r.branch_id), `${fmtMoneda(r.precio)} → ${fmtMoneda(r.cobrado)}`].filter(Boolean).join(' · ')}
              </Text>
              {r.campana_cercana ? <Text style={{ color: MARCA.ambar, fontSize: 13 }}>{porQueNoEsDeCampana(r)}</Text> : null}
            </Tarjeta>
          ))}
          {vista === 'a_mano' && aMano.length > 200 ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>{`Se muestran 200 de ${aMano.length}: el CSV las trae todas.`}</Text> : null}
          {!lista.length ? (
            <Vacio texto={q ? `Nada coincide con «${q}»` : vista === 'campana' ? 'En este mes no se vendió nada con un descuento de campaña' : 'En este mes todas las rebajas fueron de una campaña'} />
          ) : null}
        </>
      )}
    </>
  );
}
