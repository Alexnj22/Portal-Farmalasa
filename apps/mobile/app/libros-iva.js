// Libros de IVA, NATIVO — `LibrosIvaView` en resumen: para el mes (y la
// sucursal, a quien ve todas), cada libro con sus documentos, gravadas, el
// impuesto y el total —consumidor, contribuyentes, compras, anulados,
// percepción, retención, retención de renta y notas de crédito— y el aviso de
// ventas que se quedaron fuera del libro por no tener sello válido.
//
// Los totales salen del núcleo (`librosIva`), los mismos del portal y del ZIP.
// Tocar un libro abre su detalle renglón por renglón con sus avisos de
// cumplimiento y «Exportar CSV» (`componentes/fiscal/DetalleDeLibro`). Los
// permisos son los del portal: cada libro con su `libros_iva_tab_*`, las
// tarjetas de dinero con `libros_iva_ver_montos` y el CSV con
// `libros_iva_descargar`. El paquete del mes (ZIP de todas las salas) sigue
// en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import DetalleDeLibro from '../componentes/fiscal/DetalleDeLibro';
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
import { Aviso, Dato } from '../componentes/formulario/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

// Cada libro: qué se llama el impuesto en él y si es de ventas o de compras.
// `tab` es la pestaña del portal que da el permiso (`libros_iva_tab_<tab>`).
const LIBROS = [
  { k: 'consumidor', tab: 'consumidor', t: 'Ventas a consumidor', imp: 'Débito fiscal', docs: 'días' },
  { k: 'contribuyente', tab: 'contribuyente', t: 'Ventas a contribuyentes', imp: 'Débito fiscal', docs: 'CCF' },
  { k: 'compras', tab: 'compras', t: 'Compras', imp: 'Crédito fiscal', docs: 'documentos' },
  { k: 'anulados', tab: 'anulados', t: 'Anulados', imp: null, docs: 'documentos' },
  { k: 'percepcion', tab: 'percepcion', t: 'Percepción', imp: 'Percepción', docs: 'documentos', base: 'Sujeto' },
  { k: 'retencion', tab: 'retencion', t: 'Retención', imp: 'Retención', docs: 'documentos', base: 'Sujeto' },
  { k: 'retencionVentas', tab: 'retencion', t: 'Retención que nos hicieron', imp: 'Retenido', docs: 'documentos', base: 'Sujeto' },
  { k: 'renta', tab: 'renta', t: 'Retención de renta', imp: 'Retención 10%', docs: 'documentos', base: 'Base' },
  { k: 'notas', tab: 'notas', t: 'Notas de crédito y débito', imp: 'IVA neto', docs: 'documentos', base: 'Monto neto' },
];

export default function LibrosIva() {
  const { user, getScope, hasPermission } = useAuth();
  const verMontos = hasPermission('libros_iva_ver_montos');
  const puedeExportar = hasPermission('libros_iva_descargar');
  const libros = LIBROS.filter((l) => hasPermission(`libros_iva_tab_${l.tab}`));
  const [abierto, setAbierto] = useState(null);
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
  useEffect(() => { setDatos(null); setAbierto(null); cargar(); }, [cargar]);
  const nombreSala = useCallback((id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? '', [sucursales]);
  const sufijo = `${mes}${sala ? `_${nombreSala(sala).replace(/\s+/g, '-')}` : ''}`;

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
            {verMontos ? (
              <FilaDeKpis>
                <Kpi icono="TrendingUp" rotulo="Débito fiscal" valor={formatMoney(debito)} color={MARCA.ambar} apoyo="de las ventas" />
                <Kpi icono="TrendingDown" rotulo="Crédito fiscal" valor={formatMoney(t.compras.debito)} color={MARCA.verde} apoyo={`${t.compras.docs} compras`} />
              </FilaDeKpis>
            ) : null}
            {!libros.length ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Tu cargo no tiene ningún libro asignado." /></View> : null}
            {(datos.fuera?.documentos ?? 0) > 0 ? (
              <View style={{ marginHorizontal: 16 }}>
                <Aviso tono="cuidado" texto={`${datos.fuera.documentos} venta(s) por ${formatMoney(datos.fuera.monto)} se quedaron fuera del libro: ${datos.fuera.sin_sello ?? 0} sin sello y ${datos.fuera.sello_invalido ?? 0} con sello inválido.`} />
              </View>
            ) : null}
            {libros.map((l) => {
              const x = t[l.k];
              if (!x) return null;
              const open = abierto === l.k;
              return (
                <View key={l.k} style={{ gap: 10 }}>
                <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(open ? null : l.k); }}
                  style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                  <Vidrio radio={18} interactivo tinte={open ? 'rgba(59,130,246,0.14)' : undefined}>
                    <View style={{ padding: 12, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{l.t}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${x.docs} ${l.k === 'consumidor' && !sala ? 'renglones (día · sala)' : l.docs}  ${open ? '▴' : '›'}`}</Text>
                      </View>
                      {x.exentas ? <Dato rotulo="Exentas" valor={formatMoney(x.exentas)} primero /> : null}
                      {l.k !== 'anulados' ? <Dato rotulo={l.base ?? 'Gravadas'} valor={formatMoney(x.gravadas)} primero={!x.exentas} /> : null}
                      {l.imp ? <Dato rotulo={l.imp} valor={formatMoney(x.debito)} /> : null}
                      {x.retencion ? <Dato rotulo="Retención del cliente" valor={formatMoney(x.retencion)} /> : null}
                      {!l.base ? <Dato rotulo="Total" valor={formatMoney(x.total)} fuerte primero={l.k === 'anulados'} /> : null}
                    </View>
                  </Vidrio>
                </Pressable>
                {open ? <DetalleDeLibro tab={l.k} titulo={l.t} libros={datos.libros} totales={t} mes={mes} sufijo={sufijo} nombreSala={nombreSala} puedeExportar={puedeExportar} /> : null}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </>
  );
}
