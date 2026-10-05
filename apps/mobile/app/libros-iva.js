// Libros de IVA, NATIVO — `LibrosIvaView` en resumen: para el mes (y la
// sucursal, a quien ve todas), cada libro con sus documentos, gravadas, el
// impuesto y el total —consumidor, contribuyentes, compras, anulados,
// percepción, retención, retención de renta y notas de crédito— y el aviso de
// ventas que se quedaron fuera del libro por no tener sello válido.
//
// Los totales salen del núcleo (`librosIva`), los mismos del portal y del ZIP.
// El detalle renglón por renglón y las descargas siguen en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  fetchAnexoRetencionRenta, fetchLibroAnulados, fetchLibroCompras, fetchLibroConsumidor, fetchLibroContribuyente,
  fetchLibroPercepcion, fetchLibroRetencion, fetchNotasCreditoCompras, fetchRetencionVentas, fetchVentasFueraDelLibro,
} from '@nucleo/data/librosIva';
import { calcularTotales } from '@nucleo/utils/librosIva';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import PasoDeMes from '../componentes/PasoDeMes';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Dato } from '../componentes/formulario/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

// Cada libro: qué se llama el impuesto en él y si es de ventas o de compras.
const LIBROS = [
  { k: 'consumidor', t: 'Ventas a consumidor', imp: 'Débito fiscal', docs: 'documentos' },
  { k: 'contribuyente', t: 'Ventas a contribuyentes', imp: 'Débito fiscal', docs: 'CCF' },
  { k: 'compras', t: 'Compras', imp: 'Crédito fiscal', docs: 'documentos' },
  { k: 'anulados', t: 'Anulados', imp: null, docs: 'documentos' },
  { k: 'percepcion', t: 'Percepción', imp: 'Percepción', docs: 'documentos', base: 'Sujeto' },
  { k: 'retencion', t: 'Retención', imp: 'Retención', docs: 'documentos', base: 'Sujeto' },
  { k: 'retencionVentas', t: 'Retención que nos hicieron', imp: 'Retenido', docs: 'documentos', base: 'Sujeto' },
  { k: 'renta', t: 'Retención de renta', imp: 'Retención 10%', docs: 'documentos', base: 'Base' },
  { k: 'notas', t: 'Notas de crédito y débito', imp: 'IVA neto', docs: 'documentos', base: 'Monto neto' },
];

export default function LibrosIva() {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const todas = getScope?.('libros_iva') === 'ALL';
  const [mes, setMes] = useState(mesSV);
  const [salaElegida, setSala] = useState('ALL');
  const sala = todas ? (salaElegida === 'ALL' ? null : salaElegida) : String(user?.branchId ?? '');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const [desde, hasta] = rangoDelMes(mes);
    const r = await Promise.all([
      fetchLibroConsumidor(desde, hasta, sala), fetchLibroContribuyente(desde, hasta, sala), fetchLibroAnulados(desde, hasta, sala),
      fetchLibroCompras(desde, hasta, sala), fetchLibroPercepcion(desde, hasta, sala), fetchLibroRetencion(desde, hasta, sala),
      fetchNotasCreditoCompras(desde, hasta), fetchAnexoRetencionRenta(desde, hasta), fetchVentasFueraDelLibro(desde, hasta, sala),
      fetchRetencionVentas(desde, hasta, sala),
    ]);
    const fallo = r.find((x) => x.error)?.error;
    setError(fallo ? fallo.message : null);
    const [c, k, a, co, pe, re, nc, rt, fu, rv] = r.map((x) => x.data || []);
    setDatos({ libros: { consumidor: c, contribuyente: k, anulados: a, compras: co, percepcion: pe, retencion: re, notas: nc, renta: rt, retencionVentas: rv }, fuera: fu[0] ?? null });
  }, [mes, sala]);
  useEffect(() => { setDatos(null); cargar(); }, [cargar]);

  const t = useMemo(() => (datos ? calcularTotales(datos.libros) : null), [datos]);
  const debito = t ? t.consumidor.debito + t.contribuyente.debito : 0;
  const grupos = todas ? [{ id: 'sala', titulo: 'Sucursal', activa: salaElegida, porDefecto: 'ALL', onCambiar: setSala,
    opciones: [{ id: 'ALL', label: 'Todas' }, ...[...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)).map((b) => ({ id: String(b.id), label: b.name }))] }] : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Libros de IVA', headerLargeTitle: true }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
        <PasoDeMes mes={mes} onCambiar={setMes} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {t == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <>
            <FilaDeKpis>
              <Kpi icono="TrendingUp" rotulo="Débito fiscal" valor={formatMoney(debito)} color={MARCA.ambar} apoyo="de las ventas" />
              <Kpi icono="TrendingDown" rotulo="Crédito fiscal" valor={formatMoney(t.compras.debito)} color={MARCA.verde} apoyo={`${t.compras.docs} compras`} />
            </FilaDeKpis>
            {(datos.fuera?.documentos ?? 0) > 0 ? (
              <View style={{ marginHorizontal: 16 }}>
                <Aviso tono="cuidado" texto={`${datos.fuera.documentos} venta(s) por ${formatMoney(datos.fuera.monto)} se quedaron fuera del libro: ${datos.fuera.sin_sello ?? 0} sin sello y ${datos.fuera.sello_invalido ?? 0} con sello inválido.`} />
              </View>
            ) : null}
            {LIBROS.map((l) => {
              const x = t[l.k];
              if (!x) return null;
              return (
                <View key={l.k} style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={18}>
                    <View style={{ padding: 12, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{l.t}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${x.docs} ${l.docs}`}</Text>
                      </View>
                      {x.exentas ? <Dato rotulo="Exentas" valor={formatMoney(x.exentas)} primero /> : null}
                      {l.k !== 'anulados' ? <Dato rotulo={l.base ?? 'Gravadas'} valor={formatMoney(x.gravadas)} primero={!x.exentas} /> : null}
                      {l.imp ? <Dato rotulo={l.imp} valor={formatMoney(x.debito)} /> : null}
                      {x.retencion ? <Dato rotulo="Retención del cliente" valor={formatMoney(x.retencion)} /> : null}
                      {!l.base ? <Dato rotulo="Total" valor={formatMoney(x.total)} fuerte primero={l.k === 'anulados'} /> : null}
                    </View>
                  </Vidrio>
                </View>
              );
            })}
          </>
        )}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Detalle y descargas (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/libros-iva', nombre: 'Libros de IVA' } })} />
        </View>
      </ScrollView>
    </>
  );
}
