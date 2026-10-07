// Nueva promoción POR PRODUCTO, NATIVO — `PromocionModal` del portal.
//
// Lo que vale para toda la promoción se pregunta UNA vez (fechas, lote, bono,
// quién paga, salas y reparto) y cada producto nace con eso; se ajusta uno por
// uno sólo si hace falta (la presentación y el lote propio). Nada toca la base
// hasta «Guardar»: la escritura es una sola al final, y el borrador protege lo
// escrito de un cierre de sesión.
//
// Promoción PRIMERO y descuento después: al revés, si la promoción fallara
// quedaría un descuento vivo bajándole el precio a productos reales. Si el
// descuento falla, se reintenta sólo esa mitad (no se crea otra promoción).
// Todo lo que se arma sale del núcleo (`promocionesUtils`), lo mismo del portal.
import { volver } from '../../componentes/volver';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { activarPromocion, crearPromocion, fetchPresentacionesDeProducto, fetchProveedoresDelSistema } from '@nucleo/data/promociones';
import { guardarDescuento } from '@nucleo/data/descuentos';
import { SALAS_VENTA } from '@nucleo/utils/metasUtils';
import {
  descuentoDesdeLaPromocion, destinoDelDescuento, generalDePromocionNuevo, problemasDeLaPromocion,
  problemasDelDescuento, renglonDePromocionNuevo, renglonesParaCrear,
} from '@nucleo/utils/promocionesUtils';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import AgregarProductos from '../../componentes/promociones/AgregarProductos';
import { fallo, listo } from '../../componentes/Progreso';

const BORRADOR = 'promocion_nueva';
const DESC_NUEVO = { activo: false, tipo: '%', monto: '', todas: true, branchId: '', finPropio: '' };

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4 }}>{texto}</Text>;
}
function Numero({ valor, onCambiar, placeholder, ancho = 92 }) {
  return (
    <TextInput value={String(valor ?? '')} onChangeText={onCambiar} keyboardType="decimal-pad" placeholder={placeholder} placeholderTextColor={colorSistema.placeholder}
      style={{ minWidth: ancho, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(127,127,127,0.14)', color: colorSistema.texto, fontSize: 16, textAlign: 'right' }} />
  );
}
function FilaConSwitch({ titulo, detalle, valor, onCambiar }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
      </View>
      <Switch value={!!valor} onValueChange={onCambiar} />
    </View>
  );
}

export default function NuevaPromocionProducto() {
  const { getScope } = useAuth();
  const alcanceTodo = getScope('promociones') === 'ALL';
  const branches = useStaffStore((s) => s.branches);
  const salas = useMemo(() => SALAS_VENTA.map((sid) => (branches || []).find((b) => Number(b.id) === sid)).filter(Boolean), [branches]);
  const [nombre, setNombre] = useState('');
  const [nota, setNota] = useState('');
  const [general, setGeneral] = useState(() => generalDePromocionNuevo(salas));
  const [renglones, setRenglones] = useState([]);
  const [desc, setDesc] = useState(DESC_NUEVO);
  const [activar, setActivar] = useState(false);
  const [proveedores, setProveedores] = useState([]);
  const [abierto, setAbierto] = useState(null);
  const [presentaciones, setPresentaciones] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [promoCreada, setPromoCreada] = useState(null);
  const repuesto = useRef(false);

  useEffect(() => { fetchProveedoresDelSistema().then(setProveedores).catch(() => setProveedores([])); }, []);

  // El borrador: reponerlo una vez, preguntando; guardarlo mientras se escribe.
  useEffect(() => {
    if (repuesto.current) return;
    repuesto.current = true;
    const b = loadDraft(BORRADOR);
    if (!b || !(b.nombre || b.renglones?.length)) return;
    Alert.alert('Promoción sin terminar', `Tienes «${b.nombre || 'sin nombre'}» a medio armar.`, [
      { text: 'Empezar de nuevo', style: 'destructive', onPress: () => clearDraft(BORRADOR) },
      { text: 'Seguirla', onPress: () => {
        setNombre(b.nombre || ''); setNota(b.nota || '');
        setRenglones(Array.isArray(b.renglones) ? b.renglones : []);
        if (b.desc) setDesc((d) => ({ ...d, ...b.desc }));
        if (b.general) setGeneral((g) => ({ ...g, ...b.general }));
      } },
    ]);
  }, []);
  useEffect(() => {
    if (promoCreada || !(nombre || renglones.length)) return;
    saveDraft(BORRADOR, { nombre, nota, renglones, desc, general });
  }, [promoCreada, nombre, nota, renglones, desc, general]);

  // Cambiar lo general lo aplica a los productos que nadie ajustó a mano.
  const cambiarGeneral = (campo, v) => {
    setGeneral((g) => ({ ...g, [campo]: v }));
    setRenglones((rs) => rs.map((r) => (r.ajustado ? r : { ...r, [campo]: v })));
  };
  const cambiarSala = (salaId, marcada) => {
    const aplicar = (o) => ({ ...o, salas: { ...o.salas, [salaId]: marcada }, reparto: { ...o.reparto, [salaId]: marcada ? (o.reparto?.[salaId] ?? '') : '' } });
    setGeneral(aplicar);
    setRenglones((rs) => rs.map((r) => (r.ajustado ? r : aplicar(r))));
  };
  const cambiarReparto = (salaId, v) => {
    setGeneral((g) => ({ ...g, reparto: { ...g.reparto, [salaId]: v } }));
    setRenglones((rs) => rs.map((r) => (r.ajustado ? r : { ...r, reparto: { ...r.reparto, [salaId]: v } })));
  };
  const agregar = (prods) => setRenglones((rs) => {
    const vistos = new Set(rs.map((r) => Number(r.erp_product_id)));
    const nuevos = prods.filter((p) => !vistos.has(Number(p.id))).map((p) => renglonDePromocionNuevo(p, general));
    return nuevos.length ? [...rs, ...nuevos] : rs;
  });
  const cambiarRenglon = (idx, campo, v) => setRenglones((rs) => rs.map((r, i) => (i === idx ? { ...r, [campo]: v, ajustado: true } : r)));
  const quitar = (idx) => setRenglones((rs) => rs.filter((_, i) => i !== idx));

  const abrirRenglon = (idx) => {
    setAbierto((a) => (a === idx ? null : idx));
    const pid = renglones[idx]?.erp_product_id;
    if (pid && !presentaciones[pid]) {
      fetchPresentacionesDeProducto(pid).then((l) => setPresentaciones((p) => ({ ...p, [pid]: l }))).catch(() => setPresentaciones((p) => ({ ...p, [pid]: [] })));
    }
  };
  const elegirPresentacion = (idx) => {
    const lista = presentaciones[renglones[idx]?.erp_product_id] || [];
    const opciones = ['Cualquier presentación', ...lista.map((p) => `${p.etiqueta} · ×${p.factor}`), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Qué ventas cuentan', options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => {
      if (i === 0) cambiarRenglon(idx, 'factor_unidades', null);
      else if (i > 0 && i <= lista.length) cambiarRenglon(idx, 'factor_unidades', Number(lista[i - 1].factor));
    });
  };
  const elegirProveedor = () => {
    const opciones = [...proveedores.map((p) => p.label), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Quién paga el bono', options: opciones, cancelButtonIndex: opciones.length - 1 },
      (i) => { if (i < proveedores.length) cambiarGeneral('supplier_id', proveedores[i].value); });
  };
  const elegirSalaDescuento = (marcadas) => {
    const opciones = [...marcadas.map((s) => s.name), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Sala del descuento', options: opciones, cancelButtonIndex: opciones.length - 1 },
      (i) => { if (i < marcadas.length) setDesc((d) => ({ ...d, branchId: String(marcadas[i].id) })); });
  };

  const marcadas = salas.filter((s) => general.salas?.[s.id]);
  const problemasPromo = promoCreada ? [] : problemasDeLaPromocion(renglones);
  // La sala del descuento tiene que ser una de las marcadas (como el portal).
  const descSalaFuera = desc.activo && marcadas.length > 1 && !desc.todas && desc.branchId && !marcadas.some((x) => String(x.id) === String(desc.branchId));
  const problemasDesc = [...problemasDelDescuento(renglones, desc, alcanceTodo), ...(descSalaFuera ? ['La sala del descuento ya no está entre las salas de la promoción.'] : [])];
  const listo_ = nombre.trim() && renglones.length > 0 && !problemasPromo.length && !problemasDesc.length;
  const vencidos = renglones.filter((r) => r.fin && r.fin < hoySV());
  const proveedorNombre = proveedores.find((p) => p.value === String(general.supplier_id))?.label;

  const mandarDescuento = async (promoId, forzar) => {
    const r = await guardarDescuento({
      ...descuentoDesdeLaPromocion(renglones, desc), descripcion: nombre.trim(),
      ...destinoDelDescuento(salas, general.salas, desc), promocion_id: promoId, forzar,
    });
    if (!r.avisos) return true;
    return new Promise((resolve) => Alert.alert('Revisa el descuento', r.avisos.map((a) => `• ${a.texto}`).join('\n'), [
      { text: 'Corregir', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Guardar de todos modos', onPress: () => mandarDescuento(promoId, true).then(resolve, () => resolve(false)) },
    ]));
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      let promoId = promoCreada;
      if (!promoId) {
        const creada = await crearPromocion({ nombre, nota, renglones: renglonesParaCrear(renglones) });
        promoId = creada?.id ?? null;
        if (activar && promoId) {
          try { await activarPromocion(promoId, true); }
          catch (e) { fallo('Quedó en borrador', `La promoción se creó pero no se pudo activar: ${mensajeAmigable(e, '')}`); }
        }
        if (!desc.activo) { clearDraft(BORRADOR); listo('Promoción creada', activar ? 'Ya está activa.' : 'Quedó en borrador.'); volver('/promociones'); return; }
        setPromoCreada(promoId);
        if (!promoId) { fallo('Sin número de promoción', 'La promoción se creó, pero el descuento no se pudo ligar. Créalo desde Descuentos.'); return; }
      }
      let ok = false;
      try { ok = await mandarDescuento(promoId, false); }
      catch (e) { fallo('El descuento no quedó', `La promoción «${nombre.trim()}» ya está creada; el descuento no: ${mensajeAmigable(e, '')}. Puedes reintentar sólo el descuento.`); return; }
      if (!ok) return;
      clearDraft(BORRADOR);
      listo('Promoción creada', 'Con su descuento en la venta.');
      volver('/promociones');
    } catch (e) {
      fallo('No se pudo crear la promoción', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setGuardando(false);
    }
  };
  const confirmar = () => {
    const texto = [`${renglones.length} producto${renglones.length === 1 ? '' : 's'}`, activar ? 'se activa al guardar' : 'queda en borrador', desc.activo ? 'y baja el precio en la venta' : null].filter(Boolean).join(', ');
    Alert.alert(promoCreada ? 'Reintentar el descuento' : 'Guardar la promoción', promoCreada ? 'La promoción ya existe; sólo se manda el descuento.' : `«${nombre.trim()}»: ${texto}.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: promoCreada ? 'Reintentar' : 'Guardar', onPress: guardar },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Promoción por producto', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          {promoCreada ? <Aviso tono="cuidado" texto="La promoción ya quedó creada. Lo único pendiente es el descuento." /> : null}
          <Seccion titulo="La promoción">
            <Rotulo texto="Nombre" />
            <Campo multiline={false} value={nombre} onChangeText={setNombre} placeholder="El nombre que va a ver la sala" editable={!promoCreada} />
            <Rotulo texto="Nota (opcional)" />
            <Campo value={nota} onChangeText={setNota} placeholder="Lo acordado con el laboratorio" editable={!promoCreada} />
          </Seccion>

          <Seccion titulo="Para todos los productos" pie="Cambiar algo aquí lo aplica a los productos que no ajustaste a mano.">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Desde</Text>
              <Fecha valor={general.inicio} onCambiar={(v) => cambiarGeneral('inicio', v)} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Hasta</Text>
              {general.fin ? <Fecha valor={general.fin} onCambiar={(v) => cambiarGeneral('fin', v)} desde={general.inicio} />
                : <Pressable onPress={() => cambiarGeneral('fin', general.inicio)}><Text style={{ color: colorSistema.acento, fontSize: 16 }}>Elegir</Text></Pressable>}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Lote por producto (unidades)</Text>
              <Numero valor={general.lote_total} onCambiar={(v) => cambiarGeneral('lote_total', v)} placeholder="Sin lote" />
            </View>
            <FilaConSwitch titulo="Paga bono" detalle={general.tiene_bono ? null : 'Sólo se mide cuánto se vende.'} valor={general.tiene_bono} onCambiar={(v) => cambiarGeneral('tiene_bono', v)} />
            {general.tiene_bono ? (
              <>
                <Opciones valor={general.paga} onCambiar={(v) => cambiarGeneral('paga', v)} opciones={[{ id: 'proveedor', label: 'Paga un proveedor' }, { id: 'empresa', label: 'Paga la empresa' }]} />
                {general.paga === 'proveedor' ? (
                  <Pressable onPress={elegirProveedor} style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{proveedorNombre || 'Elegir el proveedor…'}</Text>
                  </Pressable>
                ) : null}
                {[['bono_vendedor', 'Al vendedor ($)'], ['bono_adm', 'Fondo administración ($)'], ['bono_bodega', 'Fondo bodega ($)'], ['unidades_por_bono', 'Cada cuántas unidades']].map(([k, t]) => (
                  <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{t}</Text>
                    <Numero valor={general[k]} onCambiar={(v) => cambiarGeneral(k, v)} />
                  </View>
                ))}
              </>
            ) : null}
          </Seccion>

          <Seccion titulo="Salas" pie={marcadas.length ? 'Si repartes el lote, la suma tiene que dar el lote exacto.' : 'Sin ninguna marcada, aplica en todas.'}>
            {salas.map((s) => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}>
                <Switch value={!!general.salas?.[s.id]} onValueChange={(v) => cambiarSala(s.id, v)} />
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{s.name}</Text>
                {general.salas?.[s.id] ? <Numero valor={general.reparto?.[s.id]} onCambiar={(v) => cambiarReparto(s.id, v)} placeholder="Unidades" ancho={100} /> : null}
              </View>
            ))}
          </Seccion>

          <Seccion titulo={`Productos · ${renglones.length}`}>
            {renglones.map((r, i) => (
              <View key={r.erp_product_id} style={{ gap: 8, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <Pressable onPress={() => abrirRenglon(i)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{r.producto}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {[r.laboratorio, r.lote_total ? `lote ${r.lote_total}` : 'sin lote', r.factor_unidades ? `sólo ×${r.factor_unidades}` : null, r.ajustado ? 'ajustado' : null, r.fin ? `hasta ${fechaTexto(r.fin, { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ')}
                  </Text>
                </Pressable>
                {abierto === i ? (
                  <View style={{ gap: 8 }}>
                    <Pressable onPress={() => elegirPresentacion(i)}>
                      <Text style={{ color: colorSistema.acento, fontSize: 15 }}>{r.factor_unidades ? `Presentación ×${r.factor_unidades}` : 'Cualquier presentación'} ›</Text>
                    </Pressable>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15 }}>Su lote</Text>
                      <Numero valor={r.lote_total} onCambiar={(v) => cambiarRenglon(i, 'lote_total', v)} placeholder="Sin lote" />
                    </View>
                    <Pressable onPress={() => quitar(i)}><Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Quitar de la promoción</Text></Pressable>
                  </View>
                ) : null}
              </View>
            ))}
            {!promoCreada ? <AgregarProductos yaElegidos={renglones.map((r) => r.erp_product_id)} onAgregar={agregar} /> : null}
          </Seccion>

          <Seccion titulo="Precio en la venta">
            <FilaConSwitch titulo="También baja el precio" detalle="La mayoría de las promociones sólo paga bono: el precio no cambia." valor={desc.activo} onCambiar={(v) => setDesc((d) => ({ ...d, activo: v }))} />
            {desc.activo ? (
              <>
                <Opciones valor={desc.tipo} onCambiar={(v) => setDesc((d) => ({ ...d, tipo: v }))} opciones={[{ id: '%', label: 'Porcentaje del renglón' }, { id: '$', label: 'Monto por unidad' }]} />
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{desc.tipo === '%' ? 'Porcentaje' : 'Monto ($)'}</Text>
                  <Numero valor={desc.monto} onCambiar={(v) => setDesc((d) => ({ ...d, monto: v }))} />
                </View>
                {marcadas.length > 1 ? (
                  <>
                    <FilaConSwitch titulo="En todas las salas" detalle="La caja acepta un descuento en una sala o en todas, nunca en varias." valor={desc.todas} onCambiar={(v) => setDesc((d) => ({ ...d, todas: v }))} />
                    {!desc.todas ? (
                      <Pressable onPress={() => elegirSalaDescuento(marcadas)}>
                        <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{salas.find((s) => String(s.id) === String(desc.branchId))?.name || 'Elegir la sala…'}</Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </Seccion>

          {!promoCreada ? (
            <Seccion>
              <FilaConSwitch titulo="Activarla al guardar" detalle="Si no, queda en borrador." valor={activar} onCambiar={setActivar} />
            </Seccion>
          ) : null}
          {vencidos.length ? <Aviso tono="cuidado" texto={`${vencidos.length === 1 ? 'Un producto termina' : `${vencidos.length} productos terminan`} antes de hoy: la promoción se cerrará en el próximo cierre diario.`} /> : null}
          {[...problemasPromo, ...problemasDesc].map((p) => <Aviso key={p} tono="cuidado" texto={p} />)}
          <BotonGrande texto={guardando ? 'Guardando…' : promoCreada ? 'Reintentar el descuento' : 'Guardar promoción'} onPress={() => { Haptics.selectionAsync().catch(() => {}); confirmar(); }} deshabilitado={!listo_ || guardando} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
