// Movimientos de caja, NATIVO — la pestaña «Movimientos» de Efectivo del portal
// (`MovimientosDeCaja`): todo lo que entró y salió de las cajas en el período —
// los movimientos del sistema de la caja, los cobros de crédito del portal y
// las salidas pagadas con una bolsa— en una sola lista, la más reciente arriba.
//
// Lo que esta lista existe para mostrar es lo que está MAL: un movimiento que
// alguien editó después de guardarlo, o que desapareció de la caja (la fila se
// queda: es lo único que queda de él). La lista y el filtro salen del núcleo
// (`renglonesDeMovimientos`, `filtrarMovimientos`), los mismos del portal.
//
// Como el portal, además: período libre («Fechas…»), los totales «Entró» y
// «Salió» (sin los que ya no están en la caja; tocarlos filtra), y en cada
// renglón anotado desde el portal, quién lo anotó, su hora exacta, su concepto
// completo y la boleta (`fetchAnotadosDelPortal`).
//
// Un cobro de crédito que el cliente pagó solo, desde su app y con tarjeta
// (Wompi, 2026-10-20; `pagadoEnLaApp`, núcleo), sale marcado y sin «quién lo
// cobró»: el dinero está en la cuenta de Wompi, no en el cajón.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchHistorialDeMovimientos, fetchMovimientosDeCaja, fetchPersonas } from '@nucleo/data/cortes';
import { fetchCobrosDelPortal, pagadoEnLaApp } from '@nucleo/data/creditos';
import { fetchAnotadosDelPortal, fetchSalidasDeBolsaDelRango, fetchTiposDeSalida } from '@nucleo/data/bolsas';
import RangoDeFechas from '../componentes/formulario/RangoDeFechas';
import { filtrarMovimientos, fueEditado, historiaPorMovimiento, renglonesDeMovimientos } from '@nucleo/utils/movimientosDeCaja';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { ordenDeSala } from '@nucleo/constants/erp';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { useMasAlFinal } from '../componentes/ListaPaginada';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const POR_PAGINA = 40;
const PERIODOS = [{ id: '0', label: 'Hoy' }, { id: '1', label: 'Ayer' }, { id: '7', label: 'Últimos 7 días' }, { id: 'rango', label: 'Fechas…' }];
const rango = (p, hoy = hoySV(), libre = null) => (p === 'rango' && libre ? [libre.desde, libre.hasta] : p === '0' ? [hoy, hoy] : p === '1' ? [sumarDias(hoy, -1), sumarDias(hoy, -1)] : [sumarDias(hoy, -6), hoy]);
const sinFolioDelPortal = (t) => String(t || '').replace(/^P\d+\s+/, '');
const horaDeIso = (iso) => (iso ? hora12(iso) : null);

function Renglon({ titulo, detalle, monto, entra, tachado, pildoras = [], quien, sala }) {
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={18}>
        <View style={{ flexDirection: 'row', gap: 12, padding: 13 }}>
          <View style={{ width: 4, borderRadius: 2, backgroundColor: tachado ? MARCA.rojo : entra ? MARCA.verde : MARCA.ambar }} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: tachado ? colorSistema.texto2 : colorSistema.texto, fontSize: 15, fontWeight: '600', textDecorationLine: tachado ? 'line-through' : 'none' }}>{titulo}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[sala, detalle].filter(Boolean).join(' · ')}</Text>
            {pildoras.length ? <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{pildoras.map(([t, c]) => <Pildora key={t} texto={t} color={c} />)}</View> : null}
            {quien ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Avatar empleado={quien} tamano={18} />
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{shortEmployeeName(quien)}</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: tachado ? MARCA.rojo : entra ? MARCA.verde : colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'],
            textDecorationLine: tachado ? 'line-through' : 'none' }}>
            {`${entra ? '+' : '−'}${formatMoney(Math.abs(Number(monto) || 0))}`}
          </Text>
        </View>
      </Vidrio>
    </View>
  );
}

export default function CajaMovimientos() {
  const { user, getScope, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const todas = getScope?.('cortes_caja') === 'ALL';
  const puedeVerBolsas = hasPermission('bolsas', 'can_view');
  const miSala = String(user?.branchId ?? user?.branch_id ?? '');
  const [periodo, setPeriodo] = useState('0');
  const [libre, setLibre] = useState(() => ({ desde: sumarDias(hoySV(), -6), hasta: hoySV() }));
  const [salaElegida, setSala] = useState('todas');
  const [tipo, setTipo] = useState('TODOS');
  const [estado, setEstado] = useState('TODOS');
  const [texto, setTexto] = useState('');
  const [datos, setDatos] = useState(null);
  const [personas, setPersonas] = useState(new Map());
  const [tiposDeSalida, setTiposDeSalida] = useState([]);
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  // La página siguiente se pinta sola al acercarse al final (el botón queda de respaldo).
  const alFinal = useMasAlFinal(() => setCuantos((n) => n + POR_PAGINA));
  const [recargando, setRecargando] = useState(false);
  const sala = todas ? (salaElegida === 'todas' ? null : salaElegida) : miSala;
  const [desde, hasta] = useMemo(() => rango(periodo, hoySV(), libre), [periodo, libre]);

  useEffect(() => { fetchTiposDeSalida().then((t) => setTiposDeSalida(t || [])).catch(() => {}); }, []);
  const cargar = useCallback(async () => {
    const [movimientos, historial, cobros, salidas, anotados] = await Promise.all([
      fetchMovimientosDeCaja({ desde, hasta, branchId: sala }),
      fetchHistorialDeMovimientos({ desde, hasta, branchId: sala }),
      fetchCobrosDelPortal({ desde, hasta, branchId: sala }),
      puedeVerBolsas ? fetchSalidasDeBolsaDelRango({ desde, hasta, branchId: sala }) : Promise.resolve([]),
      Promise.resolve(fetchAnotadosDelPortal({ desde, hasta, branchId: sala })).catch(() => []),
    ]).catch(() => [null, [], [], [], []]);
    setDatos(movimientos ? { movimientos, historial: historial || [], cobros: cobros || [], salidas: salidas || [], anotados: anotados || [] } : { error: true });
    setCuantos(POR_PAGINA);
    const quienes = await fetchPersonas([...(cobros || []).map((c) => c.abonado_por), ...(salidas || []).map((o) => o.registrado_por), ...(anotados || []).map((a) => a.registrado_por)]).catch(() => []);
    setPersonas(new Map((quienes || []).map((q) => [q.id, q])));
  }, [desde, hasta, sala, puedeVerBolsas]);
  useEffect(() => { cargar(); }, [cargar]);

  const nombreDeSala = useMemo(() => new Map((sucursales || []).map((b) => [b.id, b.name])), [sucursales]);
  const porMov = useMemo(() => historiaPorMovimiento(datos?.historial), [datos]);
  const renglones = useMemo(() => (datos?.movimientos ? renglonesDeMovimientos({ movimientos: datos.movimientos, cobros: datos.cobros, salidasDeBolsa: datos.salidas, anotados: datos.anotados }) : []), [datos]);
  const etiquetaDeSalida = useCallback((c) => tiposDeSalida.find((t) => t.codigo === c)?.etiqueta || c || 'Salida', [tiposDeSalida]);
  const visibles = useMemo(() => filtrarMovimientos(renglones, {
    tipo, estado, busqueda: texto, salas: nombreDeSala, cobraron: personas, sacaron: personas, etiquetaDeSalida, porMov,
  }), [renglones, tipo, estado, texto, nombreDeSala, personas, etiquetaDeSalida, porMov]);
  const cuenta = useMemo(() => {
    const movs = datos?.movimientos || [];
    // «Entró» y «Salió» como el portal (`resumenMovs`): lo que ya no está en la caja no suma.
    const vivos = movs.filter((m) => !m.desaparecido_at);
    return {
      editados: movs.filter((m) => fueEditado(porMov, m)).length,
      borrados: movs.filter((m) => m.desaparecido_at).length,
      entradas: vivos.filter((m) => m.tipo === 'ENTRADA').reduce((a, m) => a + (Number(m.monto) || 0), 0),
      salidas: vivos.filter((m) => m.tipo !== 'ENTRADA').reduce((a, m) => a + (Number(m.monto) || 0), 0),
    };
  }, [datos, porMov]);

  const salas = useMemo(() => [...(sucursales || [])].filter((b) => b.name !== 'Administracion')
    .sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const grupos = [
    { id: 'periodo', titulo: 'Período', activa: periodo, porDefecto: '0', onCambiar: setPeriodo, opciones: PERIODOS },
    { id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'TODOS', onCambiar: setEstado,
      opciones: [{ id: 'TODOS', label: 'Todos' }, { id: 'VIGENTES', label: 'Vigentes' }, { id: 'EDITADOS', label: 'Editados' }, { id: 'DESAPARECIDOS', label: 'Ya no están en la caja' }] },
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'todas', onCambiar: setSala,
      opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas.map((b) => ({ id: String(b.id), label: b.name }))] }] : []),
  ];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Movimientos', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Concepto, cliente, monto o quién', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView {...alFinal} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {periodo === 'rango' ? <RangoDeFechas desde={libre.desde} hasta={libre.hasta} onCambiar={setLibre} /> : null}
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>
          {desde === hasta ? fechaTexto(desde, { weekday: 'long', day: 'numeric', month: 'long' }) : `${fechaTexto(desde, { day: 'numeric', month: 'short' })} – ${fechaTexto(hasta, { day: 'numeric', month: 'short' })}`}
        </Text>
        {datos && !datos.error ? (
          <FilaDeKpis>
            <Kpi icono="TrendingUp" rotulo="Entró" valor={formatMoney(cuenta.entradas)} color={MARCA.verde} pide={tipo === 'ENTRADA'}
              apoyo="a las cajas" onPress={() => setTipo((t) => (t === 'ENTRADA' ? 'TODOS' : 'ENTRADA'))} />
            <Kpi icono="TrendingDown" rotulo="Salió" valor={formatMoney(cuenta.salidas)} color={MARCA.ambar} pide={tipo === 'SALIDA'}
              apoyo="de las cajas" onPress={() => setTipo((t) => (t === 'SALIDA' ? 'TODOS' : 'SALIDA'))} />
          </FilaDeKpis>
        ) : null}
        {datos && !datos.error ? (
          <FilaDeKpis>
            <Kpi icono="PenLine" rotulo="Editados" valor={String(cuenta.editados)} color={cuenta.editados ? MARCA.ambar : MARCA.azul}
              apoyo="después de guardarse" onPress={cuenta.editados ? () => setEstado('EDITADOS') : undefined} />
            <Kpi icono="Ban" rotulo="Ya no están" valor={String(cuenta.borrados)} color={cuenta.borrados ? MARCA.rojo : MARCA.azul}
              apoyo="en la caja" onPress={cuenta.borrados ? () => setEstado('DESAPARECIDOS') : undefined} />
          </FilaDeKpis>
        ) : null}
        <Segmentos activa={tipo} onCambiar={setTipo}
          opciones={[{ id: 'TODOS', label: 'Todos' }, { id: 'ENTRADA', label: 'Entradas' }, { id: 'SALIDA', label: 'Salidas' }]} />
        {datos?.error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto="No se pudieron leer los movimientos." /></View> : null}
        {!datos ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.slice(0, cuantos).map((it) => {
          const salaTxt = sala ? null : nombreDeSala.get(it.branchId);
          if (it.kind === 'cobro') {
            const c = it.cb;
            const app = pagadoEnLaApp(c);
            return (
              <Renglon key={it.clave} entra tachado={!!c.anulado_at} sala={salaTxt} monto={c.monto}
                titulo={`Cobro de crédito · ${c.cliente || 'Sin nombre'}`}
                detalle={[`crédito ${c.credito_erp}`, app ? 'tarjeta en la app (Wompi), no en el cajón' : String(c.forma || '').toLowerCase(), horaDeIso(c.created_at),
                  Number(c.saldo_despues) > 0.004 ? `queda ${formatMoney(c.saldo_despues)}` : 'saldado'].filter(Boolean).join(' · ')}
                pildoras={[app ? ['Pagado en la app', MARCA.azulClaro] : ['Del portal', MARCA.azulClaro], ...(c.anulado_at ? [['Anulado', MARCA.rojo]] : [])]}
                quien={app ? null : personas.get(c.abonado_por)} />
            );
          }
          if (it.kind === 'portal') {
            // Cobrado con tarjeta o transferencia (2026-10-20): no entra al cajón.
            const a = it.an;
            const forma = a.forma_pago === 'TARJETA' ? 'Tarjeta' : 'Transferencia';
            return (
              <Renglon key={it.clave} entra tachado={!!a.anulado_at} sala={salaTxt} monto={a.monto}
                titulo={a.detalle || a.concepto || 'Ingreso'}
                detalle={[forma, a.numero_boleta ? `voucher ${a.numero_boleta}` : null, horaDeIso(a.registrado_at)].filter(Boolean).join(' · ')}
                pildoras={[['No entra al cajón', MARCA.azulClaro],
                  ...(a.autorizacion === 'PENDIENTE' ? [['Pendiente de autorización', MARCA.ambar]] : []),
                  ...(a.anulado_at ? [['Anulado', MARCA.rojo]] : [])]}
                quien={personas.get(a.registrado_por)} />
            );
          }
          if (it.kind === 'bolsa') {
            const op = it.op;
            return (
              <Renglon key={it.clave} entra={false} tachado={!!op.anulada_at} sala={salaTxt} monto={op.montoSinVale ?? op.monto}
                titulo={`${etiquetaDeSalida(op.tipo)}${op.entidad ? ` · ${op.entidad}` : ''}`}
                detalle={[op.folio, horaDeIso(op.registrado_at)].filter(Boolean).join(' · ')}
                pildoras={[['De una bolsa', MARCA.violeta]]} quien={personas.get(op.registrado_por)} />
            );
          }
          const m = it.mv;
          const an = it.anotado;
          const editado = fueEditado(porMov, m);
          return (
            <Renglon key={it.clave} entra={m.tipo === 'ENTRADA'} tachado={!!m.desaparecido_at} sala={salaTxt} monto={m.monto}
              titulo={an?.detalle || an?.concepto || sinFolioDelPortal(m.concepto) || (m.tipo === 'ENTRADA' ? 'Entrada' : 'Salida')}
              detalle={[fechaTexto(m.fecha, { day: 'numeric', month: 'short' }), horaDeIso(an?.registrado_at || m.created_at), an?.numero_boleta ? `boleta ${an.numero_boleta}` : null].filter(Boolean).join(' · ')}
              quien={an ? personas.get(an.registrado_por) : null}
              pildoras={[
                ...(an ? [['Anotado desde el portal', MARCA.azulClaro]] : []),
                ...(an?.monto_origen === 'FOTO_SIN_CONFIRMAR' ? [['Leído de la boleta, sin confirmar', MARCA.ambar]] : an?.monto_origen === 'A_MANO' ? [['Monto escrito a mano', MARCA.ambar]] : []),
                ...(m.desaparecido_at ? [['Ya no está en la caja', MARCA.rojo]] : []),
                ...(editado ? [['Editado', MARCA.ambar]] : []),
                ...(it.cobro ? [[`Cobro · ${it.cobro.cliente || ''}`.trim(), MARCA.azulClaro]] : []),
              ]} />
          );
        })}
        {datos && visibles.length > cuantos ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setCuantos((n) => n + POR_PAGINA)} /></View> : null}
        {datos && !datos.error && !visibles.length ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
            {texto ? 'Nada con esa búsqueda' : 'Sin movimientos en este período'}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}
