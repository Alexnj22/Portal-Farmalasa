// Editar una promoción POR PRODUCTO, NATIVO — `EditarPromocionModal` del
// portal, producto por producto:
//   · lote y presentación (retroactivos: son el acuerdo con el laboratorio);
//   · los montos del bono «desde hoy» (no reescriben lo ya ganado);
//   · extender su fin (extender un producto extiende la promoción);
//   · quitarlo, y agregar productos nuevos con lo heredado de la campaña;
//   · a quién le llega el resumen diario (supervisión, salas o nadie);
//   · borrar la promoción entera, sólo si sigue en borrador;
//   · si paga bono, quién lo cancela (empresa o proveedor) y el reparto del
//     lote por sala, que viajan con el lote en una sola llamada;
//   · crearle el descuento en la venta si no lo tiene (una duplicada nace sin él).
// Si la promoción baja el precio en la venta, al agregar o quitar se pregunta
// si el descuento también cambia. Las mismas funciones del portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, ScrollView, Text, TextInput, View } from 'react-native';
import Refrescar from '../../componentes/Refrescar';
import { Stack, useLocalSearchParams } from 'expo-router';
import { volver } from '../../componentes/volver';
import * as Haptics from 'expo-haptics';
import {
  agregarRenglonesAPromocion, ajustarResumenPromocion, borrarPromocion, editarRenglon, editarTarifaRenglon, extenderRenglon,
  fetchPresentacionesDeProducto, fetchPromocion, fetchProveedoresDelSistema, fetchResumenDePromocion, quitarRenglon,
} from '@nucleo/data/promociones';
import { guardarDescuento, sincronizarProductosDelDescuento } from '@nucleo/data/descuentos';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { SALAS_VENTA } from '@nucleo/utils/metasUtils';
import {
  OPCIONES_RESUMEN_DIARIO, alternarResumen, descuentoDesdeLaPromocion, destinoDelDescuento, fmtUnidades, numeroEscrito,
  problemasDelDescuentoDeLaPromocion, proveedorDelRenglon, renglonesParaAgregar, resumenElegido,
} from '@nucleo/utils/promocionesUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion, Cargando } from '../../componentes/formulario/Piezas';
import Interruptor from '../../componentes/Interruptor';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import AgregarProductos from '../../componentes/promociones/AgregarProductos';
import { fallo, listo } from '../../componentes/Progreso';
import Tocable from '../../componentes/Tocable';
import MarcaDeEleccion from '../../componentes/MarcaDeEleccion';

function Numero({ valor, onCambiar, placeholder }) {
  return (
    <Campo multiline={false} value={String(valor ?? '')} onChangeText={onCambiar} keyboardType="decimal-pad" placeholder={placeholder} placeholderTextColor={colorSistema.placeholder}
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

// Toda la fila cambia el interruptor: blanco de dedo de la fila entera.
function FilaConSwitch({ titulo, detalle, valor, onCambiar }) {
  return (
    <Tocable onPress={() => onCambiar(!valor)} accessibilityRole="switch" accessibilityState={{ checked: !!valor }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
      </View>
      <Interruptor value={!!valor} onValueChange={onCambiar} />
    </Tocable>
  );
}

// El descuento en la venta para una promoción que todavía no lo tiene —una
// duplicada, por ejemplo—. Nace apagado: entrar a corregir el lote no puede
// terminar bajando un precio sin que nadie lo pida. Productos y fechas se
// heredan de los renglones (`descuentoDesdeLaPromocion`); la sala, con la misma
// regla del alta (`destinoDelDescuento`). Si el servidor avisa (bajo el costo,
// solape con otro descuento), se ofrece «de todos modos».
function CrearDescuento({ promo, salas, alcanceTodo, onHecho }) {
  const [desc, setDesc] = useState({ activo: false, tipo: '%', monto: '', todas: true, branchId: '', finPropio: '' });
  const [avisos, setAvisos] = useState([]);
  const [mandando, setMandando] = useState(false);
  const renglones = promo.renglones ?? [];
  const marcadasMapa = useMemo(() => Object.fromEntries((promo.salas ?? []).map((sid) => [Number(sid), true])), [promo.salas]);
  const marcadas = salas.filter((x) => marcadasMapa[x.id]);
  const problemas = problemasDelDescuentoDeLaPromocion(renglones, desc, { alcanceTodo, salas, marcadas: marcadasMapa });
  const sinFin = !renglones.some((x) => x.fin);
  const poner = (k) => (v) => { setAvisos([]); setDesc((d) => ({ ...d, [k]: v })); };
  const elegirSala = () => ActionSheetIOS.showActionSheetWithOptions(
    { title: 'Sala del descuento', options: [...marcadas.map((x) => x.name), 'Cancelar'], cancelButtonIndex: marcadas.length },
    (i) => { if (i < marcadas.length) poner('branchId')(String(marcadas[i].id)); });

  const crear = async (forzar) => {
    setMandando(true);
    try {
      const r = await guardarDescuento({
        ...descuentoDesdeLaPromocion(renglones, desc),
        descripcion: (promo.nombre || '').trim(),
        ...destinoDelDescuento(salas, marcadasMapa, desc),
        promocion_id: promo.id,
        forzar,
      });
      if (r.avisos) { setAvisos(r.avisos); return; }
      listo('Descuento creado', 'La venta ya descuenta estos productos en sus fechas.');
      onHecho();
    } catch (e) {
      fallo('No se pudo crear el descuento', mensajeAmigable(e));
    } finally { setMandando(false); }
  };

  return (
    <Seccion titulo="Precio en la venta">
      <FilaConSwitch titulo="Además baja el precio en la venta" detalle="La venta le descuenta al renglón cuando se vende cualquiera de estos productos." valor={desc.activo} onCambiar={poner('activo')} />
      {desc.activo ? (
        <>
          <Opciones valor={desc.tipo} onCambiar={poner('tipo')} opciones={[{ id: '%', label: 'Porcentaje del renglón' }, { id: '$', label: 'Monto por unidad' }]} />
          <Linea titulo={desc.tipo === '%' ? 'Porcentaje' : 'Monto por unidad ($)'}><Numero valor={desc.monto} onCambiar={(v) => poner('monto')(v.replace(/[^0-9.]/g, ''))} placeholder={desc.tipo === '%' ? '25' : '1.50'} /></Linea>
          {desc.tipo === '$' && Number(desc.monto) > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Se descuenta ${formatMoney(Number(desc.monto))} por cada unidad: en una venta de 3 son ${formatMoney(Number(desc.monto) * 3)}.`}</Text> : null}
          {sinFin ? <Linea titulo="Hasta"><Fecha valor={desc.finPropio || null} onCambiar={poner('finPropio')} /></Linea> : null}
          {marcadas.length > 1 ? (
            <>
              <FilaConSwitch titulo="En todas las salas" detalle="La caja acepta un descuento en una sala o en todas, nunca en varias." valor={desc.todas} onCambiar={poner('todas')} />
              {!desc.todas ? (
                <Tocable onPress={elegirSala}>
                  <Text style={{ color: colorSistema.acento, fontSize: 15 }}>{salas.find((x) => String(x.id) === String(desc.branchId))?.name || 'Elegir la sala…'} ›</Text>
                </Tocable>
              ) : null}
            </>
          ) : null}
          {avisos.length ? <Aviso tono="cuidado" texto={avisos.map((a) => a.texto).join('\n')} /> : null}
          {problemas.length ? <Text style={{ color: MARCA.ambar, fontSize: 13 }}>{problemas[0]}</Text> : null}
          <BotonGrande texto={mandando ? 'Creando…' : avisos.length ? 'Crear el descuento de todos modos' : 'Crear el descuento'}
            color={avisos.length ? MARCA.rojo : MARCA.azul} deshabilitado={mandando || problemas.length > 0}
            onPress={() => Alert.alert(avisos.length ? 'Crear de todos modos' : 'Crear el descuento',
              'Baja el precio en la caja para estos productos y fechas.', [
                { text: 'Cancelar', style: 'cancel' }, { text: 'Crear', onPress: () => crear(avisos.length > 0) },
              ])} />
        </>
      ) : null}
    </Seccion>
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
            <MarcaDeEleccion elegida={si} multiple />
          </Tocable>
        );
      })}
    </Seccion>
  );
}

function Renglon({ r, salas, proveedores, onHecho, preguntarDescuento }) {
  const [lote, setLote] = useState(r.lote_total == null ? '' : String(r.lote_total));
  const [factor, setFactor] = useState(r.factor_unidades == null ? '' : String(r.factor_unidades));
  const [pres, setPres] = useState(null);
  const [bv, setBv] = useState(String(r.bono_vendedor ?? '0'));
  const [ba, setBa] = useState(String(r.bono_adm ?? '0'));
  const [bb, setBb] = useState(String(r.bono_bodega ?? '0'));
  const [fin, setFin] = useState(r.fin || '');
  const [ocupado, setOcupado] = useState(null);
  // Quién paga y el reparto viajan con el lote: la base los valida juntos.
  const [tieneBono, setTieneBono] = useState(!!r.tiene_bono);
  const [paga, setPaga] = useState(r.paga || 'proveedor');
  const [provElegido, setProv] = useState(null);
  const prov = provElegido ?? proveedorDelRenglon(r, proveedores) ?? '';
  const repartoOriginal = useMemo(() => Object.fromEntries(salas.map((x) => {
    const fila = (r.reparto || []).find((y) => Number(y.branch_id) === Number(x.id));
    return [x.id, fila ? String(fila.asignado_vigente) : ''];
  })), [salas, r.reparto]);
  const [repartoEscrito, setReparto] = useState(null);
  const reparto = repartoEscrito ?? repartoOriginal;
  // El reparto viaja SÓLO si se tocó (ver el portal: mandarlo siempre borraba las salas en 0).
  const repartoCambio = salas.some((x) => (Number(reparto[x.id]) || 0) !== (Number(repartoOriginal[x.id]) || 0));
  const sumaReparto = Object.values(reparto).reduce((a, u) => a + (Number(u) || 0), 0);
  const elegirProveedor = () => {
    const lista = proveedores || [];
    if (!lista.length) { fallo('Sin proveedores', 'No se pudo leer la lista de proveedores. Desliza para recargar.'); return; }
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Proveedor que paga', options: [...lista.map((x) => x.label), 'Cancelar'], cancelButtonIndex: lista.length },
      (i) => { if (i < lista.length) setProv(String(lista[i].value)); });
  };
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
  const loteIlegible = lote !== '' && !(numeroEscrito(lote) > 0 && Number.isInteger(numeroEscrito(lote)));
  const provOriginal = proveedorDelRenglon(r, proveedores) ?? '';
  const declaradoCambio = lote !== (r.lote_total == null ? '' : String(r.lote_total)) || factor !== (r.factor_unidades == null ? '' : String(r.factor_unidades))
    || tieneBono !== !!r.tiene_bono || (tieneBono && (paga !== (r.paga || 'proveedor') || (paga === 'proveedor' && String(prov) !== String(provOriginal)))) || repartoCambio;
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
      <FilaConSwitch titulo="Paga bono" detalle={tieneBono ? 'Paga por unidad vendida.' : 'Sólo se mide cuánto se vende.'} valor={tieneBono} onCambiar={setTieneBono} />
      {tieneBono ? (
        <>
          <Opciones valor={paga} onCambiar={setPaga} opciones={[{ id: 'empresa', label: 'La empresa' }, { id: 'proveedor', label: 'Un proveedor' }]} />
          {paga === 'proveedor' ? (
            <Tocable onPress={elegirProveedor}>
              <Text style={{ color: colorSistema.acento, fontSize: 15 }}>{(proveedores || []).find((x) => String(x.value) === String(prov))?.label || r.proveedor || 'Elegir el proveedor'} ›</Text>
            </Tocable>
          ) : null}
        </>
      ) : null}
      {lote !== '' && Number(lote) > 0 && salas.length ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>REPARTO POR SALA</Text>
            {sumaReparto > 0 ? <Text style={{ color: sumaReparto === Number(lote) ? MARCA.verde : MARCA.ambar, fontSize: 13, fontWeight: '600' }}>{`${fmtUnidades(sumaReparto)} de ${fmtUnidades(Number(lote))}`}</Text> : null}
          </View>
          {salas.map((x) => (
            <Linea key={x.id} titulo={x.name}>
              <Numero valor={reparto[x.id] ?? ''} onCambiar={(v) => setReparto({ ...reparto, [x.id]: v.replace(/[^\d]/g, '') })} placeholder="—" />
            </Linea>
          ))}
        </View>
      ) : null}
      {loteIlegible ? <Aviso tono="cuidado" texto="El lote tiene que ser un número entero mayor que cero, o quedar vacío." /> : null}
      {declaradoCambio ? (
        <BotonGrande borde texto={ocupado === 'declarado' ? 'Guardando…' : 'Guardar lote, presentación y reparto'} deshabilitado={!!ocupado || loteIlegible}
          onPress={() => confirmar('Lote, presentación y reparto', 'Corrige el acuerdo: el cálculo vuelve a leer las ventas con el dato nuevo.', 'declarado',
            () => editarRenglon({
              renglonId: r.id, loteTotal: lote === '' ? null : numeroEscrito(lote), factorUnidades: factor === '' ? null : factor,
              tieneBono, paga: tieneBono ? paga : null, supplierId: prov || null,
              borrarLote: lote === '', cualquierPresentacion: factor === '',
              reparto: repartoCambio
                ? Object.entries(reparto).filter(([b, u]) => (numeroEscrito(u) || 0) > 0 || repartoOriginal[b] !== '')
                  .map(([b, u]) => ({ branch_id: Number(b), unidades: numeroEscrito(u) || 0 }))
                : null,
            }),
            'Guardado')} />
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
  const { getScope } = useAuth();
  const alcanceTodo = getScope('promociones') === 'ALL';
  const branches = useStaffStore((s) => s.branches);
  const salas = useMemo(() => SALAS_VENTA.map((sid) => (branches || []).find((b) => Number(b.id) === sid)).filter(Boolean), [branches]);
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
          refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
          {error ? <Aviso tono="freno" texto={error} /> : null}
          {!promo && !error ? <Cargando /> : null}
          {conDescuento ? <Aviso texto="Esta promoción también baja el precio en la venta." /> : null}
          {renglones.map((r) => (
            <Seccion key={`${r.id}-${r.lote_total}-${r.fin}-${r.bono_vendedor}-${r.tiene_bono}-${r.paga}-${r.supplier_id}-${JSON.stringify(r.reparto ?? [])}`}>
              <Renglon r={r} salas={salas} proveedores={proveedores} onHecho={cargar} preguntarDescuento={preguntarDescuento} />
            </Seccion>
          ))}
          {promo ? (
            <Seccion titulo="Agregar productos">
              <AgregarProductos yaElegidos={renglones.map((r) => r.erp_product_id)} ocupado={agregando}
                onAgregar={(prods) => { Haptics.selectionAsync().catch(() => {}); preguntarDescuento('agregar', prods); }} />
            </Seccion>
          ) : null}
          {promo && renglones.length > 0 && !conDescuento ? <CrearDescuento promo={promo} salas={salas} alcanceTodo={alcanceTodo} onHecho={cargar} /> : null}
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
