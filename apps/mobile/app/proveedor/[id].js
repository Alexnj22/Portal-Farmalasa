// La ficha de un proveedor, NATIVO — `FormProveedorDetail` del portal:
//   · contacto que se toca: llamar, WhatsApp, escribir el correo, la dirección
//     (departamento y municipio);
//   · datos fiscales: NIT, NRC, DUI, actividad, el régimen (contribuyente o
//     sujeto excluido, derivado en el servidor), percepción del 1% y
//     retención de renta del 10%;
//   · categoría y su clase contable (costo / gasto), y la deducibilidad del
//     IVA con su estado (sin clasificar / propuesta / confirmada);
//   · compras: documentos, primera y última vez, lo que le debemos y el acceso
//     a sus facturas y a lo pendiente de pago;
//   · condiciones de crédito (días, límite, forma de pago) en Cuentas por
//     pagar, donde también se registra un pago.
// Con `proveedores` · editar, se edita lo mismo que en el portal y con las
// mismas funciones: `updateProveedorManual` (alias, contacto, teléfono 2,
// nombre para cheques, notas, activo, percepción, retención),
// `setProveedorCategoria` y `setProveedorClasificacionFiscal`.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, KeyboardAvoidingView, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  fetchProveedorCategorias, fetchProveedoresMaestro, setProveedorCategoria, setProveedorClasificacionFiscal, updateProveedorManual,
} from '@nucleo/data/proveedores';
import { fetchCuentasPorPagar } from '@nucleo/data/cuentasPorPagar';
import { CLASE_LABELS, optionToPercibe, PERCIBE_OPTIONS, percibeToOption, REGIMEN_HINT, REGIMEN_LABELS, telefonoParaMarcar } from '@nucleo/utils/proveedorFicha';
import { CLASIFICACION_OPTIONS, DEDUCIBLE_OPTIONS, ESTADO_CLASIF, SECTOR_OPTIONS, clasificacionLabel, sectorLabel, tipoCostoGastoLabel, tiposCostoGasto } from '@nucleo/utils/f07Catalogos';
import { FORMAS_DE_PAGO } from '@nucleo/utils/cuentasPorPagar';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { guardarProveedores, proveedorGuardado } from '../../componentes/compras/proveedores';
import { fallo, listo } from '../../componentes/Progreso';

const fecha = (d) => (d ? fechaTexto(d, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const COLOR_ESTADO = { pendiente: MARCA.ambar, propuesta: MARCA.azulClaro, confirmada: MARCA.verde };

function Contacto({ icono, texto, onPress }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ flex: 1, minHeight: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 4,
        backgroundColor: 'rgba(59,130,246,0.18)', opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ fontSize: 20 }}>{icono}</Text>
      <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function Proveedor() {
  const { id } = useLocalSearchParams();
  const canEdit = useAuth().hasPermission('proveedores', 'can_edit');
  const [p, setP] = useState(() => proveedorGuardado(id));
  const [categorias, setCategorias] = useState([]);
  const [deuda, setDeuda] = useState(null);
  const [error, setError] = useState(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState(null);
  const [fiscal, setFiscal] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async (forzar = false) => {
    try {
      if (forzar || !proveedorGuardado(id)) guardarProveedores(await fetchProveedoresMaestro());
      const x = proveedorGuardado(id);
      setP(x);
      if (!x) { setError('No se encontró el proveedor.'); return; }
      const [c, cxp] = await Promise.all([fetchProveedorCategorias(), x.nit ? fetchCuentasPorPagar(null) : Promise.resolve({ filas: [] })]);
      setCategorias(c.data || []);
      setDeuda((cxp.filas || []).find((f) => f.emisor_nit === x.nit) ?? false);
    } catch (e) { setError(mensajeAmigable(e)); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const categoria = useMemo(() => categorias.find((c) => String(c.id) === String(p?.categoria_id)), [categorias, p]);
  const tel = telefonoParaMarcar(p?.telefono);
  const tel2 = telefonoParaMarcar(p?.telefono2);

  const abrirEdicion = () => {
    setForm({
      alias: p.alias || '', contacto_nombre: p.contacto_nombre || '', telefono2: p.telefono2 || '', nombre_cheques: p.nombre_cheques || '',
      notas: p.notas || '', activo: p.activo !== false, percibe: percibeToOption(p.percibe_1_override), retiene_renta: !!p.retiene_renta,
    });
    setFiscal({
      iva_deducible: p.iva_deducible == null ? null : (p.iva_deducible ? 'si' : 'no'),
      f07_clasificacion: p.f07_clasificacion != null ? String(p.f07_clasificacion) : null,
      f07_sector: p.f07_sector != null ? String(p.f07_sector) : null,
      f07_tipo_costo_gasto: p.f07_tipo_costo_gasto != null ? String(p.f07_tipo_costo_gasto) : null,
    });
    setEditando(true);
  };
  const cambiar = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const guardar = async () => {
    setOcupado(true);
    try {
      await updateProveedorManual(p.id, {
        alias: form.alias.trim(), contacto_nombre: form.contacto_nombre.trim(), telefono2: form.telefono2.trim(),
        nombre_cheques: form.nombre_cheques.trim(), notas: form.notas.trim(), activo: form.activo,
        percibe_1_override: optionToPercibe(form.percibe), retiene_renta: form.retiene_renta,
      }, { nombre: p.nombre, desde: 'app' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Ficha guardada', p.alias || p.nombre);
      setEditando(false);
      cargar(true);
    } catch (e) { fallo('No se guardó', mensajeAmigable(e)); }
    finally { setOcupado(false); }
  };
  const guardarFiscal = async () => {
    if (!fiscal.iva_deducible) { fallo('Falta un dato', 'Elige si da crédito fiscal.'); return; }
    setOcupado(true);
    try {
      const deducible = fiscal.iva_deducible === 'si';
      // La misma forma que el portal: números, y la operación gravada sólo si
      // da crédito fiscal.
      await setProveedorClasificacionFiscal(p.id, {
        iva_deducible: deducible,
        f07_clasificacion: fiscal.f07_clasificacion ? Number(fiscal.f07_clasificacion) : null,
        f07_sector: fiscal.f07_sector ? Number(fiscal.f07_sector) : null,
        f07_tipo_costo_gasto: fiscal.f07_tipo_costo_gasto ? Number(fiscal.f07_tipo_costo_gasto) : null,
        f07_tipo_operacion: deducible ? 1 : null,
      }, { nombre: p.nombre, desde: 'app' });
      listo('Clasificación guardada', 'Queda confirmada con tu nombre.');
      cargar(true);
    } catch (e) { fallo('No se guardó', mensajeAmigable(e, 'No se pudo guardar la clasificación')); }
    finally { setOcupado(false); }
  };
  const elegirCategoria = () => {
    const opciones = [...categorias.map((c) => `${c.nombre} · ${CLASE_LABELS[c.clase] ?? c.clase}`), 'Sin categoría', 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Categoría', message: 'Su clase contable sale de la categoría.', options: opciones, destructiveButtonIndex: opciones.length - 2, cancelButtonIndex: opciones.length - 1 },
      (i) => { if (i < categorias.length) ponerCategoria(categorias[i].id); else if (i === opciones.length - 2) ponerCategoria(null); },
    );
  };
  const ponerCategoria = async (cid) => {
    try { await setProveedorCategoria(p.id, cid, { nombre: p.nombre, desde: 'app' }); listo('Categoría guardada', ''); cargar(true); }
    catch (e) { fallo('No se guardó', mensajeAmigable(e, 'No se pudo guardar la categoría')); }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Proveedor', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          {error ? <Aviso tono="freno" texto={error} /> : null}
          {!p && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
          {p ? (
            <>
              <View style={{ gap: 6, marginHorizontal: 4 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{p.alias || p.nombre_comercial || p.nombre}</Text>
                {(p.alias || p.nombre_comercial) ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{p.nombre}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {p.categoria_nombre ? <Pildora texto={p.categoria_nombre} color={MARCA.azulClaro} /> : <Pildora texto="Sin categoría" color={MARCA.ambar} />}
                  {p.clasificacion_estado ? <Pildora texto={`IVA: ${ESTADO_CLASIF[p.clasificacion_estado]?.label ?? p.clasificacion_estado}`} color={COLOR_ESTADO[p.clasificacion_estado] ?? colorSistema.texto2} /> : null}
                  {p.activo === false ? <Pildora texto="Inactivo" color={colorSistema.texto2} /> : null}
                  {p.supplier_id ? <Pildora texto="Vinculado" color={MARCA.verde} /> : <Pildora texto="Sin vincular" color={MARCA.ambar} />}
                </View>
              </View>

              {tel || p.correo ? (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {tel ? <Contacto icono="📞" texto="Llamar" onPress={() => Linking.openURL(`tel:+${tel}`)} /> : null}
                  {tel ? <Contacto icono="💬" texto="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${tel}`)} /> : null}
                  {p.correo ? <Contacto icono="✉️" texto="Correo" onPress={() => Linking.openURL(`mailto:${p.correo}`)} /> : null}
                </View>
              ) : null}

              <Seccion titulo="Contacto">
                <Dato primero rotulo="Teléfono" valor={p.telefono || '—'} />
                {p.telefono2 ? <Dato rotulo="Teléfono 2" valor={p.telefono2} /> : null}
                <Dato rotulo="Correo" valor={p.correo || '—'} />
                {p.contacto_nombre ? <Dato rotulo="Persona de contacto" valor={p.contacto_nombre} /> : null}
                <Dato rotulo="Dirección" valor={[p.direccion, p.municipio, p.departamento].filter(Boolean).join(', ') || '—'} />
                {p.nombre_cheques ? <Dato rotulo="Cheques a nombre de" valor={p.nombre_cheques} /> : null}
                {tel2 ? <Pressable onPress={() => Linking.openURL(`tel:+${tel2}`)}><Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Llamar al teléfono 2</Text></Pressable> : null}
              </Seccion>

              <Seccion titulo="Datos fiscales" pie={REGIMEN_HINT[p.regimen_fiscal]}>
                <Dato primero rotulo="NIT" valor={p.nit || '—'} />
                <Dato rotulo="NRC" valor={p.nrc || '—'} />
                {p.dui ? <Dato rotulo="DUI" valor={p.dui} /> : null}
                {p.desc_actividad ? <Dato rotulo="Actividad" valor={p.desc_actividad} /> : null}
                <Dato rotulo="Tipo" valor={REGIMEN_LABELS[p.regimen_fiscal] ?? '—'} />
                <Dato rotulo="Percibe 1%" valor={p.percibe_1 ? 'Sí' : 'No'} />
                <Dato rotulo="Retención de renta 10%" valor={p.retiene_renta ? 'Sí' : 'No'} />
              </Seccion>

              <Seccion titulo="Clasificación">
                <Dato primero rotulo="Categoría" valor={p.categoria_nombre || 'Sin categoría'} />
                <Dato rotulo="Clase contable" valor={categoria ? (CLASE_LABELS[categoria.clase] ?? categoria.clase) : '—'} />
                <Dato rotulo="Da crédito fiscal" valor={p.iva_deducible == null ? 'Sin clasificar' : p.iva_deducible ? 'Sí' : 'No'} />
                {p.f07_clasificacion != null ? <Dato rotulo="Clasificación" valor={clasificacionLabel(p.f07_clasificacion)} /> : null}
                {p.f07_sector != null ? <Dato rotulo="Sector" valor={sectorLabel(p.f07_sector)} /> : null}
                {p.f07_tipo_costo_gasto != null ? <Dato rotulo="Tipo de costo/gasto" valor={tipoCostoGastoLabel(p.f07_tipo_costo_gasto)} /> : null}
                {p.clasificado_por_nombre ? <Dato rotulo="Clasificó" valor={`${p.clasificado_por_nombre}${p.clasificado_at ? ` · ${fecha(String(p.clasificado_at).slice(0, 10))}` : ''}`} /> : null}
                {p.clasificacion_base_legal ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{p.clasificacion_base_legal}</Text> : null}
                {canEdit ? <BotonGrande texto="Cambiar la categoría" borde color={MARCA.azulClaro} onPress={elegirCategoria} /> : null}
              </Seccion>

              <Seccion titulo="Compras">
                <Dato primero rotulo="Documentos recibidos" valor={Number(p.docs_count || 0).toLocaleString('es-SV')} />
                <Dato rotulo="Primera compra" valor={fecha(p.primera_vez_visto)} />
                <Dato rotulo="Última compra" valor={fecha(p.ultima_vez_visto)} />
                {deuda ? <Dato rotulo="Le debemos" valor={formatMoney(deuda.saldo)} fuerte /> : null}
                {deuda && Number(deuda.vencido) > 0 ? <Dato rotulo="Vencido" valor={formatMoney(deuda.vencido)} /> : null}
                <Dato rotulo="Crédito" valor={p.dias_credito != null ? `${p.dias_credito} días${p.limite_credito != null ? ` · hasta ${formatMoney(p.limite_credito)}` : ''}` : 'sin plazo'} />
                {p.forma_pago ? <Dato rotulo="Forma de pago" valor={FORMAS_DE_PAGO.find((f) => f.value === p.forma_pago)?.label ?? p.forma_pago} /> : null}
                {p.notas ? <Text style={{ color: colorSistema.texto, fontSize: 14, marginTop: 4 }}>{`“${p.notas}”`}</Text> : null}
              </Seccion>

              {p.nit ? (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><BotonGrande texto="Sus documentos" borde color={MARCA.azulClaro}
                    onPress={() => router.push({ pathname: '/facturas-compra', params: { busca: p.nit } })} /></View>
                  <View style={{ flex: 1 }}><BotonGrande texto={deuda ? 'Pagar / crédito' : 'Crédito'} color={MARCA.azul}
                    onPress={() => router.push({ pathname: '/cxp-proveedor/[nit]', params: { nit: p.nit, nombre: p.alias || p.nombre } })} /></View>
                </View>
              ) : null}

              {canEdit && !editando ? <BotonGrande texto="Editar la ficha" borde color={MARCA.azulClaro} onPress={abrirEdicion} /> : null}
              {editando && form ? (
                <>
                  <Seccion titulo="Editar la ficha">
                    {[['alias', 'Alias (como se le conoce)'], ['contacto_nombre', 'Persona de contacto'], ['telefono2', 'Teléfono 2'], ['nombre_cheques', 'Nombre para cheques']].map(([k, r]) => (
                      <View key={k} style={{ gap: 4 }}>
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{r}</Text>
                        <Campo multiline={false} value={form[k]} onChangeText={cambiar(k)} keyboardType={k === 'telefono2' ? 'phone-pad' : 'default'} />
                      </View>
                    ))}
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Notas</Text>
                    <Campo value={form.notas} onChangeText={cambiar('notas')} style={{ minHeight: 70 }} />
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Percibe 1%</Text>
                    <Opciones valor={form.percibe} onCambiar={cambiar('percibe')} opciones={PERCIBE_OPTIONS.map((o) => ({ id: o.value, label: o.label }))} />
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Retención de renta 10%</Text>
                      <Switch value={form.retiene_renta} onValueChange={cambiar('retiene_renta')} />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Activo</Text>
                      <Switch value={form.activo} onValueChange={cambiar('activo')} />
                    </View>
                  </Seccion>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}><BotonGrande texto="Cancelar" borde color={colorSistema.texto2} onPress={() => setEditando(false)} /></View>
                    <View style={{ flex: 1 }}><BotonGrande texto={ocupado ? 'Guardando…' : 'Guardar'} deshabilitado={ocupado} onPress={guardar} /></View>
                  </View>

                  <Seccion titulo="Deducibilidad del IVA" pie="Confirmarla queda con tu nombre y la fecha (Art. 65 LIVA, anexo F-07).">
                    <Opciones valor={fiscal.iva_deducible} onCambiar={(v) => setFiscal((f) => ({ ...f, iva_deducible: v }))} opciones={DEDUCIBLE_OPTIONS.map((o) => ({ id: o.value, label: o.label }))} />
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Clasificación</Text>
                    <Opciones valor={fiscal.f07_clasificacion} onCambiar={(v) => setFiscal((f) => ({ ...f, f07_clasificacion: v, f07_tipo_costo_gasto: null }))} opciones={CLASIFICACION_OPTIONS.map((o) => ({ id: o.value, label: o.label }))} />
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Sector</Text>
                    <Opciones valor={fiscal.f07_sector} onCambiar={(v) => setFiscal((f) => ({ ...f, f07_sector: v }))} opciones={SECTOR_OPTIONS.map((o) => ({ id: o.value, label: o.label }))} />
                    {fiscal.f07_clasificacion ? (
                      <>
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Tipo de costo o gasto</Text>
                        <Opciones valor={fiscal.f07_tipo_costo_gasto} onCambiar={(v) => setFiscal((f) => ({ ...f, f07_tipo_costo_gasto: v }))} opciones={tiposCostoGasto(fiscal.f07_clasificacion).map((o) => ({ id: o.value, label: o.label }))} />
                      </>
                    ) : null}
                    <BotonGrande texto={ocupado ? 'Guardando…' : 'Guardar la clasificación'} borde color={MARCA.verde} deshabilitado={ocupado} onPress={guardarFiscal} />
                  </Seccion>
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
