// Corte Z, NATIVO — el Gran Z mensual de cada sucursal (`CorteZView`), para
// mirarlo en el teléfono: lo que va a la declaración, el cotejo contra el libro
// (siempre, cuadre o no), las comprobaciones y, si difiere, qué documento lo
// explica y qué hacer. El ticket original se puede abrir tal cual salió.
//
// Lo que se muestra es lo que DECLARÓ la sucursal; el número del portal va al
// lado como cotejo. El cotejo se ancla en las ventas gravadas del ticket, no en
// su total (ver `CorteZView`). Las cifras van detrás de `corte_z_ver_montos`
// también acá. El PDF es el MISMO papel del portal (`corteZHtml` traduce su
// documento) y sale a la hoja de compartir: una sucursal o todas, una por hoja.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchCortesZ } from '@nucleo/data/corteZ';
import { causaDeCorteZ, cuadraZ, documentosQueDifieren, FILAS_DECLARACION, totalesCorteZ } from '@nucleo/utils/corteZ';
import { EMPRESA } from '@nucleo/constants/empresa';
import { correrMes, mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import PasoDeMes, { nombreDelMes } from '../componentes/PasoDeMes';
import { MARCA } from '../componentes/inicio/marca';
import { corteZHtml, etiquetaPeriodo } from '@nucleo/utils/corteZPrint';
import { registrarEgreso } from '@nucleo/data/egreso';
import { compartirPdf } from '../componentes/pdf';
import { fallo } from '../componentes/Progreso';

const dif = (n) => (cuadraZ(n) ? '—' : formatMoney(n));

function Tarjeta({ f, verMontos }) {
  const [ticket, setTicket] = useState(false);
  const ok = cuadraZ(f.dif_total);
  const { docs, sinExplicar } = documentosQueDifieren(f);
  const comprobaciones = Array.isArray(f.comprobaciones) ? f.comprobaciones : [];
  const alertas = comprobaciones.filter((c) => c?.estado !== 'ok');
  const cotejo = [
    ['Con factura', f.z_factura, f.portal_factura, f.dif_factura],
    ['Con crédito fiscal', f.z_ccf, f.portal_ccf, f.dif_ccf],
    ...(!cuadraZ(f.retencion) || !cuadraZ(f.portal_retencion) ? [['Retención de IVA', f.retencion, f.portal_retencion, f.dif_retencion]] : []),
    ['Total', f.z_total, f.portal_total, f.dif_total],
  ];
  return (
    <View style={{ marginHorizontal: 16, gap: 10 }}>
      <Vidrio radio={22} tinte={ok ? undefined : 'rgba(247,144,9,0.12)'}>
        <View style={{ padding: 16, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{f.sucursal}</Text>
            <Pildora texto={ok ? 'Cuadra con el libro' : `Difiere ${formatMoney(Math.abs(f.dif_total))}`} color={ok ? MARCA.verde : MARCA.ambar} />
          </View>
          {f.direccion ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[f.direccion, f.departamento].filter(Boolean).join(', ')}</Text> : null}
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Del ${f.fecha_inicio} al ${f.fecha_fin} · ${Number(f.portal_documentos || 0).toLocaleString('es-SV')} documentos en el libro`}</Text>
          {verMontos ? <Text style={{ color: colorSistema.texto, fontSize: 30, fontWeight: '800', marginTop: 4 }}>{formatMoney(f.z_total)}</Text> : null}
        </View>
      </Vidrio>
      {verMontos ? (
        <>
          <Seccion titulo="Para la declaración">
            <View style={{ flexDirection: 'row' }}>
              <Text style={{ flex: 1 }} />
              <Text style={{ width: 96, textAlign: 'right', color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>FACTURA</Text>
              <Text style={{ width: 96, textAlign: 'right', color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>CRÉDITO F.</Text>
            </View>
            {FILAS_DECLARACION.map(([rotulo, clave]) => (
              <View key={clave} style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }}>{rotulo}</Text>
                <Text style={{ width: 96, textAlign: 'right', color: colorSistema.texto, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{formatMoney(f.declaracion?.factura?.[clave])}</Text>
                <Text style={{ width: 96, textAlign: 'right', color: colorSistema.texto, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{formatMoney(f.declaracion?.ccf?.[clave])}</Text>
              </View>
            ))}
          </Seccion>
          <Seccion titulo="Cotejo contra el libro" pie="Se compara contra las ventas gravadas del Corte Z, no contra su total.">
            <View style={{ flexDirection: 'row' }}>
              {['CORTE Z', 'LIBRO', 'DIFERENCIA'].map((c) => (
                <Text key={c} style={{ flex: 1, textAlign: 'right', color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{c}</Text>
              ))}
            </View>
            {cotejo.map(([rotulo, z, portal, d]) => (
              <View key={rotulo} style={{ gap: 2, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{rotulo}</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {[[formatMoney(z), colorSistema.texto, '600'], [formatMoney(portal), colorSistema.texto, '400'], [dif(d), cuadraZ(d) ? colorSistema.texto2 : MARCA.ambar, '700']].map(([v, color, peso], k) => (
                    <Text key={k} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
                      style={{ flex: 1, textAlign: 'right', color, fontSize: 14, fontWeight: peso, fontVariant: ['tabular-nums'] }}>{v}</Text>
                  ))}
                </View>
              </View>
            ))}
          </Seccion>
        </>
      ) : null}
      {comprobaciones.length ? (
        <Seccion titulo={alertas.length ? `Comprobaciones · ${alertas.length} con observación` : `Comprobaciones · las ${comprobaciones.length} pasan`}>
          {comprobaciones.map((c, i) => (
            <View key={c.clave ?? i} style={{ flexDirection: 'row', gap: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 8 : 0 }}>
              <Text style={{ width: 18, textAlign: 'center', color: c.estado === 'ok' ? MARCA.verde : MARCA.ambar, fontSize: 15, fontWeight: '800' }}>{c.estado === 'ok' ? '✓' : '!'}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{c.rotulo}</Text>
                {c.detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{c.detalle}</Text> : null}
              </View>
            </View>
          ))}
        </Seccion>
      ) : null}
      {!ok ? (
        <Seccion titulo={`Por qué difiere ${formatMoney(Math.abs(Number(f.residuo) || 0))}`}>
          {docs.length ? docs.map((d, i) => {
            const c = causaDeCorteZ(d.causa);
            return (
              <View key={`${d.correlativo ?? d.erp_invoice_id}-${i}`} style={{ gap: 2, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 8 : 0 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{c.que}</Text>
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{formatMoney(Math.abs(Number(d.impacto) || 0))}</Text>
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${d.fecha} · documento ${d.correlativo || d.erp_invoice_id}`}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{c.hacer}</Text>
              </View>
            );
          }) : (
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
              {`El libro tiene ${Number(f.residuo) > 0 ? 'más' : 'menos'} que el Corte Z y todavía no hay un diagnóstico de este período: se genera con el cuadre diario, que corre cada mañana.`}
            </Text>
          )}
          {docs.length && sinExplicar >= 0.005 ? <Aviso tono="cuidado" texto={`Quedan ${formatMoney(sinExplicar)} sin explicar: hay que revisarlos a mano contra el reporte del día.`} /> : null}
        </Seccion>
      ) : null}
      {f.ticket ? (
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setTicket((v) => !v); }} style={{ minHeight: 44, justifyContent: 'center', marginHorizontal: 4 }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>{ticket ? 'Ocultar el original' : 'Ver el original'}</Text>
        </Pressable>
      ) : null}
      {ticket ? (
        <Vidrio radio={16}>
          <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 11, fontFamily: 'Menlo' }}>{f.ticket}</Text>
          </ScrollView>
        </Vidrio>
      ) : null}
    </View>
  );
}

export default function CorteZ() {
  const { getScope, user, hasPermission } = useAuth();
  const verMontos = hasPermission('corte_z_ver_montos');
  const sala = getScope?.('corte_z') !== 'ALL' ? String(user?.branchId || '') : '';
  const [mes, setMes] = useState(() => correrMes(mesSV(), -1));
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [desde, hasta] = useMemo(() => rangoDelMes(mes), [mes]);
  const cargar = useCallback(async () => {
    try { setFilas(await fetchCortesZ(desde, hasta, sala)); setError(null); } catch (e) { setError(mensajeAmigable(e, 'No se pudo cargar el Corte Z')); setFilas([]); }
  }, [desde, hasta, sala]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]);
  const t = useMemo(() => totalesCorteZ(filas || []), [filas]);

  // El PDF: una sucursal o todas (una por hoja), el mismo papel del portal.
  const [pdfeando, setPdfeando] = useState(false);
  const pdfDe = async (lista, nombre) => {
    setPdfeando(true);
    try {
      if (await compartirPdf({ html: corteZHtml(lista), nombre })) {
        registrarEgreso('corte_z', { formato: 'pdf', filas: lista.length, detalle: { mes, sucursales: lista.map((f) => f.sucursal), via: 'app' } });
      }
    } catch (e) {
      fallo('No se pudo armar el PDF', mensajeAmigable(e, ''));
    } finally {
      setPdfeando(false);
    }
  };
  const elegirPdf = () => {
    Haptics.selectionAsync().catch(() => {});
    const opciones = [`Todas las sucursales (${filas.length})`, ...filas.map((f) => f.sucursal), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: `Corte Z · ${etiquetaPeriodo(desde)}`, options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => {
      if (i === 0) pdfDe(filas, `Corte Z ${etiquetaPeriodo(desde)} · todas las sucursales`);
      else if (i > 0 && i <= filas.length) pdfDe([filas[i - 1]], `Corte Z ${etiquetaPeriodo(desde)} · ${filas[i - 1].sucursal}`);
    });
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Corte Z', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <PasoDeMes mes={mes} onCambiar={setMes} />
        {filas && filas.length ? (
          <FilaDeKpis>
            {verMontos ? <Kpi icono="DollarSign" rotulo="Total general" valor={formatMoney(t.total)} color={MARCA.azul} apoyo={`${t.sucursales} sucursal${t.sucursales === 1 ? '' : 'es'} · CCF ${formatMoney(t.ccf)}`} />
              : <Kpi icono="Building2" rotulo="Sucursales" valor={String(t.sucursales)} color={MARCA.azul} apoyo="del período" />}
            <Kpi icono="AlertTriangle" rotulo="Con observación" valor={String(t.difieren)} color={t.difieren ? MARCA.ambar : MARCA.verde} apoyo={t.difieren ? `${t.sucursales - t.difieren} sin diferencia` : 'Todas cuadran'} />
          </FilaDeKpis>
        ) : null}
        <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 20 }}>{`${EMPRESA.razonSocial} · NIT ${EMPRESA.nit} · NRC ${EMPRESA.nrc}`}</Text>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : filas.map((f) => <Tarjeta key={`${f.branch_id}-${f.periodo}`} f={f} verMontos={verMontos} />)}
        {filas && !filas.length && !error ? (
          <View style={{ marginHorizontal: 24, gap: 6, marginTop: 30 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>{`Sin Corte Z de ${nombreDelMes(mes)}`}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>
              {mes >= mesSV() ? 'El mes en curso todavía no se cierra. El Corte Z se trae el día 1 del mes siguiente.' : 'Este período no se ha traído todavía. No es un mes sin ventas: es que nadie lo procesó.'}
            </Text>
          </View>
        ) : null}
        {hasPermission('corte_z_descargar') && filas?.length ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto={pdfeando ? 'Armando el PDF…' : 'Compartir el PDF'} deshabilitado={pdfeando} onPress={elegirPdf} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
