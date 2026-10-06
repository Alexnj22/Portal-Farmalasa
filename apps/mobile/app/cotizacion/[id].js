// El detalle de una cotización, NATIVO: el cliente (con su NIT), la sala, la
// forma de pago, los productos y los totales —base, IVA, retención y total— con
// la misma cuenta del portal (`totalesDeCotizacion`). En un CCF cada renglón
// lleva su desglose como el portal: precio sin IVA, subtotal sin IVA, IVA 13% y
// total (`desgloseConIva`).
//
// «Compartir PDF» arma el MISMO papel que imprime el portal (`cotizacionPapel`,
// núcleo) y lo pasa a la hoja de compartir o a AirPrint, con el permiso
// `cotizaciones_descargar`; es una salida de datos y se anota (`registrarEgreso`).
// «Anular» —con `cotizaciones` editar y la cotización activa— pide confirmación.
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { anularCotizacion, fetchCotizacionItems } from '@nucleo/data/cotizaciones';
import { registrarEgreso } from '@nucleo/data/egreso';
import { desgloseConIva, totalesDeCotizacion } from '@nucleo/utils/cotizacion';
import { buildPrintHTML } from '@nucleo/utils/cotizacionPapel';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { cotizacionGuardada, guardarCotizaciones } from '../../componentes/cotizaciones/cache';
import { compartirPdf, imprimirPapel } from '../../componentes/pdf';
import { fallo, listo } from '../../componentes/Progreso';

const FORMA = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', TRANSFERENCIA: 'Transferencia', CHEQUE: 'Cheque' };
// El papel del portal se imprime solo al abrirse en una ventana; en el PDF ese
// guion no hace nada útil, así que se quita.
const sinGuion = (html) => html.replace(/<script>[\s\S]*?<\/script>/g, '');

export default function Cotizacion() {
  const { id } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const branches = useStaffStore((s) => s.branches);
  const [c, setC] = useState(() => cotizacionGuardada(id));
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const puedeEditar = hasPermission('cotizaciones', 'can_edit');
  const puedeDescargar = hasPermission('cotizaciones_descargar');

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchCotizacionItems(id);
    setItems(data || []); setError(e ? mensajeAmigable(e) : null);
  }, [id]);
  // Al volver de editarla: el encabezado y los renglones se releen.
  useFocusEffect(useCallback(() => { setC((x) => cotizacionGuardada(id) ?? x); cargar(); }, [id, cargar]));

  const sala = useMemo(() => (branches || []).find((b) => Number(b.id) === Number(c?.branch_id))?.name ?? '', [branches, c]);
  const esCCF = c?.document_type === 'CCF';
  const anulada = c?.status === 'ANULADA';
  const t = items ? totalesDeCotizacion(items, c?.applies_retention) : null;

  const papel = () => sinGuion(buildPrintHTML(c, items || [], sala));
  const anotar = (formato) => registrarEgreso('cotizaciones', { formato, filas: items?.length ?? 0, detalle: { cotizacion: c?.numero, via: 'app' } });
  const compartir = async () => {
    setOcupado(true);
    try { if (await compartirPdf({ html: papel(), nombre: `Cotización ${c.numero} ${c.customer_name || ''}` })) anotar('pdf'); }
    catch (e) { fallo('No se pudo armar el PDF', e?.message || ''); }
    finally { setOcupado(false); }
  };
  const imprimir = async () => {
    try { await imprimirPapel(papel()); anotar('impresion'); }
    catch (e) { fallo('No se pudo imprimir', e?.message || ''); }
  };
  const menu = () => {
    Haptics.selectionAsync().catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions({ options: ['Compartir PDF', 'Imprimir', 'Cancelar'], cancelButtonIndex: 2 },
      (i) => { if (i === 0) compartir(); else if (i === 1) imprimir(); });
  };
  const anular = () => Alert.alert('Anular cotización', `${c.numero} queda anulada y no se puede usar para facturar.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Anular', style: 'destructive', onPress: async () => {
      setOcupado(true);
      try {
        await anularCotizacion(c.id);
        const nueva = { ...c, status: 'ANULADA' };
        setC(nueva); guardarCotizaciones([nueva]);
        listo('Cotización anulada', c.numero);
      } catch (e) { fallo('No se pudo anular', mensajeAmigable(e)); }
      finally { setOcupado(false); }
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: c?.numero || 'Cotización', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {c ? (
          <View style={{ gap: 5, marginHorizontal: 4 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{c.customer_name || 'Sin cliente'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{[c.numero, fechaTexto(c.fecha, { day: 'numeric', month: 'long', year: 'numeric' }), sala].filter(Boolean).join(' · ')}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Pildora texto={c.document_type || 'COF'} color={esCCF ? MARCA.violetaClaro : colorSistema.texto2} />
              {anulada ? <Pildora texto="Anulada" color={MARCA.rojo} /> : <Pildora texto="Activa" color={MARCA.verde} />}
              {c.applies_retention ? <Pildora texto="Retención 1%" color={MARCA.ambar} /> : null}
            </View>
          </View>
        ) : null}
        {c ? (
          <Seccion titulo="Datos">
            <Dato primero rotulo="Cliente" valor={c.customer_name || '—'} />
            {c.customer_nit ? <Dato rotulo="NIT" valor={c.customer_nit} /> : null}
            <Dato rotulo="Sucursal" valor={sala || '—'} />
            <Dato rotulo="Forma de pago" valor={FORMA[c.payment_type] || c.payment_type || '—'} />
            {c.created_by_name ? <Dato rotulo="Preparó" valor={c.created_by_name} /> : null}
          </Seccion>
        ) : null}
        {error ? <Aviso tono="freno" texto={error} /> : null}
        <Seccion titulo={items ? `Productos · ${items.length}` : 'Productos'} pie={esCCF ? 'Desglose de CCF por línea: precios sin IVA y el IVA de cada renglón.' : null}>
          {items == null ? <ActivityIndicator /> : items.map((it, i) => {
            const d = esCCF ? desgloseConIva(parseFloat(it.precio_unitario || 0), parseFloat(it.cantidad || 1)) : null;
            return (
              <View key={it.id ?? i} style={{ gap: 4, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 9 : 0 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{it.product_nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                      {[it.presentacion_desc, `${formatQty(it.cantidad, { decimalesMax: 3 })} × ${formatMoney(d ? d.unitSinIva : it.precio_unitario)}${d ? ' s/IVA' : ''}`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(d ? d.total : it.subtotal)}</Text>
                </View>
                {d ? (
                  <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>
                    {`Subtotal s/IVA ${formatMoney(d.subtotalSinIva)} · IVA 13% ${formatMoney(d.subtotalIva)}`}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </Seccion>
        {t ? (
          <Seccion titulo="Totales">
            <Dato primero rotulo="Subtotal s/IVA" valor={formatMoney(t.base)} />
            <Dato rotulo="IVA 13%" valor={formatMoney(t.iva)} />
            {t.retention ? <Dato rotulo="Retención 1%" valor={`−${formatMoney(t.retention)}`} /> : null}
            <Dato rotulo="Total a pagar" valor={formatMoney(t.total)} fuerte />
          </Seccion>
        ) : null}
        {c?.notes ? <Seccion titulo="Notas"><Text style={{ color: colorSistema.texto, fontSize: 15 }}>{c.notes}</Text></Seccion> : null}
        {c && items && puedeDescargar ? <BotonGrande texto={ocupado ? 'Un momento…' : 'Compartir o imprimir'} onPress={menu} deshabilitado={ocupado} /> : null}
        {c && !anulada && puedeEditar ? <BotonGrande texto="Editar cotización" borde color={MARCA.azulClaro} onPress={() => router.push({ pathname: '/cotizacion/nueva', params: { id: String(c.id) } })} deshabilitado={ocupado} /> : null}
        {c && !anulada && puedeEditar ? <BotonGrande texto="Anular cotización" color={MARCA.rojo} borde onPress={anular} deshabilitado={ocupado} /> : null}
      </ScrollView>
    </>
  );
}
