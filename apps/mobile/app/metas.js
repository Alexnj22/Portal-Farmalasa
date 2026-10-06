// Metas, NATIVO — `MetasView` del portal, en tres pestañas:
//
//   · Tablero: la meta del mes, lo vendido, la proyección y el semáforo; una
//     tarjeta por sala (con de qué está hecha la meta cuando trae gastos) y,
//     en el mes en curso, «Cómo va el mes» con la gráfica día por día o el
//     termómetro y el ranking de vendedores. Tocar una sala abre su detalle
//     (`meta-sala/[id]`).
//   · Bono: el reparto de una sala en un mes, de lectura.
//   · Histórico: cada mes con su cumplimiento y sus dos gráficas.
//
// Las cuentas salen del núcleo (`metasUtils`), las mismas del portal. Agregar
// una meta (`meta-nueva`) y la Confirmación (ajustar, confirmar, aprobar,
// devolver, registrar la autorización) son nativas. Pago semestral y gastos
// siguen en el portal.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchBonoActivo, fetchMesEnCurso, fetchMetasConfig, fetchMetasDashboard, fetchMetasRows } from '@nucleo/data/metas';
import { SALAS_VENTA, YM_INICIO_HISTORIA, resumenDeMetas, tramoLabel, ymHoySV, ymLabel, ymSumar } from '@nucleo/utils/metasUtils';
import { formatMoney, formatPct } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { COLOR_TRAMO, GraficaDelMes, Ranking } from '../componentes/metas/Mes';
import { Termometro } from '../componentes/metas/Graficas';
import Bono from '../componentes/metas/Bono';
import Historico from '../componentes/metas/Historico';
import PasoYm from '../componentes/metas/PasoYm';
import Confirmacion from '../componentes/metas/Confirmacion';

function Tablero({ ym, setYm, sala, todas, user, salaNombre }) {
  const ymActual = ymHoySV();
  const [rows, setRows] = useState(null);
  const [desglose, setDesglose] = useState({});
  const [bono, setBono] = useState(false);
  const [mes, setMes] = useState(undefined);
  const [error, setError] = useState(null);
  const esActual = ym === ymActual;
  const cerrado = ym < ymActual;

  const cargar = useCallback(async () => {
    try {
      const [d, filas, b] = await Promise.all([fetchMetasDashboard(ym), fetchMetasRows([ym]).catch(() => []), fetchBonoActivo(ym).catch(() => null)]);
      setRows(todas ? d : (d || []).filter((r) => String(r.branch_id) === String(user?.branchId)));
      if (b !== null) setBono(b);
      const x = {};
      for (const f of filas) if (Number(f.monto_recuperacion) > 0) x[f.branch_id] = { base: Number(f.monto_base), recuperacion: Number(f.monto_recuperacion) };
      setDesglose(x);
      setError(null);
    } catch (e) { setError(mensajeAmigable(e, 'Error al cargar las metas')); setRows([]); }
  }, [ym, todas, user?.branchId]);
  useEffect(() => { setRows(null); cargar(); }, [cargar]);
  useEffect(() => {
    if (!esActual) { setMes(undefined); return undefined; }
    let vivo = true;
    setMes(undefined);
    fetchMesEnCurso(sala || (todas ? null : user?.branchId) || null)
      .then((d) => { if (vivo) setMes(d); }).catch(() => { if (vivo) setMes(null); });
    return () => { vivo = false; };
  }, [esActual, sala, todas, user?.branchId]);

  const visibles = useMemo(() => (rows || []).filter((r) => !sala || String(r.branch_id) === String(sala)), [rows, sala]);
  const r = useMemo(() => resumenDeMetas(rows || []), [rows]);

  return (
    <>
      <PasoYm ym={ym} onCambiar={setYm} min={YM_INICIO_HISTORIA} max={ymSumar(ymActual, 1)} actual={ymActual} />
      {esActual && rows?.[0] ? <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center' }}>{`Día ${rows[0].dias_transcurridos} de ${rows[0].dias_mes}`}</Text> : null}
      {rows ? (
        <>
          <FilaDeKpis>
            <Kpi icono="Target" rotulo="Meta del mes" valor={r.meta > 0 ? formatMoney(r.meta) : '—'} color={MARCA.azul}
              apoyo={r.conMeta > 0 ? `${r.conMeta} sala${r.conMeta === 1 ? '' : 's'} con meta` : 'sin metas este mes'} />
            <Kpi icono="TrendingUp" rotulo="Vendido" valor={formatMoney(r.vendidoConMeta)} color={MARCA.verde}
              apoyo={r.meta > 0 ? `${formatPct(r.vendidoConMeta / r.meta * 100)} de la meta` : cerrado ? 'en el mes' : 'salas con meta'} />
          </FilaDeKpis>
          <FilaDeKpis>
            {esActual ? (
              <Kpi icono="Gauge" rotulo="Proyección" valor={r.meta > 0 ? formatMoney(r.proy) : '—'} color={MARCA.azulClaro}
                apoyo={r.meta > 0 ? `${formatPct(r.proy / r.meta * 100)} de la meta` : 'al cierre del mes'} />
            ) : null}
            <Kpi icono="BarChart2" rotulo="Semáforo" valor={r.conMeta ? `${r.tiers.completo} · ${r.tiers.medio} · ${r.tiers.nada}` : '—'} color={MARCA.violeta}
              apoyo={r.sinMeta > 0 ? `+${r.sinMeta} sin meta` : 'completo · medio · nada'} />
          </FilaDeKpis>
        </>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {rows == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((f) => {
        const sinMeta = f.monto_meta == null;
        const color = COLOR_TRAMO[f.bono_tier] ?? MARCA.azul;
        const des = desglose[f.branch_id];
        return (
          <Pressable key={f.branch_id} disabled={!esActual}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/meta-sala/[id]', params: { id: String(f.branch_id), ym } }); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={20} interactivo={esActual}>
              <View style={{ padding: 14, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{salaNombre(f.branch_id)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{sinMeta ? `Vendido ${cerrado ? 'en el mes' : 'este mes'} ${formatMoney(f.venta_acumulada)}` : `Meta ${formatMoney(f.monto_meta)}`}</Text>
                    {!sinMeta && des ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${formatMoney(des.base)} de venta + ${formatMoney(des.recuperacion)} por gastos`}</Text> : null}
                  </View>
                  {sinMeta ? <Pildora texto="Sin meta asignada" color={colorSistema.texto2} />
                    : f.estado !== 'oficial' ? <Pildora texto="Pendiente de aprobar" color={MARCA.ambar} />
                      : f.bono_tier ? <Pildora texto={tramoLabel(f.bono_tier, bono)} color={color} /> : null}
                  {esActual ? <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text> : null}
                </View>
                {sinMeta ? (
                  <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Sin meta para ${ymLabel(ym).toLowerCase()}`}</Text>
                ) : (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800' }}>{formatMoney(f.venta_acumulada)}</Text>
                      <Text style={{ color, fontSize: 15, fontWeight: '800' }}>{formatPct(f.pct_cumplimiento)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>vendido</Text>
                    </View>
                    <Termometro pct={f.pct_cumplimiento} pctProyectado={cerrado ? null : f.pct_proyectado} color={color} />
                    {!cerrado && f.proyeccion != null ? (
                      <Text style={{ color: colorSistema.texto, fontSize: 13 }}>
                        Cierra en <Text style={{ fontWeight: '800' }}>{formatMoney(f.proyeccion)}</Text>{' → '}<Text style={{ fontWeight: '800', color }}>{formatPct(f.pct_proyectado)}</Text>
                        <Text style={{ color: colorSistema.texto2 }}>
                          {f.bono_tier === 'medio' ? ` · le faltan ${formatMoney(Math.max(0, f.monto_meta - f.proyeccion))} para el 100%` : f.bono_tier === 'nada' ? ` · le faltan ${formatMoney(Math.max(0, f.monto_meta * 0.95 - f.proyeccion))} para el 95%` : ''}
                        </Text>
                      </Text>
                    ) : null}
                    {cerrado ? <Text style={{ color: colorSistema.texto, fontSize: 13 }}>Cerró en <Text style={{ fontWeight: '800', color }}>{formatPct(f.pct_cumplimiento)}</Text> de la meta</Text> : null}
                  </>
                )}
              </View>
            </Vidrio>
          </Pressable>
        );
      })}
      {rows && !visibles.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 30 }}>Sin salas para este mes</Text>
      ) : null}
      {esActual ? (
        <View style={{ gap: 10, marginTop: 6 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800', marginHorizontal: 20 }}>{`Cómo va ${ymLabel(ym).toLowerCase()}`}</Text>
          {mes === undefined ? <ActivityIndicator /> : mes ? (
            <View style={{ marginHorizontal: 16, gap: 10 }}>
              <GraficaDelMes data={mes} />
              <Ranking data={mes} />
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

export default function Metas() {
  const { getScope, hasPermission, user } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const ymActual = ymHoySV();
  const todas = getScope?.('metas') === 'ALL';
  const [pestana, setPestana] = useState('tablero');
  const [ym, setYm] = useState(ymActual);
  const [ymBono, setYmBono] = useState(ymActual);
  const propia = SALAS_VENTA.includes(Number(user?.branchId)) ? String(user?.branchId) : String(SALAS_VENTA[0]);
  const [sala, setSala] = useState('todas');
  const [salaBono, setSalaBono] = useState(propia);
  const [conMeta, setConMeta] = useState('todos');
  const [config, setConfig] = useState(null);
  const [llave, setLlave] = useState(0);
  const [recargando, setRecargando] = useState(false);
  useEffect(() => { fetchMetasConfig().then(setConfig).catch(() => setConfig(null)); }, [llave]);
  // Al volver de agregar una meta, lo que se ve se relee (no en la primera vez).
  const primeraVez = useRef(true);
  useFocusEffect(useCallback(() => {
    if (primeraVez.current) { primeraVez.current = false; return; }
    setLlave((k) => k + 1);
  }, []));

  const salaNombre = useCallback((id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? `Sala ${id}`, [sucursales]);
  const opcionesSala = useMemo(() => SALAS_VENTA.map((id) => ({ id: String(id), label: salaNombre(id) })).sort((a, b) => a.label.localeCompare(b.label)), [salaNombre]);
  const salasVisibles = useMemo(() => (todas ? null : new Set([String(user?.branchId)])), [todas, user?.branchId]);

  const grupoSala = { id: 'sala', titulo: 'Sala', opciones: [{ id: 'todas', label: 'Todas las salas' }, ...opcionesSala], activa: sala, porDefecto: 'todas', onCambiar: setSala };
  const grupos = pestana === 'tablero' ? (todas ? [grupoSala] : [])
    : pestana === 'bono' ? (todas ? [{ id: 'sala', titulo: 'Sala', opciones: opcionesSala, activa: salaBono, porDefecto: propia, onCambiar: setSalaBono }] : [])
      : [
        ...(todas ? [grupoSala] : []),
        { id: 'meses', titulo: 'Qué meses', opciones: [{ id: 'todos', label: 'Todos los meses' }, { id: 'con_meta', label: 'Solo con meta' }], activa: conMeta, porDefecto: 'todos', onCambiar: setConMeta },
      ];
  const puedeEditar = hasPermission('metas', 'can_edit');
  const puedeAprobar = hasPermission('metas', 'can_approve');
  const editar = puedeEditar || puedeAprobar;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Metas', headerLargeTitle: true }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={() => { setRecargando(true); setLlave((k) => k + 1); setTimeout(() => setRecargando(false), 600); }} />}>
        <Segmentos activa={pestana} onCambiar={setPestana} opciones={[
          { id: 'tablero', label: 'Tablero' }, { id: 'bono', label: 'Bono' },
          ...(editar ? [{ id: 'confirmacion', label: 'Confirmación' }] : []),
          { id: 'historico', label: 'Histórico' },
        ]} />
        <FiltrosActivos grupos={grupos} />
        {pestana === 'tablero' ? (
          <Tablero key={llave} ym={ym} setYm={setYm} sala={sala === 'todas' ? null : sala} todas={todas} user={user} salaNombre={salaNombre} />
        ) : pestana === 'bono' ? (
          <>
            <PasoYm ym={ymBono} onCambiar={setYmBono} min={YM_INICIO_HISTORIA} max={ymActual} actual={ymActual} />
            <Bono key={llave} sala={todas ? salaBono : String(user?.branchId)} salaNombre={salaNombre} ym={ymBono} esMesActual={ymBono === ymActual} config={config} />
          </>
        ) : pestana === 'confirmacion' ? (
          <Confirmacion key={llave} salaNombre={salaNombre} canEdit={puedeEditar} canApprove={puedeAprobar} onCambio={() => setLlave((k) => k + 1)} />
        ) : (
          <Historico key={llave} sala={sala === 'todas' ? null : sala} soloConMeta={conMeta === 'con_meta'} salaNombre={salaNombre} salasVisibles={salasVisibles} />
        )}
        {puedeEditar ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <BotonGrande texto="Agregar meta" onPress={() => router.push({ pathname: '/meta-nueva', params: { ym: pestana === 'tablero' ? ym : ymActual, sala: sala === 'todas' ? '' : sala } })} />
          </View>
        ) : null}
        {editar ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto="Pago semestral y gastos (portal)" borde color={MARCA.azulClaro}
              onPress={() => router.push({ pathname: '/portal', params: { ruta: '/metas', nombre: 'Metas' } })} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
