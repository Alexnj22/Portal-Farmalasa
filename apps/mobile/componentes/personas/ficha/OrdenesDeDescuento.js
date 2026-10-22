// Órdenes de descuento del empleado — los préstamos que la empresa descuenta de
// planilla y paga al banco. Port de `components/forms/OrdenesDeDescuento.jsx`
// del portal, que vive en la pestaña de nómina del formulario: aquí también va
// en «Nómina y acceso» de «Editar la ficha».
//
// Se guardan en su propia tabla y AL MOMENTO —no con «Guardar cambios» de la
// ficha—, así que sólo existen cuando la ficha existe. «Existe» incluye un alta
// que se ENLAZA con la ficha de quien ya trabajó aquí (`enlazar_con_id`): ahí
// la sección sale con esa ficha. En el alta de alguien nuevo se muestra igual,
// apagada y diciendo por qué (escondida, parecía que no existía).
//
// Lo mismo que el portal, con las MISMAS funciones del núcleo:
//  · la lista con banco, cuota, préstamo, tasa y cuánto falta (`loQueFalta`),
//    con la barra de avance y las hojas del documento;
//  · agregar y editar: las fotos del papel se leen UNA vez (`leerOrden`, sólo
//    imágenes: un PDF se adjunta pero se llena a mano), todo queda editable, y
//    si el papel nombra a otra persona se dice (`cruzarConElPadron`): una orden
//    en el expediente equivocado descuenta del salario de otro;
//  · borrar, con la advertencia de marcarla «Finalizada» si ya se pagó;
//  · la bitácora (`ORDEN_DESCUENTO_CREAR/EDITAR/BORRAR`) y el borrador del
//    editor (la sesión de sala se cierra sola y esto se teclea mirando el papel).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useStaffStore } from '@nucleo/store/staffStore';
import useBorrador from '@nucleo/hooks/useBorrador';
import { BANCOS } from '@nucleo/constants/bancos';
import { fetchOrdenes, leerOrden, subirFotoDeOrden, guardarOrden, borrarOrden } from '@nucleo/data/ordenesDeDescuento';
import { loQueFalta, camposDesdeLectura, finDesdePlazo } from '@nucleo/utils/ordenDeDescuento';
import { cruzarConElPadron } from '@nucleo/data/documentosCompartidos';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../../Formulario';
import { BotonGrande, Seccion } from '../../formulario/Piezas';
import { CampoConRotulo, CampoFecha, Elegir } from '../Formulario';
import { MARCA } from '../../inicio/marca';
import ConAurora from '../../ConAurora';
import { elegirOrigen } from '../../sucursal/elegirArchivo';
import { fallo, listo } from '../../Progreso';
import { Enlace, Nota, op } from './Piezas';

const dinero = (n) => formatMoney(n === '' ? null : n);
const fecha = (iso) => fechaTexto(iso, { day: '2-digit', month: 'short', year: 'numeric' }, '—');

const PERIODICIDAD = [{ id: 'MENSUAL', label: 'Mensual' }, { id: 'QUINCENAL', label: 'Quincenal' }];
const ESTADOS = [
  { id: 'VIGENTE', label: 'Vigente' },
  { id: 'FINALIZADA', label: 'Finalizada (pagada)' },
  { id: 'CANCELADA', label: 'Cancelada' },
];
const VACIA = { banco: '', referencia: '', monto_prestamo: '', tasa_interes: '', cuota: '', periodicidad: 'MENSUAL',
  plazo_cuotas: '', fecha_inicio: '', fecha_fin: '', estado: 'VIGENTE', archivos: [], nombre_en_documento: '', notas: '' };
const MAX_HOJAS = 4;
const esPdf = (f) => /pdf/i.test(f?.tipo || '') || /\.pdf$/i.test(f?.nombre || '');
const texto = (v) => (v === null || v === undefined ? '' : String(v));

function Cifra({ rotulo, valor }) {
  return (
    <View style={{ width: '50%', paddingVertical: 4, paddingRight: 8 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' }}>{rotulo}</Text>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{valor}</Text>
    </View>
  );
}

function Orden({ o, primero, puedeEditar, onEditar, onBorrar }) {
  const f = loQueFalta(o);
  const vigente = o.estado === 'VIGENTE';
  const estado = vigente ? (f.terminada ? 'Ya debió terminar' : 'Vigente') : o.estado === 'FINALIZADA' ? 'Finalizada' : 'Cancelada';
  const colorEstado = vigente ? (f.terminada ? MARCA.ambar : MARCA.azulClaro) : colorSistema.texto2;
  const archivos = o.archivos || [];
  const abrir = (url) => Promise.resolve(openStoredFile(url)).catch((e) => fallo('No se pudo abrir', e?.message || ''));
  return (
    <View style={{ gap: 6, paddingTop: primero ? 0 : 12, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{o.banco || 'Banco sin indicar'}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`${o.referencia ? `Préstamo ${o.referencia} · ` : ''}${fecha(o.fecha_inicio)} → ${fecha(o.fecha_fin)}`}
          </Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: `${colorEstado}2E` }}>
          <Text style={{ color: colorEstado, fontSize: 12, fontWeight: '700' }}>{estado}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Cifra rotulo={`Cuota ${o.periodicidad === 'QUINCENAL' ? 'quincenal' : 'mensual'}`} valor={dinero(o.cuota)} />
        <Cifra rotulo="Préstamo" valor={dinero(o.monto_prestamo)} />
        <Cifra rotulo="Tasa anual" valor={o.tasa_interes != null ? `${Number(o.tasa_interes)}%` : '—'} />
        <Cifra rotulo="Falta" valor={f.cuotasRestantes == null ? '—'
          : f.cuotasRestantes === 0 ? 'Nada'
            : `${f.cuotasRestantes} cuota${f.cuotasRestantes === 1 ? '' : 's'}${f.saldo != null ? ` · ${dinero(f.saldo)}` : ''}`} />
      </View>
      {f.avance != null && vigente ? (
        <View accessibilityRole="progressbar" accessibilityLabel={`Avance del préstamo: ${Math.round(f.avance * 100)}%`}
          style={{ height: 6, borderRadius: 3, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
          <View style={{ width: `${Math.round(f.avance * 100)}%`, height: 6, backgroundColor: MARCA.verde }} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 }}>
        {archivos.map((a, i) => (
          <Enlace key={a.url || i} texto={archivos.length > 1 ? `Hoja ${i + 1}` : 'Ver documento'} onPress={() => abrir(a.url)} />
        ))}
        {puedeEditar ? <Enlace texto="Editar" onPress={onEditar} /> : null}
        {puedeEditar ? <Enlace texto="Borrar" color={MARCA.rojo} onPress={onBorrar} /> : null}
      </View>
    </View>
  );
}

function EditorDeOrden({ inicial, empleado, onCancelar, onGuardar }) {
  const claveBorrador = `orden-descuento-${empleado.id}-${inicial.id || 'nueva'}`;
  const [f, setF] = useState(inicial);
  const { recuperado, descartar } = useBorrador(claveBorrador, f, { vale: (v) => !!(v?.banco || v?.cuota || v?.monto_prestamo || v?.fecha_inicio) });
  const [repuesto, setRepuesto] = useState(false);
  if (recuperado && !repuesto) {
    setRepuesto(true);
    setF((p) => ({ ...p, ...recuperado }));
  }
  // Hojas nuevas elegidas en esta edición (todavía sin subir): `{ uri, tipo, nombre }`.
  const [hojas, setHojas] = useState([]);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [falla, setFalla] = useState(null);
  const [aviso, setAviso] = useState(null);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const imagenes = hojas.filter((h) => !esPdf(h));

  const agregarHoja = async () => {
    const h = await elegirOrigen();
    if (h) setHojas((p) => [...p, h].slice(0, MAX_HOJAS));
  };

  const leer = async () => {
    setLeyendo(true); setFalla(null); setAviso(null);
    try {
      const campos = camposDesdeLectura(await leerOrden(imagenes));
      // Lo leído llena; lo que ya estaba escrito y el papel no trae, se queda.
      setF((p) => {
        const n = { ...p };
        for (const [k, v] of Object.entries(campos)) if (k !== 'banco_leido' && v !== '' && v != null) n[k] = v;
        return n;
      });
      if (campos.banco_leido && !campos.banco) {
        setAviso(`El documento dice «${campos.banco_leido}» y no está en la lista de bancos: elígelo a mano o usa «Otro».`);
      }
    } catch (e) {
      setFalla(mensajeAmigable(e) || e?.message || 'No se pudo leer el documento. Llena los datos a mano.');
    } finally { setLeyendo(false); }
  };

  // ¿El papel nombra a esta persona?
  const cruce = useMemo(() => {
    if (!f.nombre_en_documento) return null;
    const [r] = cruzarConElPadron([f.nombre_en_documento], [empleado]);
    return r ? (r.empleado || r.posible ? 'coincide' : 'distinto') : null;
  }, [f.nombre_en_documento, empleado]);

  const fechasMal = !!(f.fecha_inicio && f.fecha_fin && f.fecha_fin < f.fecha_inicio);
  const guardar = async () => {
    setGuardando(true); setFalla(null);
    try {
      const subidas = [];
      for (const h of hojas) {
        const cuerpo = await (await fetch(h.uri)).arrayBuffer();
        subidas.push(await subirFotoDeOrden(empleado.id, h, { cuerpo, contentType: h.tipo }));
      }
      await onGuardar({ ...f, archivos: [...(f.archivos || []), ...subidas] });
      descartar();
    } catch (e) {
      setFalla(mensajeAmigable(e) || e?.message || 'No se pudo guardar.');
      setGuardando(false);
    }
  };
  const cancelar = () => { descartar(); onCancelar(); };

  const opcionesBanco = useMemo(() => {
    const base = op(BANCOS);
    return f.banco && !base.some((o) => o.id === f.banco) ? [{ id: f.banco, label: f.banco }, ...base] : base;
  }, [f.banco]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => !guardando && cancelar()}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{f.id ? 'Editar orden de descuento' : 'Nueva orden de descuento'}</Text>
            <Pressable onPress={cancelar} disabled={guardando} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cancelar</Text>
            </Pressable>
          </View>
          {recuperado ? <Nota texto="Se recuperó lo que habías escrito antes." /> : null}

          <Seccion titulo="El documento" pie="Se leen las fotos una sola vez. Todo lo que traiga queda editable; un PDF se guarda, pero sus datos se escriben a mano.">
            {hojas.map((h, i) => (
              <View key={`${h.uri}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }} numberOfLines={1}>
                  {`${hojas.length > 1 ? `Hoja ${i + 1}` : 'Foto del documento'} · ${esPdf(h) ? 'PDF' : 'foto'}`}
                </Text>
                <Enlace texto="Quitar" color={MARCA.rojo} onPress={() => setHojas((p) => p.filter((_, j) => j !== i))} deshabilitado={guardando} />
              </View>
            ))}
            {hojas.length < MAX_HOJAS ? (
              <Enlace texto={hojas.length ? 'Otra hoja' : 'Adjuntar el documento'} onPress={agregarHoja} deshabilitado={guardando || leyendo} />
            ) : null}
            {imagenes.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Enlace texto={leyendo ? 'Leyendo…' : 'Leer los datos del documento'} onPress={leer} deshabilitado={leyendo || guardando} />
                {leyendo ? <ActivityIndicator /> : null}
              </View>
            ) : null}
            {(f.archivos || []).length ? (
              <Nota texto={`Ya guardadas: ${f.archivos.length} hoja${f.archivos.length === 1 ? '' : 's'}. Las nuevas se agregan.`} />
            ) : null}
          </Seccion>

          {f.nombre_en_documento ? (
            <Nota tono={cruce === 'distinto' ? 'cuidado' : 'bien'} texto={cruce === 'distinto'
              ? `El documento nombra a ${f.nombre_en_documento}, que no parece ser esta persona. Revísalo antes de guardar.`
              : `El documento es de ${f.nombre_en_documento} — coincide con la ficha.`} />
          ) : null}
          {aviso ? <Nota texto={aviso} /> : null}

          <Seccion titulo="El préstamo">
            <Elegir rotulo="Banco" valor={f.banco} opciones={opcionesBanco} onCambiar={(v) => set('banco')(v || '')} vacio="Sin indicar" />
            <CampoConRotulo rotulo="N° de préstamo" value={texto(f.referencia)} onChangeText={set('referencia')} placeholder="Opcional" />
            <CampoConRotulo rotulo="Monto del préstamo ($)" value={texto(f.monto_prestamo)} onChangeText={set('monto_prestamo')} keyboardType="decimal-pad" />
            <CampoConRotulo rotulo="Tasa de interés (% anual)" value={texto(f.tasa_interes)} onChangeText={set('tasa_interes')} keyboardType="decimal-pad" />
            <CampoConRotulo rotulo="Cuota a descontar ($)" value={texto(f.cuota)} onChangeText={set('cuota')} keyboardType="decimal-pad" />
            <Elegir rotulo="Cada cuánto" valor={f.periodicidad || 'MENSUAL'} opciones={PERIODICIDAD} onCambiar={(v) => set('periodicidad')(v || 'MENSUAL')} />
            <CampoConRotulo rotulo="Plazo (n° de cuotas)" value={texto(f.plazo_cuotas)} onChangeText={(t) => set('plazo_cuotas')(t.replace(/\D/g, ''))} keyboardType="number-pad" />
            <Elegir rotulo="Estado" valor={f.estado || 'VIGENTE'} opciones={ESTADOS} onCambiar={(v) => set('estado')(v || 'VIGENTE')} />
            <CampoFecha rotulo="Primera cuota" valor={f.fecha_inicio} onCambiar={set('fecha_inicio')} />
            <CampoFecha rotulo="Última cuota" valor={f.fecha_fin} onCambiar={set('fecha_fin')} desde={f.fecha_inicio || undefined}
              error={fechasMal ? 'La última cuota no puede ser antes de la primera.' : null} />
            {!f.fecha_fin && f.fecha_inicio && f.plazo_cuotas ? (
              <Enlace texto="Calcular con el plazo" onPress={() => set('fecha_fin')(finDesdePlazo(f.fecha_inicio, Number(f.plazo_cuotas), f.periodicidad))} />
            ) : null}
          </Seccion>

          {falla ? <Nota tono="freno" texto={falla} /> : null}
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar orden'} onPress={guardar} deshabilitado={guardando || leyendo || fechasMal} />
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}

/**
 * `empleado`: `{ id, name, first_names, last_names }` de la ficha (o de la que
 * se enlaza), o `null` en el alta de alguien nuevo.
 */
export default function OrdenesDeDescuento({ empleado, puedeEditar }) {
  const appendAuditLog = useStaffStore((s) => s.appendAuditLog);
  const [ordenes, setOrdenes] = useState(null);
  const [error, setError] = useState(null);
  const [editando, setEditando] = useState(null);
  const id = empleado?.id || null;

  const [vuelta, setVuelta] = useState(0);
  const cargar = useCallback(() => setVuelta((v) => v + 1), []);
  useEffect(() => {
    if (!id) return undefined;
    let vivo = true;
    fetchOrdenes(id)
      .then((o) => { if (vivo) { setError(null); setOrdenes(o); } })
      .catch((e) => { if (vivo) { setError(mensajeAmigable(e) || 'No se pudieron cargar las órdenes.'); setOrdenes([]); } });
    return () => { vivo = false; };
  }, [id, vuelta]);

  if (!id) {
    return (
      <Seccion titulo="Órdenes de descuento">
        <Nota texto="Se agregan cuando la ficha ya existe: guárdala y ábrela de nuevo para cargar el préstamo. Si esta persona ya trabajaba aquí, enlázala con su ficha (pestaña Personal) y aparecen aquí mismo." />
        <Enlace texto="Agregar orden" deshabilitado onPress={() => {}} />
      </Seccion>
    );
  }

  const vigentes = (ordenes || []).filter((o) => o.estado === 'VIGENTE');
  const cuotaMensual = vigentes.reduce((s, o) => s + (Number(o.cuota) || 0) * (o.periodicidad === 'QUINCENAL' ? 2 : 1), 0);

  const borrar = (o) => Alert.alert('Borrar orden de descuento',
    `¿Borrar la orden de ${o.banco || 'este banco'}? Si ya terminó de pagarse, mejor márcala como finalizada para que quede el historial.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => {
        try {
          await borrarOrden(o.id);
          appendAuditLog?.('ORDEN_DESCUENTO_BORRAR', String(id), { orden: o.id, banco: o.banco });
          listo('Orden borrada', o.banco || '');
          cargar();
        } catch (e) { fallo('No se pudo borrar', mensajeAmigable(e) || e?.message); }
      } },
    ]);

  return (
    <>
      <Seccion titulo="Órdenes de descuento"
        pie={`Préstamos que la empresa descuenta de planilla y paga al banco.${vigentes.length ? ` ${vigentes.length} vigente${vigentes.length === 1 ? '' : 's'} · ${dinero(cuotaMensual)} al mes.` : ''}`}>
        {error ? <Nota tono="freno" texto={error} /> : null}
        {ordenes === null ? <ActivityIndicator /> : !ordenes.length ? <Nota texto="Sin órdenes de descuento." /> : ordenes.map((o, i) => (
          <Orden key={o.id} o={o} primero={!i} puedeEditar={puedeEditar} onEditar={() => setEditando({ ...VACIA, ...o })} onBorrar={() => borrar(o)} />
        ))}
        {puedeEditar ? <Enlace texto="Agregar orden" onPress={() => setEditando({ ...VACIA })} /> : null}
      </Seccion>
      {editando ? (
        <EditorDeOrden inicial={editando} empleado={empleado} onCancelar={() => setEditando(null)}
          onGuardar={async (orden) => {
            const nueva = !orden.id;
            const g = await guardarOrden(id, orden);
            appendAuditLog?.(nueva ? 'ORDEN_DESCUENTO_CREAR' : 'ORDEN_DESCUENTO_EDITAR', String(id), { orden: g.id, banco: g.banco, cuota: g.cuota });
            setEditando(null);
            listo('Orden guardada', g.banco || '');
            cargar();
          }} />
      ) : null}
    </>
  );
}
