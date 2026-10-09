// Nueva solicitud — Ajuste de Mín·Máx, NATIVO. Lo mismo que el portal
// (`WidgetMinMaxRequest.jsx`) con las reglas del núcleo
// (`utils/minmaxSolicitud`):
//
//   · se busca el producto (`buscarProductosMinMax`);
//   · se ve lo de hoy en la sala: su MIN·MAX efectivo (`effectiveMinMaxPair`),
//     lo que vendió en el mes y en 6 meses, la existencia y la última venta;
//   · se propone el nuevo par. `parMinMaxValido` dice si el par tiene sentido,
//     `ajusteSinCambio` frena lo que no cambia nada y
//     `motivosQueExigenExplicacion` pide el motivo cuando es un salto grande,
//     el producto no tiene par todavía o se deja en 0·0.
//
// Bodega no admite estas solicitudes (su par sale de la suma de las salas) y
// un producto oculto tampoco. Se guarda en su propia tabla; a quien decide le
// avisa la base.
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { buscarProductosMinMax, fetchCurrentStockParams, fetchMinMaxContextoVenta, fetchProductPreciosForMinMax, insertMinMaxChangeRequest } from '@nucleo/data/minmaxRequests';
import { effectiveMinMaxPair } from '@nucleo/data/stockParams';
import { ajusteSinCambio, equivalenteEnCajas, presentacionDominante, presentacionesDelProducto, fmtUltimaVenta, mensajeDeMinMax, motivosQueExigenExplicacion, parMinMaxValido, solicitudDeMinMax } from '@nucleo/utils/minmaxSolicitud';
import { BRANCH_A_ERP, ERP_BODEGA, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { MenuDeFiltros } from '../../componentes/Filtros';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const BODEGA = ERP_BODEGA;

function Numero({ valor, onCambiar, rotulo }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{rotulo}</Text>
      <Campo multiline={false} value={valor} onChangeText={(t) => onCambiar(t.replace(/\D/g, ''))} keyboardType="number-pad"
        style={{ textAlign: 'center', fontSize: 26, fontWeight: '800', minHeight: 58 }} placeholder="—" />
    </View>
  );
}

export default function MinMax() {
  const { user, getScope } = useAuth();
  const todas = getScope?.('dash_minmax_req') === 'ALL';
  const propia = BRANCH_A_ERP[String(salaDelUsuario(user) ?? '')] ?? null;
  const opcionesSala = ERP_ORDEN.filter((e) => e !== BODEGA);
  const [erpElegido, setErp] = useState(String(propia && propia !== BODEGA ? propia : opcionesSala[0]));
  const erp = todas ? erpElegido : (propia != null ? String(propia) : null);
  const sala = ERP_NAMES[Number(erp)] || 'la sucursal';

  const [texto, setTexto, aplicado] = useBusqueda();
  const [resultados, setResultados] = useState([]);
  const [producto, setProducto] = useState(null);
  const [actual, setActual] = useState(null);
  const [ventas, setVentas] = useState(null);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (producto || aplicado.trim().length < 2) { setResultados([]); return undefined; }
    let vivo = true;
    buscarProductosMinMax(aplicado.trim(), 20).then((r) => { if (vivo) setResultados(r.filas || []); });
    return () => { vivo = false; };
  }, [aplicado, producto]);

  useEffect(() => {
    if (!producto || !erp) { setActual(null); setVentas(null); return undefined; }
    let vivo = true;
    setActual(undefined); setVentas(null);
    fetchCurrentStockParams(producto.id, erp).then(({ data }) => {
      if (!vivo) return;
      const ef = effectiveMinMaxPair(data);
      setActual({ min: ef.min, max: ef.max, sales6m: data?.units_sold_6m ?? data?.draft_units_sold ?? null, oculto: data?.is_hidden === true });
    });
    fetchMinMaxContextoVenta(producto.id, erp).then((c) => { if (vivo) setVentas(c); });
    return () => { vivo = false; };
  }, [producto, erp]);
  // Las presentaciones del producto: cuántas unidades trae la caja y el
  // equivalente en cajas de cada número, como el formulario del portal.
  const [pres, setPres] = useState([]);
  useEffect(() => {
    if (!producto) { setPres([]); return undefined; }
    let vivo = true;
    Promise.resolve(fetchProductPreciosForMinMax(producto.id)).then(({ data }) => { if (vivo) setPres(presentacionesDelProducto(data)); }).catch(() => {});
    return () => { vivo = false; };
  }, [producto]);
  const caja = presentacionDominante(pres);
  const enCajas = (n) => equivalenteEnCajas(n, pres);

  const nMin = min.trim() === '' ? null : Number.parseInt(min, 10);
  const nMax = max.trim() === '' ? null : Number.parseInt(max, 10);
  const cargando = actual === undefined;
  const oculto = !!actual?.oculto;
  const parValido = nMin != null && nMax != null && parMinMaxValido(nMin, nMax);
  const sinCambio = !cargando && !oculto && parValido && ajusteSinCambio(actual, nMin, nMax);
  const exigen = useMemo(() => (cargando || !parValido ? [] : motivosQueExigenExplicacion(actual, nMin, nMax)), [cargando, parValido, actual, nMin, nMax]);
  const puedeEnviar = !!producto && erp && !cargando && !oculto && parValido && !sinCambio && (!exigen.length || motivo.trim());

  const enviar = async () => {
    setEnviando(true); trabajando('Enviando el ajuste…');
    try {
      const { error } = await insertMinMaxChangeRequest(solicitudDeMinMax({
        producto, erpSucursalId: erp, actual, ventas, min: nMin, max: nMax, motivo, usuario: user,
      }));
      if (error) throw error;
      listo('Ajuste enviado', `${producto.nombre} · ${sala}: MIN ${nMin} · MAX ${nMax}`);
      router.dismissTo('/solicitudes');
    } catch (e) {
      fallo('No se pudo enviar', mensajeDeMinMax(e?.message ?? '', sala));
    } finally {
      setEnviando(false);
    }
  };

  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: erpElegido, porDefecto: erpElegido, onCambiar: setErp,
    opciones: opcionesSala.map((e) => ({ id: String(e), label: ERP_NAMES[e] })) }] : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ajuste de Mín·Máx', headerLargeTitle: !producto }} />
      {todas ? <MenuDeFiltros grupos={grupos} /> : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {!erp ? <Aviso tono="freno" texto="Tu usuario no tiene una sala con inventario." /> : null}
          {!producto ? (
            <Seccion titulo={`Producto · ${sala}`}>
              <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Nombre o principio activo" autoCorrect={false} />
              {resultados.map((p) => (
                <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setProducto(p); }}
                  style={({ pressed }) => ({ paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>
                  {p.principio_activo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{p.principio_activo}</Text> : null}
                </Pressable>
              ))}
            </Seccion>
          ) : (
            <>
              <Pressable onPress={() => { setProducto(null); setMin(''); setMax(''); setMotivo(''); }}>
                <Text style={{ color: colorSistema.acento, fontSize: 15, marginHorizontal: 4 }}>‹ Otro producto</Text>
              </Pressable>
              <Seccion titulo={sala}>
                <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{producto.nombre}</Text>
                {cargando ? <Text style={{ color: colorSistema.texto2 }}>Cargando…</Text> : (
                  <>
                    <Dato primero rotulo="MIN · MAX de hoy" valor={actual?.min != null ? `${actual.min} · ${actual.max}${enCajas(actual.min) || enCajas(actual.max) ? `  (${enCajas(actual.min) || '—'} · ${enCajas(actual.max) || '—'})` : ''}` : 'Sin par todavía'} fuerte />
                    <Dato rotulo="Vendido este mes" valor={ventas?.unidadesMes ?? '—'} />
                    <Dato rotulo="Vendido en 6 meses" valor={actual?.sales6m ?? '—'} />
                    <Dato rotulo="En existencia" valor={ventas?.existencia != null ? `${ventas.existencia}${enCajas(ventas.existencia) ? `  ${enCajas(ventas.existencia)}` : ''}` : '—'} />
                    <Dato rotulo="Última venta" valor={ventas?.ultimaVenta ? fmtUltimaVenta(ventas.ultimaVenta) : '—'} />
                  </>
                )}
              </Seccion>
              {oculto ? <Aviso tono="freno" texto={`Este producto está oculto en ${sala}: primero hay que mostrarlo de nuevo en Min/Max.`} /> : (
                <>
                  <Seccion titulo="Lo que propones (en unidades)" pie={caja ? `${caja.factor} unidades = 1 ${caja.tipo?.trim() || 'caja'}.${caja.descripcion ? ` Factor calculado: ${caja.descripcion}.` : ''}` : null}>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Numero rotulo="MIN" valor={min} onCambiar={setMin} />
                      <Numero rotulo="MAX" valor={max} onCambiar={setMax} />
                    </View>
                    {nMin != null && nMax != null && !parValido ? (
                      <Aviso tono="cuidado" texto={nMin === 0 ? 'Con el MIN en 0, el MAX sólo puede ser 0 (deja de reponerse) o 1.' : 'El MAX debe ser mayor que el MIN.'} />
                    ) : null}
                    {sinCambio ? <Aviso tono="cuidado" texto={`${sala} ya está en MIN ${nMin} · MAX ${nMax}: no cambiaría nada.`} /> : null}
                  </Seccion>
                  <Seccion titulo={exigen.length ? 'Motivo (obligatorio)' : 'Motivo (opcional)'}>
                    {exigen.map((m) => <Aviso key={m} tono="cuidado" texto={m} />)}
                    <Campo value={motivo} onChangeText={setMotivo} placeholder="Por qué cambia" />
                  </Seccion>
                  <BotonGrande texto="Enviar ajuste" color={MARCA.azul} deshabilitado={enviando || !puedeEnviar} onPress={enviar} />
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
