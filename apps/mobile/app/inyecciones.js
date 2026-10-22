// Inyecciones, NATIVO — lo que la sala hace con el teléfono en la mano
// (`InyeccionesView`):
//
//   · Pendientes: lo pagado y sin aplicar, una tarjeta por PAGO y producto
//     («2 de 5»), de TODAS las salas —el cliente puede venir a aplicarse acá
//     aunque haya pagado en otra—. Quien opera una caja marca cuántas aplica
//     ahora con el contador y confirma.
//   · Bitácora: cada aplicación de los últimos días, quién cobró, quién aplicó,
//     cuándo y dónde. La que se cobró SIN ficha no sale en la app del cliente:
//     la fila lo dice y, a quien asigna cobros (`inyecciones_dosis`), le ofrece
//     ponérsela (`inyeccion-ficha`, 2026-10-17 en el portal).
//
//   · Por cobrar: las ventas con inyección y su cobro, por vendedor, y los
//     cobros sueltos para asignar a mano (`componentes/inyecciones/PorCobrar`).
//   · Ajustes: precio por aplicación y aplicaciones por producto
//     (`componentes/inyecciones/Ajustes`).
// Las cuatro pestañas del portal, con sus mismos permisos. Agrupar y contar
// sale del núcleo (`inyeccionesPendientes`, `inyeccionesPorCobrar`,
// `inyeccionesAjustes`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { aplicarPendientes, buscarBitacoraDeAplicaciones, fetchAplicacionesPendientes } from '@nucleo/data/inyecciones';
import {
  CABECERA_CSV_BITACORA, CAMPOS_DE_BUSQUEDA_BITACORA, ESTADOS_BITACORA, agregarFiltroDeBitacora, diasDesde, filasCsvBitacora, filtrosEfectivosDeBitacora,
  gruposDePendientes, idsElegidos, quitarFiltroDeBitacora, resumenDePendientes, rotuloDeFiltroDeBitacora,
} from '@nucleo/utils/inyeccionesPendientes';
import { fmtMl } from '@nucleo/utils/inyeccionDosis';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import { correrMes, fechaNumerica, fechaTexto, hoySV, mesSV, rangoDelMes, sumarDias } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Fecha from '../componentes/formulario/Fecha';
import Tocable from '../componentes/Tocable';
import { compartirCsv } from '../componentes/fiscal/csv';
import PorCobrar, { periodosDePorCobrar } from '../componentes/inyecciones/PorCobrar';
import Ajustes from '../componentes/inyecciones/Ajustes';
import { guardar as dejar } from '../componentes/comercial/elegido';

const factura = (c) => String(c || '').replace(/^0+/, '');
const fechaCorta = (f) => fechaNumerica(String(f || '').slice(0, 10), { anio: false });

function Persona({ nombre, id, rol }) {
  if (!nombre) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Avatar empleado={{ id, name: nombre }} tamano={18} />
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{`${rol} ${shortEmployeeName({ name: nombre })}`}</Text>
    </View>
  );
}

function Contador({ valor, maximo, onCambiar }) {
  const boton = (texto, delta, apagado) => (
    <Pressable disabled={apagado} onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(valor + delta); }}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', opacity: apagado ? 0.3 : pressed ? 0.5 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {boton('−', -1, valor <= 0)}
      <Text style={{ color: valor ? MARCA.verde : colorSistema.texto2, fontSize: 17, fontWeight: '800', minWidth: 54, textAlign: 'center' }}>{`${valor} de ${maximo}`}</Text>
      {boton('+', 1, valor >= maximo)}
    </View>
  );
}

function Pendientes({ busqueda, salaPropia, salaFiltro, nombreSala, puedeAplicar }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [cuantas, setCuantas] = useState({});
  const [enviando, setEnviando] = useState(false);
  // Con la sala fija (quien sólo ve la suya) NO se filtra: el cliente puede
  // venir a aplicarse aquí aunque haya pagado en otra. Quien ve todas, elige.
  const cargar = useCallback(() => fetchAplicacionesPendientes({ buscar: busqueda, sala: salaPropia ? null : (salaFiltro || null) })
    .then((d) => { setFilas(d); setError(null); setCuantas({}); })
    .catch((e) => { setFilas([]); setError(mensajeAmigable(e, 'No se pudieron cargar las pendientes')); }), [busqueda, salaPropia, salaFiltro]);
  useEffect(() => { cargar(); }, [cargar]);
  const grupos = useMemo(() => gruposDePendientes(filas), [filas]);
  const elegidas = useMemo(() => idsElegidos(grupos, cuantas), [grupos, cuantas]);
  const r = useMemo(() => resumenDePendientes(filas, salaPropia), [filas, salaPropia]);

  const aplicar = async () => {
    setEnviando(true); trabajando('Marcando…');
    try {
      const n = await aplicarPendientes(elegidas, salaPropia || null);
      useStaffStore.getState().appendAuditLog('INYECCION_APLICADA', elegidas.join(','), { aplicaciones: n, desde: 'app' });
      listo(n === 1 ? 'Aplicación marcada' : `${n} aplicaciones marcadas`, 'Quedan como aplicadas por ti.');
    } catch (e) { fallo('No se pudieron marcar', mensajeAmigable(e)); }
    setEnviando(false);
    cargar();
  };

  if (filas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      <FilaDeKpis>
        <Kpi icono="Hourglass" rotulo="Por aplicar" valor={String(r.aplicaciones)} color={MARCA.azul} apoyo={`${formatMoney(r.total)} cobrados · ${r.clientes} clientes`} />
        <Kpi icono="AlertTriangle" rotulo="Con 7 días o más" valor={String(r.viejas)} color={r.viejas ? MARCA.ambar : MARCA.verde} apoyo="¿volvió el cliente?" />
      </FilaDeKpis>
      {salaPropia ? (
        <View style={{ marginHorizontal: 16 }}>
          <Aviso tono="nota" texto={`Se ven las de todas las sucursales: el cliente puede venir a aplicarse aquí aunque haya pagado en otra.${r.deOtras ? ` ${r.deOtras === 1 ? '1 es' : `${r.deOtras} son`} de otra sucursal.` : ''}`} />
        </View>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {puedeAplicar && elegidas.length ? (
        <View style={{ marginHorizontal: 16 }}>
          <BotonGrande texto={enviando ? 'Marcando…' : elegidas.length > 1 ? `Marcar ${elegidas.length} aplicadas` : 'Marcar aplicada'} color={MARCA.verde} deshabilitado={enviando} onPress={aplicar} />
        </View>
      ) : null}
      {grupos.map(({ clave, p, ids }) => {
        const dias = diasDesde(p.pagada_at);
        const otraSala = salaPropia && p.branch_id !== salaPropia;
        const historial = Array.isArray(p.historial) ? p.historial : [];
        return (
          <View key={clave} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={20} tinte={(cuantas[clave] || 0) ? 'rgba(18,183,106,0.12)' : undefined}>
              <View style={{ padding: 14, gap: 6 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{p.cliente || 'Sin nombre'}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{p.producto}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{ids.length}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{ids.length === 1 ? 'pendiente' : 'pendientes'}</Text>
                  </View>
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {[p.correlativo ? `Factura ${factura(p.correlativo)}` : 'Traída por el cliente', `pagada ${fechaCorta(p.pagada_at)}`, dias ? `hace ${dias} día${dias === 1 ? '' : 's'}` : 'hoy', formatMoney(p.precio)].join(' · ')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {otraSala ? <Pildora texto={`Pagada en ${nombreSala(p.branch_id)}`} color={MARCA.ambar} /> : null}
                  {p.venta_sala ? <Pildora texto={`Venta de ${p.venta_sala}`} color={MARCA.azulClaro} /> : null}
                  {p.dosis_ml != null ? <Pildora texto={`${fmtMl(p.dosis_ml)} ml por aplicación`} color={MARCA.azulClaro} /> : null}
                  {p.mezclada ? <Pildora texto="Mezcladas · una aplicación" color={MARCA.azulClaro} /> : null}
                  {dias >= 7 ? <Pildora texto={`${dias} días`} color={MARCA.ambar} /> : null}
                </View>
                <Persona nombre={p.cobrada_por} id={p.cobrada_por_id} rol="Cobró" />
                {historial.map((h, i) => (
                  <Text key={i} style={{ color: colorSistema.texto2, fontSize: 12 }}>
                    {`Aplicada ${fechaHora12(h.aplicada_at)}${h.aplicada_en ? ` en ${h.aplicada_en}` : ''}${h.aplicada_por ? ` · ${shortEmployeeName({ name: h.aplicada_por })}` : ''}`}
                  </Text>
                ))}
                {puedeAplicar ? (
                  <View style={{ alignItems: 'flex-end', marginTop: 4 }}>
                    <Contador valor={cuantas[clave] || 0} maximo={ids.length} onCambiar={(n) => setCuantas((c) => ({ ...c, [clave]: n }))} />
                  </View>
                ) : null}
              </View>
            </Vidrio>
          </View>
        );
      })}
      {!grupos.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
          {busqueda ? 'Nadie con ese dato tiene aplicaciones pendientes' : 'Ninguna pendiente: todo lo pagado ya se aplicó'}
        </Text>
      ) : null}
    </>
  );
}

// El período de la bitácora, como `[desde, hasta]`. Es el del COBRO: lo
// pagado en el rango, se haya aplicado o no (igual que el portal).
const PERIODOS_BITACORA = [
  { id: '30', label: 'Últimos 30 días' }, { id: 'hoy', label: 'Hoy' }, { id: '7', label: 'Últimos 7 días' },
  { id: 'mes', label: 'Este mes' }, { id: 'anterior', label: 'Mes anterior' }, { id: 'libre', label: 'Otras fechas' },
];
function rangoDeBitacora(periodo, libre) {
  const hoy = hoySV();
  if (periodo === 'hoy') return [hoy, hoy];
  if (periodo === '7') return [sumarDias(hoy, -6), hoy];
  if (periodo === 'mes') return [`${mesSV()}-01`, hoy];
  if (periodo === 'anterior') return rangoDelMes(correrMes(mesSV(), -1));
  if (periodo === 'libre') return libre.desde <= libre.hasta ? [libre.desde, libre.hasta] : [libre.hasta, libre.desde];
  return [sumarDias(hoy, -30), hoy];
}

// Buscar va más allá de los 30 días (pedido del usuario, 2026-10-17): con
// algún filtro y el período por defecto se busca en TODO el historial, por
// páginas que pide la base. Lo escrito se puede FIJAR como filtro de un campo
// —cliente, medicamento, vendedor, factura— y los fijados se suman.
const POR_PAGINA = 40;
function Bitacora({ busqueda, limpiarBusqueda, sala, periodo, libre, setLibre, estado, setEstado }) {
  const [res, setRes] = useState(null);
  const [mas, setMas] = useState(false);
  const [error, setError] = useState(null);
  const [fijados, setFijados] = useState([]);
  const filtros = useMemo(() => filtrosEfectivosDeBitacora(fijados, busqueda), [fijados, busqueda]);
  const { hasPermission } = useAuth();
  const puedeAsignarFicha = hasPermission('inyecciones_dosis');
  // Al volver de asignar la ficha se relee (no en la primera vez: ya cargó).
  const [vuelta, setVuelta] = useState(0);
  const primera = useRef(true);
  useFocusEffect(useCallback(() => { if (primera.current) primera.current = false; else setVuelta((v) => v + 1); }, []));
  const todoElHistorial = filtros.length > 0 && periodo === '30';
  const [desde, hasta] = todoElHistorial ? [null, null] : rangoDeBitacora(periodo, libre);
  const pedir = useCallback((offset) => buscarBitacoraDeAplicaciones({
    sala: sala || null, desde, hasta, filtros, estado, limite: POR_PAGINA, offset,
  }), [sala, desde, hasta, filtros, estado, vuelta]); // eslint-disable-line react-hooks/exhaustive-deps -- `vuelta` relee al volver
  useEffect(() => {
    let vivo = true;
    setRes(null);
    pedir(0)
      .then((d) => { if (vivo) { setRes(d); setError(null); } })
      .catch((e) => { if (vivo) { setRes({ filas: [], total: 0, aplicadas: 0, monto: 0, total_filtrado: 0 }); setError(mensajeAmigable(e, 'No se pudo cargar la bitácora')); } });
    return () => { vivo = false; };
  }, [pedir]);
  const filas = res?.filas || null;
  const visibles = filas || [];
  const totalFiltrado = res?.total_filtrado ?? 0;
  const verMas = async () => {
    setMas(true);
    try {
      const d = await pedir(visibles.length);
      setRes((r) => ({ ...r, filas: [...(r?.filas || []), ...(d.filas || [])] }));
    } catch (e) { fallo('No se pudo cargar', mensajeAmigable(e)); } finally { setMas(false); }
  };
  const aplicadas = res?.aplicadas ?? 0;
  const monto = res?.monto ?? 0;
  const alternar = (v) => setEstado((e) => (e === v ? 'todas' : v));
  const fijar = (campo) => { Haptics.selectionAsync().catch(() => {}); setFijados((f) => agregarFiltroDeBitacora(f, campo, busqueda)); limpiarBusqueda(); };
  const descargar = async () => {
    try {
      const d = await buscarBitacoraDeAplicaciones({ sala: sala || null, desde, hasta, filtros, estado, limite: 5000, offset: 0 });
      await compartirCsv({ headers: CABECERA_CSV_BITACORA, rows: filasCsvBitacora(d.filas), nombre: `aplicaciones_${desde || 'historial'}_${hasta || hoySV()}`, modulo: 'inyecciones' });
    } catch (e) { fallo('No se pudo compartir', e?.message || ''); }
  };
  return (
    <>
      {periodo === 'libre' ? (
        <View style={{ marginHorizontal: 16 }}>
          <Vidrio radio={18}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, gap: 8 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Del</Text>
              <Fecha valor={libre.desde} hasta={hoySV()} onCambiar={(v) => setLibre((l) => ({ ...l, desde: v }))} />
              <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>al</Text>
              <Fecha valor={libre.hasta} hasta={hoySV()} onCambiar={(v) => setLibre((l) => ({ ...l, hasta: v }))} />
            </View>
          </Vidrio>
        </View>
      ) : (
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>
          {desde === hasta ? fechaTexto(desde, { weekday: 'long', day: 'numeric', month: 'long' }) : `${fechaTexto(desde, { day: 'numeric', month: 'short' })} – ${fechaTexto(hasta, { day: 'numeric', month: 'short', year: 'numeric' })}`}
        </Text>
      )}
      {fijados.length || busqueda ? (
        <View style={{ marginHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {fijados.map((f, i) => (
            <Tocable key={`${f.campo}-${f.texto}`} accessibilityRole="button" accessibilityLabel={`Quitar ${rotuloDeFiltroDeBitacora(f)}`}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); setFijados((l) => quitarFiltroDeBitacora(l, i)); }}
              style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: `${MARCA.azulClaro}33` }}>
              <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{`${rotuloDeFiltroDeBitacora(f)}  ✕`}</Text>
            </Tocable>
          ))}
          {busqueda ? (
            <>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Fijar «${busqueda}» como`}</Text>
              {CAMPOS_DE_BUSQUEDA_BITACORA.filter((c) => c.id !== 'todo').map((c) => (
                <Tocable key={c.id} accessibilityRole="button" onPress={() => fijar(c.id)}
                  style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', borderWidth: 1, borderColor: `${MARCA.azulClaro}88` }}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{c.label}</Text>
                </Tocable>
              ))}
            </>
          ) : null}
        </View>
      ) : null}
      {/* Las tres tarjetas del portal, que también filtran: tocar Aplicadas o
          Pendientes deja sólo esas; tocarla otra vez, todas. */}
      <FilaDeKpis>
        <Kpi icono="ClipboardList" rotulo="Pagadas" valor={filas == null ? '—' : String(res.total)} color={MARCA.azul}
          apoyo={filas == null ? undefined : `${formatMoney(monto)} cobrados`} pide={estado === 'todas'} onPress={() => setEstado('todas')} />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="CheckCircle2" rotulo="Aplicadas" valor={filas == null ? '—' : String(aplicadas)} color={MARCA.verde}
          pide={estado === 'APLICADA'} onPress={() => alternar('APLICADA')} />
        <Kpi icono="Hourglass" rotulo="Pendientes" valor={filas == null ? '—' : String(res.total - aplicadas)} color={MARCA.ambar}
          pide={estado === 'PENDIENTE'} onPress={() => alternar('PENDIENTE')} />
      </FilaDeKpis>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {filas ? (
        <View style={{ marginHorizontal: 20, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>
            {`${totalFiltrado} aplicaci${totalFiltrado === 1 ? 'ón' : 'ones'}${todoElHistorial ? ` · todo el historial${res?.desde ? ` desde ${fechaTexto(res.desde, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}` : ''}`}
          </Text>
          {totalFiltrado ? (
            <Tocable onPress={descargar} hitSlop={8} accessibilityRole="button">
              <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Descargar CSV</Text>
            </Tocable>
          ) : null}
        </View>
      ) : null}
      {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((f) => (
        <View key={f.id} style={{ marginHorizontal: 16 }}>
          <Vidrio radio={18}>
            <View style={{ padding: 12, gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{f.cliente || 'Sin nombre'}</Text>
                <Pildora texto={f.estado === 'APLICADA' ? 'Aplicada' : 'Pendiente'} color={f.estado === 'APLICADA' ? MARCA.verde : MARCA.ambar} />
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{f.producto}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[f.correlativo ? `Factura ${factura(f.correlativo)}` : null, f.sala, formatMoney(f.precio), fechaHora12(f.cobrada_at)].filter(Boolean).join(' · ')}
              </Text>
              {f.venta_sala || f.asignada_a_mano || f.sin_ficha ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {f.venta_sala ? <Pildora texto={`Venta de ${f.venta_sala}`} color={MARCA.azulClaro} /> : null}
                  {f.asignada_a_mano ? <Pildora texto="Asignada después" color="#8E8E93" /> : null}
                  {f.sin_ficha ? <Pildora texto="Sin ficha · no sale en su app" color={MARCA.ambar} /> : null}
                </View>
              ) : null}
              <Persona nombre={f.cobrada_por} id={f.cobrada_por_id} rol="Cobró" />
              {f.vendedor && f.vendedor_id !== f.cobrada_por_id ? <Persona nombre={f.vendedor} id={f.vendedor_id} rol="Vendió" /> : null}
              {f.estado === 'APLICADA' ? <Persona nombre={f.aplicada_por} id={f.aplicada_por_id} rol={`Aplicó${f.aplicada_en ? ` en ${f.aplicada_en}` : ''} ·`} /> : null}
              {f.sin_ficha && puedeAsignarFicha ? (
                <Tocable accessibilityRole="button" hitSlop={6}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); dejar('inyeccion-ficha', f); router.push('/inyeccion-ficha'); }}
                  style={{ alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: `${MARCA.azul}2E`, marginTop: 4 }}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>Asignar a un cliente</Text>
                </Tocable>
              ) : null}
            </View>
          </Vidrio>
        </View>
      ))}
      {filas && totalFiltrado > visibles.length ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={mas ? 'Cargando…' : `Ver más · quedan ${totalFiltrado - visibles.length}`} borde deshabilitado={mas} onPress={verMas} /></View> : null}
      {filas && !visibles.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{filtros.length ? 'Ninguna aplicación cumple esos filtros' : 'Sin aplicaciones en el período'}</Text>
      ) : null}
    </>
  );
}

export default function Inyecciones() {
  const { user, hasPermission, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const puedeDosis = hasPermission('inyecciones_dosis');
  const puedePrecio = hasPermission('inyecciones_precios');
  const pestanas = useMemo(() => [
    hasPermission('inyecciones_tab_por_cobrar') && { id: 'por-cobrar', label: 'Por cobrar' },
    hasPermission('inyecciones_tab_pendientes') && { id: 'pendientes', label: 'Pendientes' },
    hasPermission('inyecciones_tab_bitacora') && { id: 'bitacora', label: 'Bitácora' },
    (hasPermission('inyecciones_dosis') || hasPermission('inyecciones_precios')) && { id: 'ajustes', label: 'Ajustes' },
  ].filter(Boolean), [hasPermission]);
  const [elegida, setPestana] = useState(null);
  const pestana = elegida && pestanas.some((p) => p.id === elegida) ? elegida : pestanas[0]?.id;
  const salaPropia = getScope?.('inyecciones') !== 'ALL' ? Number(user?.branchId) || null : null;
  const nombreSala = (id) => (sucursales || []).find((b) => b.id === id)?.name || '—';
  const [texto, setTexto] = useState('');
  // Para vaciar la barra al fijar lo escrito como filtro de la bitácora.
  const barraRef = useRef(null);
  const limpiarBusqueda = useCallback(() => { barraRef.current?.clearText?.(); setTexto(''); }, []);
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [llave, setLlave] = useState(0);
  const [recargando, setRecargando] = useState(false);
  // Por cobrar: período y sala propios (el portal también los separa del resto).
  const periodos = useMemo(() => periodosDePorCobrar(), []);
  const [rango, setRango] = useState(periodos[0].id);
  const [salaFiltro, setSalaFiltro] = useState('todas');
  const salaPorCobrar = salaPropia || (salaFiltro === 'todas' ? null : Number(salaFiltro));
  // Bitácora: período (el del cobro), fechas libres y estado.
  const [periodoBit, setPeriodoBit] = useState('30');
  const [libreBit, setLibreBit] = useState(() => ({ desde: sumarDias(hoySV(), -30), hasta: hoySV() }));
  const [estadoBit, setEstadoBit] = useState('todas');
  const grupoSala = salaPropia ? [] : [{ id: 'sala', titulo: 'Sucursal', activa: salaFiltro, porDefecto: 'todas', onCambiar: setSalaFiltro,
    opciones: [{ id: 'todas', label: 'Todas las salas' }, ...(sucursales || []).map((b) => ({ id: String(b.id), label: b.name }))] }];
  const grupos = pestana === 'por-cobrar' ? [
    { id: 'periodo', titulo: 'Período', activa: rango, porDefecto: periodos[0].id, onCambiar: setRango, opciones: periodos },
    ...grupoSala,
  ] : pestana === 'bitacora' ? [
    { id: 'periodo', titulo: 'Período', activa: periodoBit, porDefecto: '30', onCambiar: setPeriodoBit, opciones: PERIODOS_BITACORA },
    { id: 'estado', titulo: 'Estado', activa: estadoBit, porDefecto: 'todas', onCambiar: setEstadoBit, opciones: ESTADOS_BITACORA.map((e) => ({ id: e.value, label: e.label })) },
    ...grupoSala,
  ] : pestana === 'pendientes' ? grupoSala : [];
  // Al volver de asignar un cobro o de guardar por ml, se relee.
  const [vuelta, setVuelta] = useState(0);
  useFocusEffect(useCallback(() => { setVuelta((v) => v + 1); }, []));

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Inyecciones', headerLargeTitle: true,
        headerSearchBarOptions: {
          ref: barraRef, placeholder: 'Cliente, vendedor, factura o inyección', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={() => { setRecargando(true); setLlave((k) => k + 1); setTimeout(() => setRecargando(false), 600); }} />}>
        {pestanas.length > 1 ? <Segmentos activa={pestana} onCambiar={setPestana} opciones={pestanas} /> : null}
        <FiltrosActivos grupos={grupos} />
        {!pestana ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto="Tu cargo no tiene acceso a las inyecciones." /></View>
          : pestana === 'por-cobrar'
            ? <PorCobrar busqueda={busqueda} sala={salaPorCobrar} nombreSala={nombreSala} puedeAsignar={puedeDosis} rango={rango} recarga={`${llave}-${vuelta}`} />
            : pestana === 'ajustes'
              ? <Ajustes puedePrecio={puedePrecio} puedeDosis={puedeDosis} recarga={`${llave}-${vuelta}`} />
              : pestana === 'pendientes'
                ? <Pendientes key={llave} busqueda={busqueda} salaPropia={salaPropia} salaFiltro={salaFiltro === 'todas' ? null : Number(salaFiltro)} nombreSala={nombreSala} puedeAplicar={hasPermission('caja_vales', 'can_edit')} />
                : <Bitacora key={llave} busqueda={busqueda} limpiarBusqueda={limpiarBusqueda} sala={salaPorCobrar}
                  periodo={periodoBit} libre={libreBit} setLibre={setLibreBit} estado={estadoBit} setEstado={setEstadoBit} />}
      </ScrollView>
    </>
  );
}
