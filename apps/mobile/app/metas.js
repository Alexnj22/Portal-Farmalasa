// Metas, NATIVO — el tablero de supervisión (`MetasView` › Tablero): la meta
// de cada sala en el mes, cuánto lleva, la proyección al cierre y en qué tramo
// va. La sala ve SU meta en el Inicio; esto es de quien supervisa.
//
// Las cifras de arriba salen del núcleo (`resumenDeMetas`), el mismo cálculo
// del portal. Bono, pago semestral, confirmación, gastos e histórico —y
// agregar una meta— siguen en el portal (dentro de la app).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchBonoActivo, fetchMetasDashboard } from '@nucleo/data/metas';
import { resumenDeMetas, tramoLabel, ymHoySV, ymLabel, ymSumar, YM_INICIO_HISTORIA } from '@nucleo/utils/metasUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const COLOR_TRAMO = { completo: MARCA.verde, medio: MARCA.ambar, nada: MARCA.rojo };
const pct = (n) => `${Math.round(Number(n) || 0)}%`;

/** La barra: lo vendido lleno, la proyección como sombra hasta donde llegaría. */
function Barra({ avance, proyectado, cerrado, color }) {
  const a = Math.max(0, Math.min(100, Number(avance) || 0));
  const p = Math.max(a, Math.min(100, Number(proyectado) || 0));
  return (
    <View style={{ height: 10, borderRadius: 5, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
      {!cerrado ? <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p}%`, backgroundColor: color, opacity: 0.3 }} /> : null}
      <View style={{ width: `${a}%`, height: 10, backgroundColor: color, borderRadius: 5 }} />
    </View>
  );
}

function PasoYm({ ym, onCambiar, min, max }) {
  const ir = (n) => { Haptics.selectionAsync().catch(() => {}); onCambiar(ymSumar(ym, n)); };
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable disabled={ym <= min} onPress={() => ir(-1)} hitSlop={8} style={{ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: ym <= min ? 0.3 : 1 }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 24 }}>‹</Text>
          </Pressable>
          <Text style={{ flex: 1, textAlign: 'center', color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{ymLabel(ym)}</Text>
          <Pressable disabled={ym >= max} onPress={() => ir(1)} hitSlop={8} style={{ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: ym >= max ? 0.3 : 1 }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 24 }}>›</Text>
          </Pressable>
        </View>
      </Vidrio>
    </View>
  );
}

export default function Metas() {
  const { getScope, user } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const ymActual = ymHoySV();
  const [ym, setYm] = useState(ymActual);
  const [rows, setRows] = useState(null);
  const [bono, setBono] = useState(false);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const todas = getScope?.('metas') === 'ALL';

  const cargar = useCallback(async () => {
    try {
      const [d, b] = await Promise.all([fetchMetasDashboard(ym), fetchBonoActivo(ym).catch(() => null)]);
      setRows(todas ? d : (d || []).filter((r) => String(r.branch_id) === String(user?.branchId)));
      if (b !== null) setBono(b);
      setError(null);
    } catch (e) { setError(mensajeAmigable(e, 'Error al cargar las metas')); setRows([]); }
  }, [ym, todas, user?.branchId]);
  useEffect(() => { setRows(null); cargar(); }, [cargar]);

  const r = useMemo(() => resumenDeMetas(rows || []), [rows]);
  const nombre = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? `Sala ${id}`;
  const esActual = ym === ymActual;
  const cerrado = ym < ymActual;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Metas', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <PasoYm ym={ym} onCambiar={setYm} min={YM_INICIO_HISTORIA} max={ymSumar(ymActual, 1)} />
        {esActual && rows?.[0] ? <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center' }}>{`Día ${rows[0].dias_transcurridos} de ${rows[0].dias_mes}`}</Text> : null}
        {rows ? (
          <FilaDeKpis>
            <Kpi icono="Target" rotulo="Vendido" valor={formatMoney(r.vendidoConMeta)} color={MARCA.verde}
              apoyo={r.meta > 0 ? `${pct(r.vendidoConMeta / r.meta * 100)} de ${formatMoney(r.meta)}` : 'sin metas este mes'} />
            {esActual ? (
              <Kpi icono="TrendingUp" rotulo="Proyección" valor={r.meta > 0 ? formatMoney(r.proy) : '—'} color={MARCA.azul}
                apoyo={r.meta > 0 ? `${pct(r.proy / r.meta * 100)} de la meta` : 'al cierre'} />
            ) : (
              <Kpi icono="BarChart3" rotulo="Semáforo" valor={r.conMeta ? `${r.tiers.completo} · ${r.tiers.medio} · ${r.tiers.nada}` : '—'} color={MARCA.violeta}
                apoyo="completo · medio · nada" />
            )}
          </FilaDeKpis>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {rows == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : rows.map((f) => {
          const sinMeta = f.monto_meta == null;
          const color = COLOR_TRAMO[f.bono_tier] ?? MARCA.azul;
          return (
            <View key={f.branch_id} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 14, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{nombre(f.branch_id)}</Text>
                    {sinMeta ? <Pildora texto="Sin meta asignada" color={colorSistema.texto2} />
                      : f.estado !== 'oficial' ? <Pildora texto="Pendiente de aprobar" color={MARCA.ambar} />
                        : f.bono_tier ? <Pildora texto={tramoLabel(f.bono_tier, bono)} color={color} /> : null}
                  </View>
                  {sinMeta ? (
                    <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Sin meta para ${ymLabel(ym).toLowerCase()} · vendido ${formatMoney(f.venta_acumulada)}`}</Text>
                  ) : (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800' }}>{formatMoney(f.venta_acumulada)}</Text>
                        <Text style={{ color, fontSize: 15, fontWeight: '800' }}>{pct(f.pct_cumplimiento)}</Text>
                        <View style={{ flex: 1 }} />
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`meta ${formatMoney(f.monto_meta)}`}</Text>
                      </View>
                      <Barra avance={f.pct_cumplimiento} proyectado={f.pct_proyectado} cerrado={cerrado} color={color} />
                      {!cerrado && f.proyeccion != null ? (
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                          {`Cierra en ${formatMoney(f.proyeccion)}${f.bono_tier === 'medio' ? ` · le faltan ${formatMoney(Math.max(0, f.monto_meta - f.proyeccion))} para la meta` : f.bono_tier === 'nada' ? ` · le faltan ${formatMoney(Math.max(0, f.monto_meta * 0.95 - f.proyeccion))} para el 95%` : ''}`}
                        </Text>
                      ) : null}
                    </>
                  )}
                </View>
              </Vidrio>
            </View>
          );
        })}
        {rows && !rows.length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin metas para este mes</Text>
        ) : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Bono, confirmación e histórico (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/metas', nombre: 'Metas' } })} />
        </View>
      </ScrollView>
    </>
  );
}
