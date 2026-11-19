// Un traslado, NATIVO: se abre desde la lista de Traslados, desde una caja
// escaneada o desde un aviso. Hace lo que el portal hace en `DecisionTraslado`
// y `FilaPorRecibir`, con las mismas funciones del núcleo:
//
//   · Si está PENDIENTE y me toca contestar: cuánto sale de cada renglón (la
//     casilla viene puesta en lo que alcanza, `paquetesQueSalen`), «¿por qué no
//     sale todo?» si se recorta, y enviar (`despacharTraslado`) — o rechazar
//     con motivo de la lista cerrada (`rechazarTraslado`), llevando la
//     sugerencia de dónde sí hay.
//   · Si ya salió y es para mi sala: recibir (`recibirTraslado`), anotando lo
//     que faltó renglón por renglón.
//   · Si no: el resumen de cómo terminó.
//
// La existencia se relee AL ABRIR, no al apretar: el número de la casilla tiene
// que ser el de ahora.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { Presionable as Pressable } from '../../componentes/Tocable';
import Refrescar from '../../componentes/Refrescar';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchApprovalRequestById } from '@nucleo/data/requests';
import { despacharTraslado, fetchDisponibilidadTraslado, fetchLotesDeSalaEnUnidades, MOTIVOS_RECHAZO, rechazarTraslado, recibirTraslado } from '@nucleo/data/traslados';
import { eleccionEfectiva, opcionesDeLote, venceMasCortoQueLoPedido } from '@nucleo/utils/loteDeEnvio';
import { esLoteGenerico } from '@nucleo/utils/unidadesInventario';
import { construirTicketDeTraslado } from '@nucleo/utils/trasladoTicket';
import { hoySV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { loQueSeManda, nombreDeLinea, paquetesQueSalen, sugerenciaDeRechazo } from '@nucleo/utils/decisionTraslado';
import { loQueLlego, loQueNoSalio, metaDelEnvio, renglonesDe } from '@nucleo/utils/trasladoTexto';
import { buscadorDePersonas, desdeHace, motivoDeRechazo } from '@nucleo/utils/movimientoTexto';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fmtVence } from '@nucleo/utils/pedirTraslado';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { loQueVaEnLaBolsa, loQueViajo, ticketParaReimprimir } from '@nucleo/utils/imprimirTraslado';
import { imprimirEnLaSala } from '../../componentes/imprimir';
import Vidrio from '../../componentes/Vidrio';
import Avatar from '../../componentes/Avatar';
import Evidencia from '../../componentes/traslados/Evidencia';
import { Pildora, Ruta } from '../../componentes/traslados/Tarjeta';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { MARCA, FONDO_CONTROL, tintaSobre } from '../../componentes/inicio/marca';
import { avisar, fallo, listo, trabajando } from '../../componentes/Progreso';
import { usePorDecidir } from '../../componentes/porDecidir';
import { BotonGrande, Campo, PantallaSinDato } from '../../componentes/formulario/Piezas';
import { MAYUSCULAS } from '../../tema/mayusculas';
import MarcaDeEleccion from '../../componentes/MarcaDeEleccion';
import LoteDeLaCaja, { LOTE_DE_CAJA_VACIO } from '../../componentes/LoteDeLaCaja';

function Bloque({ titulo, children }) {
  return (
    <View style={{ gap: 7 }}>
      {titulo ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: MAYUSCULAS, letterSpacing: 0.4, marginLeft: 16 }}>{titulo}</Text> : null}
      <Vidrio radio={20}><View style={{ padding: 14, gap: 10 }}>{children}</View></Vidrio>
    </View>
  );
}

function Cantidad({ valor, max, onCambiar, etiqueta }) {
  const n = Number(valor) || 0;
  const mover = (d) => { const v = Math.max(0, Math.min(max, n + d)); if (v !== n) { Haptics.selectionAsync().catch(() => {}); onCambiar(String(v)); } };
  const Boton = ({ d, texto }) => (
    <Pressable onPress={() => mover(d)} hitSlop={6} accessibilityLabel={`${d > 0 ? 'Más' : 'Menos'} ${etiqueta}`}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? 'rgba(127,127,127,0.35)' : 'rgba(127,127,127,0.2)' })}>
      <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '600', marginTop: -2 }}>{texto}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Boton d={-1} texto="−" />
      <Campo multiline={false} value={String(valor ?? '')} onChangeText={(t) => onCambiar(t.replace(/\D/g, ''))} keyboardType="number-pad"
        style={{ width: 52, paddingHorizontal: 0, textAlign: 'center', color: colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}
        accessibilityLabel={`Cuántos ${etiqueta}`} />
      <Boton d={1} texto="+" />
    </View>
  );
}

const mesAnio = (v) => { const [a, m] = String(v || '').split('-'); return a && m ? `${m}/${a}` : 'sin fecha'; };
const minus = (t) => String(t || '').toLowerCase();
const mismoLote = (a, b) => Boolean(a && b && a.lote === b.lote && (a.vence || '') === (b.vence || ''));

// Una opción que se toca (un lote, mandar en unidades). Elegida: llena.
function Opcion({ texto, elegida, onPress }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      accessibilityRole="radio" accessibilityState={{ checked: elegida }}
      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12,
        backgroundColor: elegida ? MARCA.azul : FONDO_CONTROL }}>
      <Text style={{ color: elegida ? tintaSobre(MARCA.azul) : colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

export default function Traslado() {
  const { id } = useLocalSearchParams();
  const { user, hasPermission, getScope } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const persona = useMemo(() => buscadorDePersonas(empleados), [empleados]);
  const [fila, setFila] = useState(undefined);
  const [disp, setDisp] = useState(null);
  const [cuantos, setCuantos] = useState({});
  const [porQue, setPorQue] = useState('');
  const [modo, setModo] = useState(null);          // null | 'rechazo'
  const [motivo, setMotivo] = useState(null);
  const [texto, setTexto] = useState('');
  const [faltan, setFaltan] = useState({});
  const [notaFalta, setNotaFalta] = useState('');
  // Lo que vino DE MÁS (2026-11-12): se descuenta de la sala de origen y se
  // suma a ésta al recibir (portal: «Vino algo de más»).
  const [sobran, setSobran] = useState({});
  /* Lo que el servidor pide antes de despachar (2026-11-13): el lote y el
   * vencimiento de la caja de un regulado sin lote (`FALTA_LOTE_DE_GENERICO`),
   * o el vencimiento de un perecedero sin fecha (`FALTA_VENCE`). */
  const [pideLote, setPideLote] = useState([]);    // [{ posicion, producto, unidades }]
  const [pideVence, setPideVence] = useState([]);
  const [cajas, setCajas] = useState({});          // { 'L|pos' | 'V|pos': valor de LoteDeLaCaja }
  /* Lo demás que el servidor puede contestar al despachar (portal:
   * `DecisionTraslado`, 2026-11-05):
   *   · `CAJA_EN_UNIDADES`: ningún lote completa la presentación; se ofrece
   *     mandarla en unidades y quien despacha lo confirma.
   *   · `PROPUESTA_*`: el lote que sale vence antes que lo pedido; se le
   *     pregunta a la sala que pidió (enviada NO es un fallo).
   *   · `LOTE_PEDIDO_NO_ESTA`: el lote pedido no está; se elige cuál sale. */
  const [cajaEnUnidades, setCajaEnUnidades] = useState([]);
  const [aceptaUnidades, setAceptaUnidades] = useState(() => new Set());
  const [noEsta, setNoEsta] = useState(null);      // { [posicion]: { pedidos, opciones } }
  const [eleccion, setEleccion] = useState({});    // { [posicion]: { lote, vence, sinAsignar } }
  const [propuestaLocal, setPropuestaLocal] = useState(null);
  const [lotesSala, setLotesSala] = useState({});  // { [erp]: lotesEnUnidades | null }
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error } = await fetchApprovalRequestById(id);
    setFila(error ? null : data);
    if (data?.status === 'PENDING') {
      const r = await fetchDisponibilidadTraslado(id);
      if (!r.error) {
        const d = r.disponibilidad;
        const items = data.metadata?.items || [];
        const lin = Array.isArray(d?.lineas) ? d.lineas : [];
        setDisp(d);
        setCuantos(Object.fromEntries(lin.map((l) => [l.idx, String(paquetesQueSalen(l, items[l.idx]))])));
        // Sin nada en físico la única salida es rechazar, con el motivo puesto.
        if (lin.length && lin.every((l) => paquetesQueSalen(l, items[l.idx]) === 0)) { setModo('rechazo'); setMotivo('Sin existencia en físico'); }
      }
    }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);
  // Los lotes de la sala que despacha, para poder cambiar el de una propuesta
  // (portal: «Si cambias el lote, se le vuelve a preguntar»).
  const origenErp = Number(disp?.origen?.erp_sucursal_id) || null;
  const lineasPropuesta = (propuestaLocal ?? fila?.metadata?.propuesta_lote)?.lineas;
  const erpsPropuesta = useMemo(() => [...new Set((lineasPropuesta ?? [])
    .map((p) => Number(fila?.metadata?.items?.[Number(p.posicion)]?.erp_product_id)).filter(Boolean))].join(','), [lineasPropuesta, fila]);
  useEffect(() => {
    if (!origenErp || !erpsPropuesta) return undefined;
    let vivo = true;
    erpsPropuesta.split(',').map(Number).forEach((erp) => {
      fetchLotesDeSalaEnUnidades(erp, origenErp).then((l) => { if (vivo) setLotesSala((x) => ({ ...x, [erp]: l })); }).catch(() => {});
    });
    return () => { vivo = false; };
  }, [origenErp, erpsPropuesta]);

  if (fila === undefined) return <PantallaSinDato titulo="Traslado" cargando />;
  if (!fila) return <PantallaSinDato titulo="Traslado" texto="Este traslado ya no está disponible." />;

  const m = fila.metadata ?? {};
  const items = Array.isArray(m.items) ? m.items : [];
  const lineas = Array.isArray(disp?.lineas) ? disp.lineas : [];
  const miSala = String(salaDelUsuario(user) ?? '');
  const todas = getScope?.('traslados') === 'ALL';
  const pendiente = fila.status === 'PENDING';
  const enCamino = fila.status === 'APPROVED' && m.erp_traslado && !m.erp_recibido;
  const puedeContestar = pendiente && hasPermission('traslados', 'can_approve');
  const puedeRecibir = enCamino && hasPermission('traslados', 'can_approve')
    && (todas || String(m.branch_id) === miSala || String(fila.employee_id) === String(user?.id));
  const { aceptadas, hayQueMandar, recortado, nadaEnFisico } = loQueSeManda(lineas, items, cuantos);
  const sugerencia = sugerenciaDeRechazo(lineas, items);
  const pide = persona(fila.employee_id);

  // ── El lote que sale (pedido que no está, o propuesta a la sala que pidió) ──
  const propuesta = propuestaLocal ?? m.propuesta_lote ?? null;
  const propVigente = propuesta && ['pendiente', 'aceptada'].includes(propuesta.estado) ? propuesta : null;
  const salaQuePide = m.branch_name ?? 'la sucursal que pidió';
  const horaSola = propuesta?.propuesta_at ? hora12(new Date(new Date(propuesta.propuesta_at).getTime() + 3 * 3600_000)) : null;
  const sinDatos = lineas.length === 0;
  const lineasLote = items.map((it, pos) => {
    const srv = noEsta?.[pos];
    const dp = propVigente?.lineas?.find((p) => Number(p.posicion) === pos) ?? null;
    if (!srv && !dp) return null;
    const erp = Number(it?.erp_product_id);
    const factor = Number(it?.factor) || 1;
    const paquetes = sinDatos ? (Number(it?.cantidad) || 0) : (aceptadas.find((a) => a.i === pos)?.cantidad ?? 0);
    if (!paquetes) return null;
    const sala = lotesSala[erp];
    const opciones = srv?.opciones ?? (sala ? opcionesDeLote(sala, paquetes, factor) : sala === null ? [] : null);
    const desdePropuesta = dp ? (dp.sin_asignar ? { lote: 'GENERICO', vence: '', sinAsignar: true } : { lote: dp.lote, vence: dp.vence, sinAsignar: false }) : null;
    return { pos, erp, factor, paquetes, opciones, pedidos: srv?.pedidos ?? [], dp,
      producto: it?.descripcion ?? `Producto ${erp}`, valor: eleccionEfectiva(eleccion[pos] ?? desdePropuesta, opciones) };
  }).filter(Boolean);
  const conEleccion = new Map(lineasLote.filter((x) => x.valor).map((x) => [x.pos, x]));
  const esperandoRespuesta = propuesta?.estado === 'pendiente' && Object.keys(eleccion).length === 0;
  // Elegido «sin lote asignado»: el lote lo dice la caja, como cuando lo pide el servidor.
  const pidenLote = [
    ...pideLote.filter((x) => !conEleccion.has(x.posicion)),
    ...[...conEleccion.values()].filter((x) => x.valor.sinAsignar)
      .map((x) => ({ posicion: x.pos, producto: x.producto, unidades: x.paquetes * x.factor })),
  ];
  const hoy = hoySV();
  const cortosAhora = lineasLote.filter((x) => x.valor && venceMasCortoQueLoPedido(
    x.valor.sinAsignar ? cajas[`L|${x.pos}`]?.envio?.vence : x.valor.vence, items[x.pos], hoy));
  const sinAceptar = cajaEnUnidades.find((c) => !aceptaUnidades.has(c.posicion));
  const faltaParaEnviar = lineasLote.find((x) => !x.valor) ? 'Elige el lote que sale.'
    : esperandoRespuesta ? `Espera la respuesta de ${salaQuePide} o cambia el lote.`
    : sinAceptar ? `Decide si ${sinAceptar.producto ?? 'el producto'} sale en unidades.` : null;

  const enviar = async () => {
    setOcupado(true); trabajando('Enviando traslado…');
    const r = await despacharTraslado(fila.id, recortado ? porQue.trim() : '', recortado ? aceptadas : null,
      pidenLote.map((x) => ({ posicion: x.posicion, ...cajas[`L|${x.posicion}`].envio })),
      [...conEleccion.values()].map((x) => ({ posicion: x.pos, lote: x.valor.lote, vence: x.valor.vence })),
      [...aceptaUnidades],
      pideVence.map((x) => ({ posicion: x.posicion, vence: cajas[`V|${x.posicion}`].envio.vence })));
    setOcupado(false);
    if (r?.codigo === 'FALTA_LOTE_DE_GENERICO' && Array.isArray(r.lineas)) {
      setPideLote(r.lineas); fallo('Falta el lote de la caja', r.error); return;
    }
    if (r?.codigo === 'FALTA_VENCE' && Array.isArray(r.lineas)) {
      setPideVence(r.lineas); fallo('Falta el vencimiento', r.error); return;
    }
    // Ningún lote completa la presentación: se ofrece en unidades.
    if (r?.codigo === 'CAJA_EN_UNIDADES' && Array.isArray(r.lineas)) {
      setCajaEnUnidades(r.lineas); avisar('¿Sale en unidades?', 'Ningún lote completa la presentación. Revisa cómo saldría y decide.'); return;
    }
    // Vence antes que lo pedido: se le preguntó a la sala que pidió. Enviada no es un fallo.
    if (['PROPUESTA_ENVIADA', 'PROPUESTA_PENDIENTE', 'PROPUESTA_RECHAZADA'].includes(r?.codigo) && r.propuesta) {
      setPropuestaLocal(r.propuesta); setEleccion({});
      if (r.codigo === 'PROPUESTA_RECHAZADA') fallo('No aceptaron el lote', r.error ?? `${salaQuePide} no aceptó el lote que vence antes. Elige otro o rechaza.`);
      else listo(`Le preguntamos a ${salaQuePide}`, 'El lote vence antes que lo pedido. Cuando conteste, lo envías.');
      return;
    }
    // El lote pedido no está: se elige con las opciones que da el servidor.
    if (r?.codigo === 'LOTE_PEDIDO_NO_ESTA' && Array.isArray(r.lineas)) {
      setNoEsta(Object.fromEntries(r.lineas.map((x) => {
        const f = Number(items[x.posicion]?.factor) || 1;
        return [x.posicion, { pedidos: x.pedidos ?? [], opciones: (x.disponibles ?? []).map((d) => ({
          lote: d.lote, vence: d.vence, unidades: Number(d.paquetes) * f, sinAsignar: esLoteGenerico(d.lote) })) }];
      })));
      fallo('El lote pedido no está', r.error ?? 'Elige cuál lote sale.'); return;
    }
    let otra = null;
    if (!r?.ok) {
      ({ data: otra } = await fetchApprovalRequestById(fila.id).catch(() => ({ data: null })));
      if (otra?.status !== 'APPROVED') { fallo('No se pudo enviar', r?.error ?? 'Inténtalo de nuevo.'); return; }
    }
    usePorDecidir.getState().quitar(fila.id);
    /* El ticket que va pegado a la bolsa, DESPUÉS del despacho (lleva el
     * número del traslado), en la caja de quien despacha: ahí está la bolsa
     * (portal: `DecisionTraslado` › `imprimirTicketDeTraslado`). Lo que salió,
     * con el lote y el vence que de verdad viajan. Un papel que no sale no
     * deshace el envío: se dice aparte y se reimprime desde aquí. */
    let papel;
    if (r?.ok) {
      papel = { ticket: construirTicketDeTraslado({
        familia: 'solicitud', aplicado: r.aplicado, origen: m.origen_branch_name, destino: m.branch_name, pide: pide?.name ?? null,
        items: r.aplicado?.detalle?.length ? loQueViajo(r.aplicado.detalle, items) : loQueVaEnLaBolsa(items, recortado ? aceptadas : []),
      }), titulo: ['SOLICITUD', r.aplicado?.id_traslado, m.branch_name].filter(Boolean).join(' ') };
    } else {
      // Ya estaba enviado (otra persona o un reintento): el ticket guardado.
      papel = ticketParaReimprimir({ metadata: otra?.metadata ?? {}, pide: pide?.name ?? null, familia: 'solicitud' });
    }
    const impreso = papel
      ? await imprimirEnLaSala(papel.ticket, miSala || null, papel.titulo)
      : { ok: false, detalle: 'Ese traslado no tiene número. Su ticket se confirma a mano.' };
    const titulo = recortado ? 'Enviado lo que hay' : 'Traslado enviado';
    if (impreso.ok) listo(titulo, 'Pega el ticket en la bolsa.');
    else avisar(`${titulo}, pero el ticket no salió`, `${impreso.detalle ?? 'Sin detalle.'} Reimprímelo desde el traslado.`);
    router.back();
  };

  const rechazar = async () => {
    setOcupado(true); trabajando('Rechazando…');
    const { error } = await rechazarTraslado(fila.id, motivo, texto.trim(), sugerencia);
    setOcupado(false);
    if (error) { fallo('No se pudo rechazar', error.message ?? String(error)); return; }
    usePorDecidir.getState().quitar(fila.id);
    listo('Traslado rechazado', sugerencia ? `Se le sugirió: ${sugerencia}` : undefined);
    router.back();
  };

  const llegaron = loQueLlego(m);
  const faltantes = llegaron.map((l) => ({ posicion: l.posicion, cantidad: Number(faltan[l.posicion]) || 0, nota: notaFalta.trim() }))
    .filter((f) => f.cantidad > 0);
  const sobrantes = llegaron.map((l) => ({ posicion: l.posicion, cantidad: Number(sobran[l.posicion]) || 0, nota: notaFalta.trim() }))
    .filter((f) => f.cantidad > 0);
  // Volver a sacar el MISMO ticket de la bolsa, y nada más: lo que se arregla
  // es una impresora, no un hecho del negocio (portal: «Imprimir el ticket»).
  // Sale en la caja de quien lo pide. Sin número no hay barras: no se ofrece.
  const imprimir = async () => {
    const papel = ticketParaReimprimir({ metadata: m, pide: pide?.name ?? null, familia: 'solicitud' });
    if (!papel) { fallo('Sin ticket', 'Ese traslado no tiene número. Su ticket se confirma a mano.'); return; }
    trabajando('Mandando a imprimir…');
    const r = await imprimirEnLaSala(papel.ticket, miSala || null, papel.titulo);
    if (r.ok) listo('Ticket', r.detalle); else fallo('No se pudo imprimir', r.detalle);
  };

  const recibir = async () => {
    setOcupado(true); trabajando('Recibiendo…');
    const r = await recibirTraslado(fila.id, faltantes, sobrantes);
    setOcupado(false);
    if (!r?.ok && r?.codigo !== 'YA_RECIBIDO') { fallo('No se pudo recibir', r?.error ?? 'Inténtalo de nuevo.'); return; }
    const errSobrante = r?.sobrante_error ?? (r?.sobrante?.ok === false ? r.sobrante.error : null);
    if (r?.faltante_error) fallo('Recibido, pero sin anotar lo que faltó', r.faltante_error);
    else if (errSobrante) fallo('Recibido, pero lo de más no pasó', errSobrante);
    else listo(r?.codigo === 'YA_RECIBIDO' ? 'Ya estaba recibido' : 'Recibido',
      [faltantes.length ? `Se avisó a ${m.origen_branch_name ?? 'la otra sucursal'} lo que faltó.` : '',
       r?.sobrante?.ok ? `Lo que vino de más ya está en tu inventario y se le avisó a ${m.origen_branch_name ?? 'la otra sucursal'}.` : '']
        .filter(Boolean).join(' ') || undefined);
    router.back();
  };

  const estado = pendiente ? { texto: 'Por contestar', color: MARCA.ambar }
    : fila.status === 'REJECTED' ? { texto: 'Rechazado', color: MARCA.rojo }
    : m.erp_recibido ? { texto: 'Recibido', color: MARCA.verde }
    : enCamino ? { texto: 'En camino', color: MARCA.azulClaro } : { texto: fila.status, color: MARCA.gris };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Traslado' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive"
          refreshControl={<Refrescar refreshing={false} onRefresh={cargar} />}>

          {/* Quién pide, de dónde a dónde, y cuándo. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar empleado={pide} tamano={48} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '700' }}>{shortEmployeeName(pide)}</Text>
              <Ruta desde={m.origen_branch_name} hacia={m.branch_name} />
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Pidió {desdeHace(fila.created_at, Date.now())}</Text>
            </View>
            <Pildora texto={estado.texto} color={estado.color} />
          </View>

          {/* Qué se pide: renglones y lotes. Mientras se contesta, cada renglón
              lleva su casilla. */}
          {/* Ya despachado se muestra lo que VIAJA, y aparte lo que no salió:
              es la lista contra la que se coteja la bolsa al recibirla. */}
          <Bloque titulo={puedeContestar && !modo && lineas.length ? 'Cuánto envías' : m.erp_traslado ? 'Lo que viene' : 'Lo que se pide'}>
            {renglonesDe(m.erp_traslado ? metaDelEnvio(m) : m).map((r, i) => {
              const l = lineas.find((x) => x.idx === r.idx);
              const max = l ? paquetesQueSalen(l, items[r.idx]) : 0;
              const sale = Math.min(Number(cuantos[r.idx]) || 0, r.cantidad);
              const factor = Number(items[r.idx]?.factor) || 1;
              const queda = (l?.unidades ?? 0) - sale * factor;
              const editar = puedeContestar && !modo && l && !nadaEnFisico;
              return (
                <View key={r.idx} style={{ gap: 4, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{r.nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {editar ? `de ${r.cantidad} ${r.presentacion}${max < r.cantidad ? ` · alcanza para ${max}` : ''}` : `${r.cantidad} ${r.presentacion}`}
                      </Text>
                    </View>
                    {editar ? <Cantidad valor={cuantos[r.idx] ?? ''} max={r.cantidad} etiqueta={nombreDeLinea(l, items)} onCambiar={(v) => setCuantos((c) => ({ ...c, [r.idx]: v }))} /> : null}
                  </View>
                  {r.lotes.map((lt, j) => (
                    <Text key={j} style={{ color: colorSistema.texto2, fontSize: 12 }}>Lote {lt.lote || '—'}{lt.vence ? ` · vence ${fmtVence(lt.vence)}` : ''}{lt.unidades ? ` · ${lt.unidades} u.` : ''}</Text>
                  ))}
                  {/* El mínimo INFORMA, no impide (decisión del usuario, 2026-08-06). */}
                  {editar && sale > 0 && (l.minimo ?? 0) > 0 && queda < l.minimo ? (
                    <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>Te quedas en {queda} y tu mínimo es {l.minimo}.</Text>
                  ) : null}
                </View>
              );
            })}
            {m.reason || fila.note ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nota: {m.reason || fila.note}</Text> : null}
          </Bloque>

          {loQueNoSalio(m).length ? (
            <Bloque titulo="Se pidió y no viene">
              {loQueNoSalio(m).map((r) => (
                <View key={r.idx} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{r.nombre}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14, fontVariant: ['tabular-nums'] }}>{`${r.salio} de ${r.pedida} ${r.presentacion}`}</Text>
                </View>
              ))}
            </Bloque>
          ) : null}

          {/* ── Contestar ── */}
          {puedeContestar && disp?.respaldo ? (
            <Text style={{ color: MARCA.azulClaro, fontSize: 14 }}>{disp.respaldo.sala} está cerrada. Lo despachas tú.</Text>
          ) : null}
          {puedeContestar && nadaEnFisico ? (
            <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>
              Ya no puedes enviarlo. Quedan {lineas[0]?.unidades ?? 0}.{sugerencia ? ` ${sugerencia}.` : ''}
            </Text>
          ) : null}

          {puedeContestar && !modo ? (
            <View style={{ gap: 12 }}>
              {recortado ? <Campo value={porQue} onChangeText={setPorQue} placeholder="¿Por qué no sale todo?" /> : null}
              {/* La propuesta a la sucursal que pidió. */}
              {propuesta?.estado === 'pendiente' ? (
                <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '600' }}>
                  {`Le preguntamos a ${salaQuePide} si acepta el lote que vence antes.${horaSola ? ` Si nadie contesta, se acepta solo a las ${horaSola}.` : ''} Si cambias el lote, se le vuelve a preguntar.`}
                </Text>
              ) : null}
              {propuesta?.estado === 'aceptada' ? (
                <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '600' }}>
                  {propuesta.auto ? `${salaQuePide} no contestó en 3 horas, así que el lote se aceptó solo. Ya puedes enviarlo.` : `${salaQuePide} aceptó el lote. Ya puedes enviarlo.`}
                </Text>
              ) : null}
              {propuesta?.estado === 'rechazada' ? (
                <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>{`${salaQuePide} no aceptó el lote que vence antes. Elige otro o rechaza la solicitud.`}</Text>
              ) : null}
              {cortosAhora.length && propuesta?.estado !== 'aceptada' ? (
                <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>
                  {`${cortosAhora.length === 1 ? 'El lote elegido vence' : 'Los lotes elegidos vencen'} antes que lo pedido y dentro de 6 meses: al confirmar se le pregunta a ${salaQuePide} antes de enviarlo.`}
                </Text>
              ) : null}

              {/* La caja que sale en unidades. */}
              {cajaEnUnidades.map((c) => {
                const si = aceptaUnidades.has(c.posicion);
                return (
                  <View key={`u${c.posicion}`} style={{ gap: 6 }}>
                    <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '600' }}>
                      {`${c.producto}: ningún lote completa ${c.paquetes === 1 ? 'la' : `las ${c.paquetes}`} ${minus(c.presentacion)}. Puede salir como ${c.unidades} ${minus(c.base)}:`}
                    </Text>
                    {(c.reparto ?? []).map((rp) => (
                      <Text key={`${rp.lote}|${rp.vence}`} style={{ color: colorSistema.texto, fontSize: 14 }}>
                        {`${rp.unidades} del ${esLoteGenerico(rp.lote) || /^gen[eé]rico$/i.test(rp.lote) ? 'sin lote asignado' : `lote ${rp.lote}`}${rp.vence ? ` (vence ${mesAnio(rp.vence)})` : ''}`}
                      </Text>
                    ))}
                    <View style={{ flexDirection: 'row' }}>
                      <Opcion texto={si ? `Sale en ${minus(c.base)}` : `Mandarla en ${c.unidades} ${minus(c.base)}`} elegida={si}
                        onPress={() => setAceptaUnidades((prev) => { const n = new Set(prev); if (si) n.delete(c.posicion); else n.add(c.posicion); return n; })} />
                    </View>
                  </View>
                );
              })}

              {/* El lote que sale, cuando el pedido no está o hay propuesta. */}
              {lineasLote.map((x) => (
                <View key={`e${x.pos}`} style={{ gap: 6 }}>
                  <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '600' }}>
                    {`${items.length > 1 ? `${x.producto}: ` : ''}${x.pedidos.length ? `el lote ${x.pedidos.join(', ')} que pidieron no está en tu sucursal o no alcanza. ¿Cuál mandas?` : '¿Qué lote mandas?'}`}
                  </Text>
                  {x.opciones == null ? (
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Revisando los lotes de tu sucursal…</Text>
                  ) : x.opciones.length === 0 ? (
                    <Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '600' }}>Ningún lote de tu sucursal alcanza para todo lo pedido. Manda menos o rechaza.</Text>
                  ) : (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {x.opciones.map((o) => (
                        <Opcion key={`${o.lote}|${o.vence}`} elegida={mismoLote(x.valor, o)}
                          texto={o.sinAsignar ? `Sin lote asignado · hay ${o.unidades}` : `${o.lote} · vence ${mesAnio(o.vence)} · hay ${o.unidades}`}
                          onPress={() => setEleccion((e) => ({ ...e, [x.pos]: { lote: o.lote, vence: o.vence, sinAsignar: o.sinAsignar } }))} />
                      ))}
                    </View>
                  )}
                  {x.valor ? (
                    <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>
                      {x.valor.sinAsignar ? 'Sale sin lote asignado. Copia abajo el lote de la caja.' : `Sale el lote ${x.valor.lote} (vence ${mesAnio(x.valor.vence)}).`}
                    </Text>
                  ) : (x.opciones?.length ?? 0) > 1 ? (
                    <Text style={{ color: MARCA.ambar, fontSize: 13 }}>{`Hay ${x.opciones.length} lotes: toca el que vas a mandar.`}</Text>
                  ) : null}
                </View>
              ))}

              {[...pidenLote.map((x) => ({ ...x, k: `L|${x.posicion}`, solo: false })),
                ...pideVence.map((x) => ({ ...x, k: `V|${x.posicion}`, solo: true }))].map((x) => (
                <View key={x.k} style={{ gap: 6, marginTop: 8 }}>
                  <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '600' }}>
                    {`${x.producto} · ${x.unidades} ${x.unidades === 1 ? 'unidad' : 'unidades'}. ${x.solo ? 'Copia el vencimiento que trae la caja.' : 'Copia el lote y el vencimiento que trae la caja.'}`}
                  </Text>
                  <LoteDeLaCaja soloVence={x.solo} erpProductId={items[x.posicion]?.erp_product_id} producto={x.producto}
                    valor={cajas[x.k] ?? LOTE_DE_CAJA_VACIO} onChange={(v) => setCajas((c) => ({ ...c, [x.k]: v }))} />
                </View>
              ))}
              {faltaParaEnviar ? <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>{faltaParaEnviar}</Text> : null}
              <BotonGrande texto={recortado ? 'Enviar lo que hay' : 'Confirmar y enviar'} color={MARCA.verde}
                deshabilitado={ocupado || Boolean(faltaParaEnviar) || (lineas.length > 0 && (!hayQueMandar || (recortado && !porQue.trim())))
                  || pidenLote.some((x) => !cajas[`L|${x.posicion}`]?.envio) || pideVence.some((x) => !cajas[`V|${x.posicion}`]?.envio)} onPress={enviar} />
              <BotonGrande texto="Rechazar…" color={MARCA.rojo} borde deshabilitado={ocupado} onPress={() => setModo('rechazo')} />
            </View>
          ) : null}

          {puedeContestar && modo === 'rechazo' ? (
            <Bloque titulo="¿Por qué lo rechazas?">
              {MOTIVOS_RECHAZO.map((mo, i) => (
                <Pressable key={mo} onPress={() => { Haptics.selectionAsync().catch(() => {}); setMotivo(mo); }}
                  style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{mo}</Text>
                  <MarcaDeEleccion elegida={motivo === mo} />
                </Pressable>
              ))}
              <Campo value={texto} onChangeText={setTexto} placeholder={motivo === 'Otro' ? '¿Cuál es el motivo? (obligatorio)' : 'Algo más que quieras decir (opcional)'} />
              {sugerencia ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Se le va a sugerir: {sugerencia}</Text> : null}
              <BotonGrande texto="Rechazar" color={MARCA.rojo} deshabilitado={ocupado || !motivo || (motivo === 'Otro' && !texto.trim())} onPress={rechazar} />
              {!nadaEnFisico ? <BotonGrande texto="Mejor no" color={colorSistema.texto2} borde onPress={() => { setModo(null); setMotivo(null); }} /> : null}
            </Bloque>
          ) : null}

          {/* ── Recibir ── */}
          {puedeRecibir ? (
            <Bloque titulo="¿Faltó o sobró algo?">
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Si llegó todo, deja todo en cero y recibe.</Text>
              {llegaron.map((l) => (
                <View key={l.posicion} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{l.descripcion}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>salieron {l.cantidad}</Text>
                  </View>
                  <Cantidad valor={faltan[l.posicion] ?? '0'} max={l.cantidad} etiqueta={`faltaron de ${l.descripcion}`}
                    onCambiar={(v) => setFaltan((f) => ({ ...f, [l.posicion]: v }))} />
                </View>
              ))}
              <Text style={{ color: colorSistema.texto2, fontSize: 13, marginTop: 6 }}>¿Vino algo de más? Escribe cuántos, en la misma presentación. Se descuentan de {m.origen_branch_name ?? 'la sucursal que envió'} y se suman a tu sucursal.</Text>
              {llegaron.map((l) => (
                <View key={`demas-${l.posicion}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{l.descripcion}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>de más</Text>
                  </View>
                  <Cantidad valor={sobran[l.posicion] ?? '0'} max={9999} etiqueta={`vinieron de más de ${l.descripcion}`}
                    onCambiar={(v) => setSobran((f) => ({ ...f, [l.posicion]: v }))} />
                </View>
              ))}
              {faltantes.length || sobrantes.length ? <Campo value={notaFalta} onChangeText={setNotaFalta} placeholder="¿Qué pasó? (se le avisa a la sucursal que envió)" /> : null}
              <BotonGrande texto={faltantes.length ? 'Recibir y anotar lo que faltó' : sobrantes.length ? 'Recibir y pasar lo de más' : 'Ya llegó, recibir'} color={MARCA.verde}
                deshabilitado={ocupado} onPress={recibir} />
            </Bloque>
          ) : null}
          {enCamino && m.erp_traslado?.id_traslado ? (
            <BotonGrande texto="Imprimir el ticket" color={MARCA.azulClaro} borde deshabilitado={ocupado} onPress={imprimir} />
          ) : null}

          {/* ── Cómo terminó ── */}
          {fila.status === 'REJECTED' ? (
            <Bloque titulo="Rechazado">
              <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{motivoDeRechazo(fila) || 'Sin motivo'}</Text>
            </Bloque>
          ) : null}
          {m.evidencia_urls?.length ? <Evidencia urls={m.evidencia_urls} titulo="Evidencia" /> : null}
          {m.erp_traslado || fila.status === 'REJECTED' ? (
            <Bloque titulo="Trayecto">
              {/* Cada paso con la cara y el nombre corto de quien lo dio, como
                  el registro del portal: pidió → despachó (o rechazó) → recibió. */}
              {[
                { paso: 'Pidió', id: fila.employee_id, nombre: null, at: fila.created_at, color: MARCA.azulClaro },
                fila.status === 'REJECTED'
                  ? { paso: 'Rechazó', id: fila.approver_id, nombre: null, at: fila.updated_at, color: MARCA.rojo }
                  : { paso: m.erp_traslado?.parcial ? 'Despachó incompleto' : 'Despachó', id: m.erp_traslado?.by, nombre: m.erp_traslado?.by_name, at: m.erp_traslado?.at, color: m.erp_traslado?.parcial ? MARCA.ambar : MARCA.verde },
                m.erp_recibido ? { paso: 'Recibió', id: m.erp_recibido.by, nombre: m.erp_recibido.by_name, at: m.erp_recibido.at, color: MARCA.verde } : null,
              ].filter(Boolean).map((p, i, todos) => {
                const quien = p.id ? persona(p.id) : null;
                return (
                  <View key={p.paso} style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ alignItems: 'center' }}>
                      <Avatar empleado={quien ?? { name: p.nombre ?? '?' }} tamano={36} />
                      {i < todos.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 14, backgroundColor: colorSistema.separador, marginVertical: 3 }} /> : null}
                    </View>
                    <View style={{ flex: 1, paddingBottom: i < todos.length - 1 ? 10 : 0 }}>
                      <Text style={{ color: p.color, fontSize: 13, fontWeight: '800' }}>{p.paso}</Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{quien ? shortEmployeeName(quien) : (p.nombre ?? '—')}</Text>
                      {p.at ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{desdeHace(p.at, Date.now())}</Text> : null}
                    </View>
                  </View>
                );
              })}
              {m.erp_traslado?.parcial && fila.approver_note ? <Text style={{ color: MARCA.ambar, fontSize: 13 }}>{`Salió incompleto: ${fila.approver_note}`}</Text> : null}
            </Bloque>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
