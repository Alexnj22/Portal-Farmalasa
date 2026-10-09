// Crear o editar una cotización, NATIVO — el formulario de `CotizacionesView`.
// `?id=` edita una existente; sin él, crea.
//
// Todo lo que decide el contenido sale del núcleo (`cotizacion`): los niveles
// de precio que el cargo puede ofrecer (`nivelesPermitidos`), cómo cambia un
// renglón al elegir otra presentación o nivel (`actualizarRenglon`), las filas
// que se guardan y la fila de la cotización (`payloadDeCotizacion`). Guarda con
// `crearCotizacion`/`editarCotizacion`, que piden el número y dejan la bitácora.
//
// El teléfono no baja todo el catálogo de precios: al agregar un producto pide
// los suyos (`fetchPreciosParaCotizar`).
//
// La cotización a medio armar se guarda sola mientras se CREA (como el portal):
// la sesión se cierra por inactividad y diez renglones son varios minutos.
// Editando no: la fila de la base es la verdad.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  crearCotizacion, editarCotizacion, fetchCotizacionItems, fetchPreciosParaCotizar, searchCustomersByName, searchProductsActive,
} from '@nucleo/data/cotizaciones';
import {
  FORMAS_DE_PAGO_COTIZACION, TIPOS_DE_DOCUMENTO_COTIZACION, UMBRAL_RETENCION, actualizarRenglon, desgloseConIva,
  mapaDePreciosDeCotizacion, nivelesPermitidos, payloadDeCotizacion, renglonDesdeGuardado, renglonNuevo,
  renglonesParaGuardar, totalesDeCotizacion,
} from '@nucleo/utils/cotizacion';
import { buildPrintHTML } from '@nucleo/utils/cotizacionPapel';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { registrarEgreso } from '@nucleo/data/egreso';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import { cotizacionGuardada, guardarCotizaciones } from '../../componentes/cotizaciones/cache';
import { compartirPdf } from '../../componentes/pdf';
import { fallo, listo } from '../../componentes/Progreso';
import Tocable from '../../componentes/Tocable';

const BORRADOR = 'cotizacion_nueva';
const sinGuion = (html) => html.replace(/<script>[\s\S]*?<\/script>/g, '');

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

// Un selector que abre la hoja de opciones del sistema.
function Eleccion({ rotulo, valor, opciones, onCambiar }) {
  const elegir = () => {
    Haptics.selectionAsync().catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions(
      { title: rotulo, options: [...opciones.map((o) => o.label), 'Cancelar'], cancelButtonIndex: opciones.length },
      (i) => { if (i < opciones.length) onCambiar(opciones[i].value); },
    );
  };
  const actual = opciones.find((o) => String(o.value) === String(valor));
  return (
    <Tocable onPress={elegir} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 40, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{actual?.label ?? 'Elegir'}  ›</Text>
    </Tocable>
  );
}

function Renglon({ item, idx, presentaciones, niveles, esCCF, onCambiar, onQuitar }) {
  const pres = presentaciones.find((p) => String(p.presentacion_id) === String(item.presentacionId));
  const opcionesPres = presentaciones.map((p) => ({ value: String(p.presentacion_id), label: p.desc }));
  const opcionesNivel = niveles.filter((n) => pres && parseFloat(pres[n.key] || 0) > 0)
    .map((n) => ({ value: n.key, label: `${n.label} — ${formatMoney(pres[n.key])}` }));
  const d = desgloseConIva(item.precioUnitario, item.cantidad);
  const paso = (delta) => { Haptics.selectionAsync().catch(() => {}); onCambiar('cantidad', Math.max(0, (Number(item.cantidad) || 0) + delta)); };
  return (
    <Seccion titulo={`${idx + 1} · ${item.productName}`}>
      {opcionesPres.length ? (
        <>
          <Eleccion rotulo="Presentación" valor={item.presentacionId} opciones={opcionesPres} onCambiar={(v) => onCambiar('presentacionId', v)} />
          <Eleccion rotulo="Precio" valor={item.priceType} opciones={opcionesNivel} onCambiar={(v) => onCambiar('priceType', v)} />
        </>
      ) : <Aviso tono="cuidado" texto="Este producto no tiene precios activos: pon el precio a mano." />}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Cantidad</Text>
        <Tocable onPress={() => paso(-1)} hitSlop={6} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.18)' }}>
          <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '600' }}>−</Text>
        </Tocable>
        <Campo multiline={false} keyboardType="decimal-pad" value={String(item.cantidad)} onChangeText={(v) => onCambiar('cantidad', v)}
          style={{ width: 72, textAlign: 'center', fontWeight: '700' }} />
        <Tocable onPress={() => paso(1)} hitSlop={6} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.18)' }}>
          <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '600' }}>+</Text>
        </Tocable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Precio unitario (con IVA)</Text>
        <Campo multiline={false} keyboardType="decimal-pad" value={String(item.precioUnitario)} onChangeText={(v) => onCambiar('precioUnitario', v)}
          style={{ width: 110, textAlign: 'right' }} />
      </View>
      {esCCF ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
          {`Sin IVA ${formatMoney(d.unitSinIva)} c/u · subtotal sin IVA ${formatMoney(d.subtotalSinIva)} · IVA ${formatMoney(d.subtotalIva)}`}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Tocable onPress={onQuitar} hitSlop={8}><Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Quitar</Text></Tocable>
        <Text style={{ flex: 1, textAlign: 'right', color: colorSistema.texto, fontSize: 17, fontWeight: '800' }}>{formatMoney(item.subtotal)}</Text>
      </View>
    </Seccion>
  );
}

// Buscar con resultados debajo: clientes o productos, contra el servidor.
function Buscador({ placeholder, buscar, render, onElegir }) {
  const [texto, setTexto] = useState('');
  const termino = useTextoRebotado(texto).trim();
  const [res, setRes] = useState({ filas: [], cargando: false, parecidos: false });
  const peticion = useRef(0);
  useEffect(() => {
    if (termino.length < 2) { setRes({ filas: [], cargando: false, parecidos: false }); return; }
    const mia = ++peticion.current;
    setRes((r) => ({ ...r, cargando: true }));
    buscar(termino).then(({ data, aproximado }) => {
      if (mia === peticion.current) setRes({ filas: data || [], cargando: false, parecidos: !!aproximado });
    });
  }, [termino, buscar]);
  return (
    <View style={{ gap: 6 }}>
      <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder={placeholder} autoCorrect={false} />
      {res.cargando ? <ActivityIndicator /> : null}
      {res.parecidos && res.filas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Sin coincidencia exacta: se muestran los parecidos.</Text> : null}
      {res.filas.slice(0, 8).map((f, i) => (
        <Tocable key={f.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); onElegir(f); setTexto(''); }}
          style={({ pressed }) => ({ paddingVertical: 9, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
          {render(f)}
        </Tocable>
      ))}
    </View>
  );
}

export default function NuevaCotizacion() {
  const { id: editarId } = useLocalSearchParams();
  const edita = !!editarId;
  const { user, maxPriceLevel, hasPermission } = useAuth();
  const puede = hasPermission('cotizaciones', 'can_edit');
  const branches = useStaffStore((s) => s.branches);
  const salas = useMemo(() => (branches || []).filter((b) => b.type === 'FARMACIA'), [branches]);
  const niveles = useMemo(() => nivelesPermitidos(maxPriceLevel), [maxPriceLevel]);

  const [fecha, setFecha] = useState(hoySV());
  const [cliente, setCliente] = useState(null);
  const [docType, setDocType] = useState('COF');
  const [paymentType, setPaymentType] = useState('EFECTIVO');
  const [retencion, setRetencion] = useState(false);
  const [notas, setNotas] = useState('');
  const [items, setItems] = useState([]);
  const [salaId, setSalaId] = useState(user?.branchId ? String(user.branchId) : '');
  const [precios, setPrecios] = useState({});
  const [cargando, setCargando] = useState(edita);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const repuesto = useRef(false);

  // Los precios de los productos que ya están en la cotización (al editar o al
  // reponer un borrador) se piden una vez cada uno.
  const asegurarPrecios = useCallback(async (ids) => {
    const faltan = [...new Set(ids.map(String))].filter((pid) => !(pid in precios));
    if (!faltan.length) return;
    const lotes = await Promise.all(faltan.map((pid) => fetchPreciosParaCotizar(pid)));
    const filas = lotes.flatMap((r) => r.data || []);
    const mapa = mapaDePreciosDeCotizacion(filas);
    setPrecios((p) => { const n = { ...p }; faltan.forEach((pid) => { n[pid] = mapa[pid] || []; }); return n; });
  }, [precios]);

  // Editar: la cotización y sus renglones, de la base.
  useEffect(() => {
    if (!edita) return;
    const c = cotizacionGuardada(editarId);
    (async () => {
      const { data, error: e } = await fetchCotizacionItems(editarId);
      if (e) { setError(mensajeAmigable(e)); setCargando(false); return; }
      if (c) {
        setFecha(c.fecha); setDocType(c.document_type); setPaymentType(c.payment_type);
        setRetencion(!!c.applies_retention); setNotas(c.notes || '');
        setSalaId(c.branch_id ? String(c.branch_id) : '');
        setCliente(c.customer_id ? { id: c.customer_id, name: c.customer_name, nit: c.customer_nit } : null);
      }
      const renglones = (data || []).map(renglonDesdeGuardado);
      setItems(renglones);
      await asegurarPrecios(renglones.map((r) => r.productId));
      setCargando(false);
    })();
  }, [edita, editarId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Crear: reponer el borrador una vez.
  useEffect(() => {
    if (edita || repuesto.current) return;
    repuesto.current = true;
    const b = loadDraft(BORRADOR);
    if (!b || !Array.isArray(b.items) || !b.items.length) return;
    Alert.alert('Cotización sin terminar', `Tienes una de ${b.items.length} producto${b.items.length === 1 ? '' : 's'} a medio armar.`, [
      { text: 'Empezar de nuevo', style: 'destructive', onPress: () => clearDraft(BORRADOR) },
      { text: 'Seguirla', onPress: () => {
        if (b.fecha) setFecha(b.fecha);
        if (b.cliente) setCliente(b.cliente);
        if (b.docType) setDocType(b.docType);
        if (b.paymentType) setPaymentType(b.paymentType);
        setRetencion(!!b.retencion); setNotas(b.notas || ''); setItems(b.items);
        if (b.salaId) setSalaId(b.salaId);
        asegurarPrecios(b.items.map((r) => r.productId));
      } },
    ]);
  }, [edita]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (edita || !items.length) return;
    saveDraft(BORRADOR, { fecha, cliente, docType, paymentType, retencion, notas, items, salaId });
  }, [edita, fecha, cliente, docType, paymentType, retencion, notas, items, salaId]);

  const t = useMemo(() => totalesDeCotizacion(items, retencion), [items, retencion]);
  const esCCF = docType === 'CCF';
  const sugerirRetencion = esCCF && t.base > UMBRAL_RETENCION && !retencion;

  const agregar = async (producto) => {
    const { data } = await fetchPreciosParaCotizar(producto.id);
    const lista = mapaDePreciosDeCotizacion(data || [])[String(producto.id)] || [];
    setPrecios((p) => ({ ...p, [String(producto.id)]: lista }));
    setItems((prev) => [...prev, renglonNuevo(producto, lista)]);
  };
  const cambiar = (rid, campo, valor) => setItems((prev) => prev.map((it) => (it._id !== rid ? it
    : actualizarRenglon(it, campo, valor, precios[it.productId] || []))));
  const quitar = (rid) => setItems((prev) => prev.filter((it) => it._id !== rid));

  const guardar = async () => {
    if (!items.length) { setError('Agrega al menos un producto.'); return; }
    setError(null); setGuardando(true);
    try {
      const payload = payloadDeCotizacion({
        fecha, cliente, docType, paymentType, appliesRetention: retencion, notes: notas, items, branchId: salaId, user,
      });
      const filas = renglonesParaGuardar(items);
      const { data: cot, error: e } = edita
        ? await editarCotizacion(editarId, { ...payload, updated_at: new Date().toISOString() }, filas)
        : await crearCotizacion(payload, filas);
      if (e) throw e;
      if (!edita) clearDraft(BORRADOR);
      guardarCotizaciones([cot]);
      listo(edita ? 'Cotización actualizada' : `Cotización ${cot.numero} creada`, '');
      // Editando se vuelve al detalle (que se relee); creando, se abre la nueva.
      const ir = () => (edita ? router.back() : router.replace({ pathname: '/cotizacion/[id]', params: { id: String(cot.id) } }));
      if (!hasPermission('cotizaciones_descargar')) { ir(); return; }
      Alert.alert(edita ? 'Cotización actualizada' : `Cotización ${cot.numero}`, '¿La compartes con el cliente?', [
        { text: 'Ahora no', style: 'cancel', onPress: ir },
        { text: 'Compartir PDF', onPress: async () => {
          const { data: renglones } = await fetchCotizacionItems(cot.id);
          const sala = salas.find((s) => String(s.id) === String(cot.branch_id))?.name ?? '';
          const ok = await compartirPdf({ html: sinGuion(buildPrintHTML(cot, renglones || [], sala)), nombre: `Cotización ${cot.numero} ${cot.customer_name || ''}` });
          if (ok) registrarEgreso('cotizaciones', { formato: 'pdf', filas: 1, detalle: { cotizacion: cot.id, via: 'app' } });
          ir();
        } },
      ]);
    } catch (e) {
      setError(mensajeAmigable(e, 'No se pudo guardar.'));
      fallo('No se pudo guardar', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  if (!puede) return <View style={{ padding: 16 }}><Aviso tono="freno" texto="Tu cargo no puede crear ni editar cotizaciones." /></View>;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: edita ? 'Editar cotización' : 'Nueva cotización', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {cargando ? <ActivityIndicator style={{ marginTop: 40 }} /> : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
            contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
            <Seccion titulo="Datos generales">
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Fecha</Text>
                <Fecha valor={fecha} onCambiar={setFecha} />
              </View>
              <Eleccion rotulo="Documento" valor={docType} opciones={TIPOS_DE_DOCUMENTO_COTIZACION}
                onCambiar={(v) => { setDocType(v); if (v === 'COF') setRetencion(false); }} />
              <Eleccion rotulo="Forma de pago" valor={paymentType} opciones={FORMAS_DE_PAGO_COTIZACION} onCambiar={setPaymentType} />
              {salas.length > 1 ? (
                <Eleccion rotulo="Sucursal" valor={salaId} opciones={salas.map((s) => ({ value: String(s.id), label: s.name }))} onCambiar={setSalaId} />
              ) : null}
            </Seccion>

            <Seccion titulo="Cliente">
              {cliente ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{cliente.name}</Text>
                    {cliente.nit ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`NIT ${cliente.nit}`}</Text> : null}
                  </View>
                  <Tocable onPress={() => setCliente(null)} hitSlop={8}><Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cambiar</Text></Tocable>
                </View>
              ) : (
                <>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Consumidor final, o busca la ficha del cliente.</Text>
                  <Buscador placeholder="Nombre, DUI o NIT" buscar={searchCustomersByName}
                    onElegir={(c) => { setCliente({ id: c.id, name: c.name, nit: c.nit }); if (c.nit) setDocType('CCF'); }}
                    render={(c) => (
                      <View>
                        <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{c.name}</Text>
                        {c.nit ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`NIT ${c.nit}`}</Text> : null}
                      </View>
                    )} />
                </>
              )}
            </Seccion>

            {items.map((it, i) => (
              <Renglon key={it._id} item={it} idx={i} presentaciones={precios[it.productId] || []} niveles={niveles} esCCF={esCCF}
                onCambiar={(campo, valor) => cambiar(it._id, campo, valor)} onQuitar={() => quitar(it._id)} />
            ))}

            <Seccion titulo="Agregar producto">
              <Buscador placeholder="Nombre del producto" buscar={searchProductsActive} onElegir={agregar}
                render={(p) => <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>} />
            </Seccion>

            <Seccion titulo="Notas">
              <Rotulo texto="Opcional — aparecen en el papel" />
              <Campo value={notas} onChangeText={setNotas} placeholder="Condiciones, vigencia, entrega…" style={{ minHeight: 70 }} />
            </Seccion>

            {items.length ? (
              <Seccion titulo="Totales">
                <Dato primero rotulo="Subtotal s/IVA" valor={formatMoney(t.base)} />
                <Dato rotulo="IVA 13%" valor={formatMoney(t.iva)} />
                {esCCF ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 6 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Retención 1% (gran contribuyente)</Text>
                    <Switch value={retencion} onValueChange={setRetencion} />
                  </View>
                ) : null}
                {retencion ? <Dato rotulo="Retención 1%" valor={`−${formatMoney(t.retention)}`} /> : null}
                <Dato rotulo="Total a pagar" valor={formatMoney(t.total)} fuerte />
              </Seccion>
            ) : null}
            {sugerirRetencion ? <Aviso tono="cuidado" texto={`La base pasa de ${formatMoney(UMBRAL_RETENCION)}: si el cliente es gran contribuyente, aplica la retención del 1%.`} /> : null}
            {error ? <Aviso tono="freno" texto={error} /> : null}
            <BotonGrande texto={guardando ? 'Guardando…' : edita ? 'Guardar cambios' : 'Crear cotización'} onPress={guardar} deshabilitado={guardando || !items.length} />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </>
  );
}
