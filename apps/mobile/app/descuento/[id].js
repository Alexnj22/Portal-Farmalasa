// Corregir un descuento, NATIVO — `DescuentoModal` del portal. Acá no se crea:
// un descuento nace al crear su promoción. Corregir sí, porque hay descuentos
// hechos directo en la caja sin promoción en el portal.
//
// Lo que este formulario agrega sobre el de la caja: mientras se escribe, en
// cuánto queda el precio de cada producto, y en rojo el que caería bajo el
// costo con cuánto se pierde por unidad (`cuentaDelProducto`), ordenados por el
// que más pierde (`ordenarPorPerdida`). El solape con otro descuento y el
// alcance de sala los decide el servidor: si avisa, se ofrece «Guardar de todos
// modos». Forma, validación y lo que se manda salen del núcleo, los mismos del
// portal. Guarda borrador con el id en la clave.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchDescuento, fetchPreciosDeProductos, guardarDescuento } from '@nucleo/data/descuentos';
import { buscarProductosMinMax } from '@nucleo/data/minmaxRequests';
import {
  TIPOS_DE_DESCUENTO, cuentaDelProducto, formaDeDescuento, ordenarPorPerdida, payloadDeDescuento, problemasAlCorregirDescuento,
} from '@nucleo/utils/promocionesUtils';
import { SALAS_VENTA } from '@nucleo/utils/metasUtils';
import { hoySV } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { leer } from '../../componentes/comercial/elegido';
import { volver } from '../../componentes/volver';

export default function CorregirDescuento() {
  const { id } = useLocalSearchParams();
  const alcanceTodo = useMemo(() => leer('descuento-alcance') === true, []);
  const branches = useStaffStore((s) => s.branches);
  const salas = useMemo(() => SALAS_VENTA.map((sid) => (branches || []).find((b) => Number(b.id) === sid)).filter(Boolean), [branches]);
  const clave = `descuento_${id}`;
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [precios, setPrecios] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [texto, setTexto] = useState('');
  const q = useTextoRebotado(texto, 300).trim();
  const [resultados, setResultados] = useState([]);

  useEffect(() => {
    let vivo = true;
    fetchDescuento(id)
      .then((d) => { if (vivo) setF({ ...formaDeDescuento(d, hoySV()), ...(loadDraft(clave) || {}) }); })
      .catch((e) => { if (vivo) setError(mensajeAmigable(e, 'No se pudo cargar el descuento.')); });
    return () => { vivo = false; };
  }, [id, clave]);
  useEffect(() => { if (f) saveDraft(clave, f); }, [clave, f]);

  const ids = useMemo(() => (f?.productos || []).map((p) => p.id).join(','), [f]);
  useEffect(() => {
    if (!ids) { setPrecios([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- sin productos no hay precios
    let vivo = true;
    fetchPreciosDeProductos(ids.split(',').map(Number)).then((r) => { if (vivo) setPrecios(r || []); }).catch(() => { if (vivo) setPrecios([]); });
    return () => { vivo = false; };
  }, [ids]);
  useEffect(() => {
    if (q.length < 2) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- búsqueda vacía
    let vivo = true;
    buscarProductosMinMax(q, 20).then((r) => { if (vivo) setResultados(r.filas || []); });
    return () => { vivo = false; };
  }, [q]);

  const porProducto = useMemo(() => new Map((precios || []).map((p) => [Number(p.id), p])), [precios]);
  const monto = Number(f?.monto);
  const enOrden = useMemo(() => (f ? ordenarPorPerdida(f.productos, porProducto, f.tipo, monto) : []), [f, porProducto, monto]);
  const problemas = useMemo(() => (f ? problemasAlCorregirDescuento(f, alcanceTodo) : []), [f, alcanceTodo]);
  const set = (k) => (v) => { setAvisos([]); setF((x) => ({ ...x, [k]: v })); };
  const agregar = (p) => { setTexto(''); setAvisos([]); setF((x) => (x.productos.some((y) => y.id === p.id) ? x : { ...x, productos: [...x.productos, { id: p.id, nombre: p.nombre }] })); };
  const quitar = (pid) => { setAvisos([]); setF((x) => ({ ...x, productos: x.productos.filter((p) => p.id !== pid) })); };

  const enviar = async (forzar) => {
    setGuardando(true); trabajando('Guardando…');
    try {
      const r = await guardarDescuento(payloadDeDescuento(f, { id, salaPorDefecto: salas[0]?.id ?? null, forzar }));
      if (r?.avisos) { setAvisos(r.avisos); fallo('Revisa antes de guardar', r.avisos.map((a) => a.texto).join('\n')); setGuardando(false); return; }
      clearDraft(clave);
      listo('Descuento guardado', 'Rige en la caja desde ahora.');
      volver('/promociones');
    } catch (e) { fallo('No se pudo guardar el descuento', mensajeAmigable(e)); }
    setGuardando(false);
  };
  const guardar = (forzar) => Alert.alert(forzar ? 'Guardar de todos modos' : 'Guardar cambios',
    forzar ? 'Cuando dos descuentos toman el mismo producto en las mismas fechas, la venta aplica uno solo y no dice cuál.'
      : `«${f.descripcion.trim()}» cambia el precio en la caja de ${f.productos.length} producto${f.productos.length === 1 ? '' : 's'}.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', style: forzar ? 'destructive' : 'default', onPress: () => enviar(forzar) },
    ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Corregir descuento' }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          {error ? <Aviso tono="freno" texto={error} /> : !f ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
            <>
              <Seccion titulo="Nombre del descuento">
                <Campo multiline={false} placeholder="Cómo se va a reconocer en la lista" value={f.descripcion} onChangeText={set('descripcion')} />
              </Seccion>
              <Seccion titulo="Cómo descuenta">
                <Opciones valor={f.tipo} onCambiar={set('tipo')} opciones={TIPOS_DE_DESCUENTO.map((t) => ({ id: t.value, label: t.label }))} />
                <Campo multiline={false} keyboardType="decimal-pad" placeholder={f.tipo === '%' ? '25' : '1.50'} value={f.monto}
                  onChangeText={(t) => set('monto')(t.replace(',', '.').replace(/[^0-9.]/g, ''))} />
                {f.tipo === '$' && monto > 0 ? <Aviso texto={`Se descuenta ${formatMoney(monto)} por cada unidad. En una venta de 3 unidades son ${formatMoney(monto * 3)}.`} /> : null}
              </Seccion>
              <Seccion titulo="Fechas">
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Desde</Text>
                  <Fecha valor={f.inicio} onCambiar={set('inicio')} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Hasta</Text>
                  <Fecha valor={f.fin || f.inicio} onCambiar={set('fin')} desde={f.inicio} />
                </View>
              </Seccion>
              {alcanceTodo ? (
                <Seccion titulo="Salas">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>En todas las salas</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Sin esto, el descuento vale sólo en la sala que elijas.</Text>
                    </View>
                    <Switch value={f.todas} onValueChange={set('todas')} />
                  </View>
                  {!f.todas ? <Opciones valor={f.branchId} onCambiar={set('branchId')} opciones={salas.map((s) => ({ id: String(s.id), label: s.name }))} /> : null}
                </Seccion>
              ) : null}
              <Seccion titulo={`Productos · ${f.productos.length}`} pie="Primero el que más se pierde. El precio es el más bajo de sus presentaciones y el costo el más alto, con IVA.">
                {enOrden.map((p) => {
                  const c = cuentaDelProducto(porProducto.get(Number(p.id)), f.tipo, monto);
                  return (
                    <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{p.nombre}</Text>
                        <Text style={{ color: c.bajoCosto ? MARCA.rojo : colorSistema.texto2, fontSize: 13 }}>
                          {!c.precio ? 'Sin precio registrado' : `${formatMoney(c.precio)} → ${formatMoney(c.queda)}${c.costo ? ` · cuesta ${formatMoney(c.costo)}` : ''}${c.bajoCosto ? ` · pierde ${formatMoney(c.pierde)} por unidad` : ''}`}
                        </Text>
                      </View>
                      <Pressable onPress={() => quitar(p.id)} hitSlop={8} accessibilityLabel={`Quitar ${p.nombre}`} style={{ minHeight: 40, justifyContent: 'center' }}>
                        <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Quitar</Text>
                      </Pressable>
                    </View>
                  );
                })}
                <Campo multiline={false} placeholder={f.productos.length ? 'Agregar otro producto…' : 'Buscar el producto al que se le va a descontar'} value={texto} onChangeText={setTexto} autoCorrect={false} />
                {resultados.map((p) => {
                  const ya = f.productos.some((x) => x.id === p.id);
                  return (
                    <Pressable key={p.id} disabled={ya} onPress={() => agregar(p)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: ya ? 0.45 : pressed ? 0.6 : 1 })}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15 }} numberOfLines={2}>{`${p.nombre}${ya ? ' · ya está' : ''}`}</Text>
                    </Pressable>
                  );
                })}
              </Seccion>
              {avisos.length ? <Aviso tono="cuidado" texto={avisos.map((a) => a.texto).join('\n')} /> : null}
              <Aviso tono={problemas.length ? 'cuidado' : 'nota'} texto={problemas[0] || 'Empieza a descontar en la fecha de inicio.'} />
              {avisos.length
                ? <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar de todos modos'} color={MARCA.rojo} deshabilitado={guardando} onPress={() => guardar(true)} />
                : <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar cambios'} color={MARCA.azul} deshabilitado={guardando || problemas.length > 0} onPress={() => guardar(false)} />}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
