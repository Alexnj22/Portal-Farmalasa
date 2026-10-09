// Editar una promoción POR PRODUCTO, NATIVO — `EditarPromocionModal` del
// portal, producto por producto:
//   · lote y presentación (retroactivos: son el acuerdo con el laboratorio);
//   · los montos del bono «desde hoy» (no reescriben lo ya ganado);
//   · extender su fin (extender un producto extiende la promoción);
//   · quitarlo, y agregar productos nuevos con lo heredado de la campaña;
//   · a quién le llega el resumen diario (supervisión, salas o nadie);
//   · borrar la promoción entera, sólo si sigue en borrador.
// Si la promoción baja el precio en la venta, al agregar o quitar se pregunta
// si el descuento también cambia. Las mismas funciones del portal.
import { useCallback, useEffect, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { volver } from '../../componentes/volver';
import * as Haptics from 'expo-haptics';
import {
  agregarRenglonesAPromocion, ajustarResumenPromocion, borrarPromocion, editarRenglon, editarTarifaRenglon, extenderRenglon,
  fetchPresentacionesDeProducto, fetchPromocion, fetchProveedoresDelSistema, fetchResumenDePromocion, quitarRenglon,
} from '@nucleo/data/promociones';
import { sincronizarProductosDelDescuento } from '@nucleo/data/descuentos';
import { OPCIONES_RESUMEN_DIARIO, alternarResumen, fmtUnidades, numeroEscrito, renglonesParaAgregar, resumenElegido } from '@nucleo/utils/promocionesUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import AgregarProductos from '../../componentes/promociones/AgregarProductos';
import { fallo, listo } from '../../componentes/Progreso';
import Tocable from '../../componentes/Tocable';

function Numero({ valor, onCambiar, placeholder }) {
  return (
    <TextInput value={String(valor ?? '')} onChangeText={onCambiar} keyboardType="decimal-pad" placeholder={placeholder} placeholderTextColor={colorSistema.placeholder}
      style={{ minWidth: 92, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(127,127,127,0.14)', color: colorSistema.texto, fontSize: 16, textAlign: 'right' }} />
  );
}
function Linea({ titulo, children }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{titulo}</Text>
      {children}
    </View>
  );
}

// A quién le llega el resumen diario (7:30 a. m.): cada toque se guarda solo,
// como en el portal; si falla, vuelve a lo de antes.
function ResumenDiario({ promocionId }) {
  const [valor, setValor] = useState(null);
  useEffect(() => {
    let vivo = true;
    fetchResumenDePromocion(promocionId)
      .then((r) => { if (vivo) setValor({ supervision: !!r?.supervision, salas: !!r?.salas }); })
      .catch(() => { if (vivo) setValor({ supervision: false, salas: false }); });
    return () => { vivo = false; };
  }, [promocionId]);
  if (!valor) return null;
  const tocar = async (key) => {
    const antes = valor;
    const nuevo = alternarResumen(valor, key);
    setValor(nuevo);
    try { await ajustarResumenPromocion(promocionId, nuevo); }
    catch (e) { setValor(antes); fallo('No se pudo guardar el resumen diario', mensajeAmigable(e)); }
  };
  return (
    <Seccion titulo="Resumen diario · 7:30 a. m.">
      {OPCIONES_RESUMEN_DIARIO.map((o, i) => {
        const si = resumenElegido(valor, o.key);
        return (
          <Tocable key={o.key} onPress={() => { Haptics.selectionAsync().catch(() => {}); tocar(o.key); }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{o.rotulo}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{o.detalle}</Text>
            </View>
            {si ? <Text style={{ color: MARCA.azulClaro, fontSize: 19, fontWeight: '700' }}>✓</Text> : null}
          </Tocable>
        );
      })}
    </Seccion>
  );
}

function Renglon({ r, onHecho, preguntarDescuento }) {
  const [lote, setLote] = useState(r.lote_total == null ? '' : String(r.lote_total));
  const [factor, setFactor] = useState(r.factor_unidades == null ? '' : String(r.factor_unidades));
  const [pres, setPres] = useState(null);
  const [bv, setBv] = useState(String(r.bono_vendedor ?? '0'));
  const [ba, setBa] = useState(String(r.bono_adm ?? '0'));
  const [bb, setBb] = useState(String(r.bono_bodega ?? '0'));
  const [fin, setFin] = useState(r.fin || '');
  const [ocupado, setOcupado] = useState(null);
  useEffect(() => { fetchPresentacionesDeProducto(r.erp_product_id).then(setPres).catch(() => setPres([])); }, [r.erp_product_id]);

  const correr = async (que, fn, msg) => {
    setOcupado(que);
    try { await fn(); listo(msg, ''); onHecho(); }
    catch (e) { fallo('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.')); }
    finally { setOcupado(null); }
  };
  const confirmar = (titulo, texto, que, fn, msg) => Alert.alert(titulo, texto, [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Guardar', onPress: () => correr(que, fn, msg) },
  ]);
  const elegirPres = () => {
    const lista = pres || [];
    const opciones = ['Cualquier presentación', ...lista.map((p) => `${p.etiqueta} · ×${p.factor}`), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Qué ventas cuentan', options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => {
      if (i === 0) setFactor(''); else if (i > 0 && i <= lista.length) setFactor(String(lista[i - 1].factor));
    });
  };
  const loteIlegible = lote !== '' && numeroEscrito(lote) == null;
  const declaradoCambio = lote !== (r.lote_total == null ? '' : String(r.lote_total)) || factor !== (r.factor_unidades == null ? '' : String(r.factor_unidades));
  const tarifaCambio = bv !== String(r.bono_vendedor ?? '0') || ba !== String(r.bono_adm ?? '0') || bb !== String(r.bono_bodega ?? '0');
  const montosIlegibles = [bv, ba, bb].some((x) => numeroEscrito(x) == null);
  const cerrado = r.estado === 'cerrado';

  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{r.producto}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
          {[r.lote_total ? `vendido ${fmtUnidades(r.vendido_base ?? 0)} de ${fmtUnidades(r.lote_total)}` : `vendido ${fmtUnidades(r.vendido_base ?? 0)}`,
            r.fin ? `hasta ${fechaTexto(r.fin, { day: 'numeric', month: 'short', year: 'numeric' })}` : null,
            r.tiene_bono ? `${formatMoney(r.bono_vendedor)} · paga ${r.paga === 'empresa' ? 'la empresa' : (r.proveedor || 'un proveedor')}` : 'sólo se mide',
            cerrado ? 'cerrado' : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Linea titulo="Lote (unidades)"><Numero valor={lote} onCambiar={setLote} placeholder="Sin lote" /></Linea>
      <Tocable onPress={elegirPres}><Text style={{ color: colorSistema.acento, fontSize: 15 }}>{factor ? `Sólo la presentación ×${factor}` : 'Cualquier presentación'} ›</Text></Tocable>
      {loteIlegible ? <Aviso tono="cuidado" texto="El lote no es un número." /> : null}
      {declaradoCambio ? (
        <BotonGrande borde texto={ocupado === 'declarado' ? 'Guardando…' : 'Guardar lote y presentación'} deshabilitado={!!ocupado || loteIlegible}
          onPress={() => confirmar('Lote y presentación', 'Corrige el acuerdo: el cálculo vuelve a leer las ventas con el dato nuevo.', 'declarado',
            () => editarRenglon({ renglonId: r.id, loteTotal: lote === '' ? null : numeroEscrito(lote), factorUnidades: factor === '' ? null : factor, borrarLote: lote === '', cualquierPresentacion: factor === '' }),
            'Lote y presentación guardados')} />
      ) : null}
      {r.tiene_bono ? (
        <View style={{ gap: 8 }}>
          <Linea titulo="Al vendedor ($)"><Numero valor={bv} onCambiar={setBv} /></Linea>
          <Linea titulo="Fondo administración ($)"><Numero valor={ba} onCambiar={setBa} /></Linea>
          <Linea titulo="Fondo bodega ($)"><Numero valor={bb} onCambiar={setBb} /></Linea>
          {tarifaCambio ? (
            <BotonGrande borde texto={ocupado === 'tarifa' ? 'Guardando…' : 'Guardar montos desde hoy'} deshabilitado={!!ocupado || montosIlegibles}
              onPress={() => confirmar('Montos desde hoy', 'Lo vendido antes se sigue pagando con el monto que regía ese día.', 'tarifa',
                () => editarTarifaRenglon({ renglonId: r.id, bonoVendedor: numeroEscrito(bv) ?? 0, bonoAdm: numeroEscrito(ba) ?? 0, bonoBodega: numeroEscrito(bb) ?? 0, unidadesPorBono: Number(r.unidades_por_bono) || 1 }),
                'Montos guardados')} />
          ) : null}
        </View>
      ) : null}
      <Linea titulo="Termina"><Fecha valor={fin} onCambiar={setFin} /></Linea>
      {fin && fin !== r.fin ? (
        <BotonGrande borde texto={ocupado === 'fin' ? 'Guardando…' : 'Cambiar la fecha'} deshabilitado={!!ocupado}
          onPress={() => confirmar('Cambiar la fecha', 'Extender un producto extiende la promoción. Uno que cerró porque se acabó el lote no se reabre moviendo la fecha.', 'fin',
            () => extenderRenglon(r.id, fin), 'Fecha guardada')} />
      ) : null}
      <Tocable onPress={() => preguntarDescuento('quitar', r)}><Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Quitar de la promoción</Text></Tocable>
    </View>
  );
}

export default function EditarPromocionProducto() {
  const { id } = useLocalSearchParams();
  const [promo, setPromo] = useState(null);
  const [error, setError] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [agregando, setAgregando] = useState(false);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setPromo(await fetchPromocion(id)); setError(null); }
    catch (e) { setError(mensajeAmigable(e, 'No se pudo cargar la promoción.')); }
  }, [id]);
  useEffect(() => { cargar(); fetchProveedoresDelSistema().then(setProveedores).catch(() => setProveedores([])); }, [cargar]);

  const conDescuento = Number(promo?.descuentos ?? 0) > 0;
  const sincronizar = async (delta) => {
    try { await sincronizarProductosDelDescuento(id, delta); }
    catch (e) { fallo('El descuento no cambió', mensajeAmigable(e, 'El producto quedó, pero su descuento no se pudo actualizar. Corrígelo desde Descuentos.')); }
  };
  const agregarYa = async (prods, tambien) => {
    setAgregando(true);
    try {
      const cuerpo = renglonesParaAgregar(promo, prods, proveedores);
      if (cuerpo.error) { fallo('No se agregaron', cuerpo.error); return; }
      const r = await agregarRenglonesAPromocion(id, cuerpo.renglones);
      if (!r.agregados) { fallo('Nada que agregar', 'Esos productos ya estaban en la promoción.'); return; }
      if (tambien) await sincronizar({ agregar: prods.map((p) => p.id) });
      listo(`${r.agregados} agregado${r.agregados === 1 ? '' : 's'}`, r.repetidos ? `${r.repetidos} ya estaban` : '');
      cargar();
    } catch (e) {
      fallo('No se agregaron', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setAgregando(false);
    }
  };
  const quitarYa = async (r, tambien) => {
    try {
      await quitarRenglon(r.id);
      if (tambien) await sincronizar({ quitar: [r.erp_product_id] });
      listo('Producto quitado', '');
      cargar();
    } catch (e) {
      fallo('No se pudo quitar', mensajeAmigable(e, 'Intenta de nuevo.'));
    }
  };
  // Con descuento en la venta se pregunta si también cambia; sin él, sólo se confirma.
  const preguntarDescuento = (que, dato) => {
    const hacer = (tambien) => (que === 'agregar' ? agregarYa(dato, tambien) : quitarYa(dato, tambien));
    const titulo = que === 'agregar' ? `Agregar ${dato.length} producto${dato.length === 1 ? '' : 's'}` : `Quitar «${dato.producto}»`;
    if (!conDescuento) {
      Alert.alert(titulo, que === 'agregar' ? 'Heredan la vigencia, las salas y el bono de la promoción.' : 'No se puede si ya se decidió algún excedente suyo.', [
        { text: 'Cancelar', style: 'cancel' }, { text: que === 'agregar' ? 'Agregar' : 'Quitar', style: que === 'agregar' ? 'default' : 'destructive', onPress: () => hacer(false) },
      ]);
      return;
    }
    Alert.alert(titulo, 'Esta promoción baja el precio en la venta. ¿El descuento también cambia?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sólo la promoción', onPress: () => hacer(false) },
      { text: 'También el descuento', onPress: () => hacer(true) },
    ]);
  };

  const renglones = promo?.renglones ?? [];
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: promo?.nombre || 'Editar promoción', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive"
          refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
          {error ? <Aviso tono="freno" texto={error} /> : null}
          {!promo && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
          {conDescuento ? <Aviso texto="Esta promoción también baja el precio en la venta." /> : null}
          {renglones.map((r) => (
            <Seccion key={`${r.id}-${r.lote_total}-${r.fin}-${r.bono_vendedor}`}>
              <Renglon r={r} onHecho={cargar} preguntarDescuento={preguntarDescuento} />
            </Seccion>
          ))}
          {promo ? (
            <Seccion titulo="Agregar productos">
              <AgregarProductos yaElegidos={renglones.map((r) => r.erp_product_id)} ocupado={agregando}
                onAgregar={(prods) => { Haptics.selectionAsync().catch(() => {}); preguntarDescuento('agregar', prods); }} />
            </Seccion>
          ) : null}
          {promo ? <ResumenDiario promocionId={promo.id} /> : null}
          {promo?.estado === 'borrador' ? (
            <BotonGrande texto="Borrar promoción" borde color={MARCA.rojo} onPress={() => Alert.alert('Borrar la promoción',
              `«${promo.nombre}» se borra con todos sus productos. Sólo se puede porque sigue en borrador: una que ya corrió es historia y no se borra.`, [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Borrar', style: 'destructive', onPress: async () => {
                  try { await borrarPromocion(promo.id); listo('Promoción borrada', ''); volver('/promociones'); }
                  catch (e) { fallo('No se pudo borrar la promoción', mensajeAmigable(e)); }
                } },
              ])} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
