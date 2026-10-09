// Inyecciones · Por cobrar, NATIVO — `TabPorCobrar` del portal: «¿a quién se
// le cobró la aplicación?». Las ventas con inyección del período y, al lado, el
// cobro que les corresponde; las cifras de arriba filtran; por vendedor; y los
// cobros que no encontraron venta, que se pueden ASIGNAR a mano (como el
// portal, con `inyecciones_dosis`). Deshacer una asignación hecha a mano, igual.
// El cruce lo hace la base (`get_inyecciones_aplicadas`); resumen, filtro y CSV
// salen del núcleo (`inyeccionesPorCobrar`), los mismos que usa el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { desvincularCobro } from '@nucleo/data/inyecciones';
import { fetchInyeccionesAplicadas } from '@nucleo/data/ventas';
import {
  CABECERA_CSV_POR_COBRAR, DESDE_EL_PORTAL, filasCsvPorCobrar, filtrarVentasDeInyeccion, nombreDeCobro,
  porVendedorDeInyecciones, rangoPorDefecto, resumenPorCobrar,
} from '@nucleo/utils/inyeccionesPorCobrar';
import { correrMes, fechaNumerica, hoySV, rangoDelMes } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { formatMoney, formatPct } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../Segmentos';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';
import { compartirCsv } from '../fiscal/csv';
import { guardar } from '../comercial/elegido';
import Tocable from '../Tocable';

const PAGINA = 40;
const fechaCorta = (f) => fechaNumerica(f, { anio: false });
const factura = (c) => String(c || '').replace(/^0+/, '');

/** Los períodos del menú: desde que se anota (el del portal), este mes y el anterior. */
export function periodosDePorCobrar(hoy = hoySV()) {
  const mes = hoy.slice(0, 7);
  const [a1, b1] = rangoDelMes(mes);
  const [a2, b2] = rangoDelMes(correrMes(mes, -1));
  return [
    { id: rangoPorDefecto(hoy), label: 'Desde que se anota' },
    { id: `${a1}|${hoy < b1 ? hoy : b1}`, label: 'Este mes' },
    { id: `${a2}|${b2}`, label: 'Mes anterior' },
  ];
}

export default function PorCobrar({ busqueda, sala, nombreSala, puedeAsignar, rango, recarga }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [estado, setEstado] = useState('todas');
  const [cuantas, setCuantas] = useState(PAGINA);
  const [fini, ffin] = rango.split('|');

  const cargar = useCallback(() => {
    setDatos(null);
    return fetchInyeccionesAplicadas({ fini, ffin, branchId: sala || null })
      .then((d) => { setDatos(d); setError(null); })
      .catch((e) => { setDatos({ ventas: [], cobros_sin_venta: [] }); setError(mensajeAmigable(e, 'No se pudieron cargar las inyecciones')); });
  }, [fini, ffin, sala]);
  useEffect(() => { cargar(); }, [cargar, recarga]); // eslint-disable-line react-hooks/set-state-in-effect -- carga de datos
  useEffect(() => { setCuantas(PAGINA); }, [estado, busqueda, rango, sala]); // eslint-disable-line react-hooks/set-state-in-effect -- otro filtro, primera página

  const r = useMemo(() => resumenPorCobrar(datos), [datos]);
  const ventas = useMemo(() => datos?.ventas || [], [datos]);
  const sueltos = useMemo(() => datos?.cobros_sin_venta || [], [datos]);
  const vendedores = useMemo(() => porVendedorDeInyecciones(ventas), [ventas]);
  const filtradas = useMemo(() => filtrarVentasDeInyeccion(ventas, estado, busqueda), [ventas, estado, busqueda]);

  const desasignar = (v) => Alert.alert('Deshacer la asignación',
    `El cobro de ${formatMoney(v.cobro.monto)} vuelve a la lista de cobros sin venta.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Deshacer', style: 'destructive', onPress: async () => {
        trabajando('Deshaciendo…');
        try {
          await desvincularCobro(v.cobro.id);
          useStaffStore.getState().appendAuditLog('INYECCION_COBRO_DESASIGNADO', String(v.cobro.id), { venta: v.id, desde: 'app' });
          listo('Asignación deshecha', 'Vuelve a la lista de cobros sin venta.');
          cargar();
        } catch (e) { fallo('No se pudo deshacer la asignación', mensajeAmigable(e)); }
      } },
    ]);

  const descargar = async () => {
    try {
      await compartirCsv({ headers: CABECERA_CSV_POR_COBRAR, rows: filasCsvPorCobrar(filtradas, nombreSala),
        nombre: `inyecciones_${fini}_${ffin}`, modulo: 'inyecciones' });
    } catch (e) { fallo('No se pudo compartir', e?.message || ''); }
  };

  const asignar = (c) => { guardar('inyeccion-cobro', c); router.push('/inyeccion-asignar'); };

  if (datos == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      <FilaDeKpis>
        <Kpi icono="ClipboardList" rotulo="Ventas con inyección" valor={String(r.ventas)} color={MARCA.azul} apoyo="facturas del período" />
        <Kpi icono="CheckCircle2" rotulo="Con cobro" valor={String(r.con)} color={MARCA.verde} apoyo={`${formatPct(r.pct)} de las ventas`}
          onPress={() => setEstado((e) => (e === 'con' ? 'todas' : 'con'))} />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="AlertTriangle" rotulo="Sin cobro" valor={String(r.sin)} color={r.sin ? MARCA.ambar : MARCA.verde} apoyo="no se encontró su cobro"
          onPress={() => setEstado((e) => (e === 'sin' ? 'todas' : 'sin'))} />
        <Kpi icono="HandCoins" rotulo="Cobros sin venta" valor={String(r.sueltos)} color={MARCA.azulClaro} apoyo={`${formatMoney(r.montoSueltos)} cobrados`} />
      </FilaDeKpis>
      <Segmentos activa={estado} onCambiar={setEstado} opciones={[{ id: 'todas', label: 'Todas' }, { id: 'con', label: 'Con cobro' }, { id: 'sin', label: 'Sin cobro' }]} />
      <View style={{ marginHorizontal: 16, gap: 6 }}>
        {fini < DESDE_EL_PORTAL ? <Aviso tono="cuidado" texto="Antes del 3 de septiembre la aplicación no se registraba en el portal: las ventas anteriores a esa fecha aparecen «sin cobro» aunque se hayan cobrado." /> : null}
        {error ? <Aviso tono="freno" texto={error} /> : null}
        <Aviso texto="El cobro de la aplicación se asigna a su venta al cobrarse. Los cobros de antes, o los que se cobraron sin venta, se unen por hora con la venta más cercana del mismo día y sucursal, y se marcan «estimado»." />
      </View>

      {vendedores.length ? (
        <View style={{ marginHorizontal: 16 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginLeft: 4, marginBottom: 6 }}>Por vendedor</Text>
          <Vidrio radio={18}>
            <View style={{ padding: 12, gap: 10 }}>
              {vendedores.map((v) => (
                <View key={v.cod} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {v.nombre ? <Avatar empleado={{ id: v.id, name: v.nombre }} tamano={30} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{nombreDeCobro(v.nombre)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Cód. ${v.cod} · ${v.ventas} ventas · ${v.con} con cobro · ${v.ventas - v.con} sin cobro`}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{formatPct((v.con / v.ventas) * 100)}</Text>
                </View>
              ))}
            </View>
          </Vidrio>
        </View>
      ) : null}

      <View style={{ marginHorizontal: 16, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{`${filtradas.length} ventas`}</Text>
        {filtradas.length ? (
          <Tocable onPress={descargar} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Descargar CSV</Text>
          </Tocable>
        ) : null}
      </View>
      {filtradas.slice(0, cuantas).map((v) => (
        <View key={v.id} style={{ marginHorizontal: 16 }}>
          <Vidrio radio={18}>
            <View style={{ padding: 12, gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{v.cliente || 'Sin nombre'}</Text>
                {v.cobro
                  ? <Pildora texto={`Cobrada ${formatMoney(v.cobro.monto)}${v.vinculo === 'estimado' ? ' · estimado' : ''}`} color={v.vinculo === 'estimado' ? colorSistema.texto2 : MARCA.verde} />
                  : <Pildora texto="Sin cobro" color={MARCA.ambar} />}
              </View>
              {(v.productos || []).map((p, k) => (
                <Text key={k} style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{`${Number(p.cantidad)}× ${p.descripcion}`}</Text>
              ))}
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[`${fechaCorta(v.fecha)} · ${hora12(v.hora)}`, `Factura ${factura(v.correlativo)}`, sala ? null : nombreSala(v.branch_id), v.vendedor_nombre ? nombreDeCobro(v.vendedor_nombre) : null].filter(Boolean).join(' · ')}
              </Text>
              {v.cobro ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                  {`Cobro ${hora12(v.cobro.hora)} · ${nombreDeCobro(v.cobro.registrado_nombre)}${v.vinculo !== 'estimado' && Number(v.dosis) > 1 ? ` · ${v.pagadas} de ${v.dosis} pagadas · ${v.aplicadas} aplicadas` : ''}`}
                </Text>
              ) : null}
              {v.cobro && v.vinculo === 'a_mano' && puedeAsignar ? (
                <Tocable onPress={() => desasignar(v)} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' }}>
                  <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Deshacer asignación</Text>
                </Tocable>
              ) : null}
            </View>
          </Vidrio>
        </View>
      ))}
      {filtradas.length > cuantas ? (
        <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`Ver ${Math.min(PAGINA, filtradas.length - cuantas)} más`} borde color={MARCA.azulClaro} onPress={() => setCuantas((n) => n + PAGINA)} /></View>
      ) : null}
      {!filtradas.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>
          {estado === 'todas' ? 'Sin ventas de inyecciones en este período' : 'Ninguna venta con ese filtro'}
        </Text>
      ) : null}

      {sueltos.length ? (
        <View style={{ marginHorizontal: 16, gap: 8, marginTop: 8 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800' }}>Cobros de aplicación sin venta</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>No hay una venta de inyección cerca de su hora. Casi siempre es alguien que trajo su inyección o la compró otro día.</Text>
          {sueltos.map((c) => (
            <Vidrio key={c.id} radio={18}>
              <View style={{ padding: 12, gap: 4 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{c.concepto}</Text>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{formatMoney(c.monto)}</Text>
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {[`${fechaCorta(c.fecha)} · ${hora12(c.hora)}`, sala ? null : nombreSala(c.branch_id), nombreDeCobro(c.registrado_nombre)].filter(Boolean).join(' · ')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {c.origen === 'TRAIDA' ? <Pildora texto="Traída" color={colorSistema.texto2} /> : null}
                  <View style={{ flex: 1 }} />
                  {puedeAsignar && c.origen !== 'TRAIDA' ? (
                    <Tocable onPress={() => asignar(c)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                      <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Asignar a una venta</Text>
                    </Tocable>
                  ) : null}
                </View>
              </View>
            </Vidrio>
          ))}
        </View>
      ) : null}
    </>
  );
}
