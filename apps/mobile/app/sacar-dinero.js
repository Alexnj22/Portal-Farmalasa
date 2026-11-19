// Sacar dinero, NATIVO — la salida de Efectivo del portal (`SalidaDeBolsa.jsx`
// abierto desde Mi caja). Regla del usuario del 3-sep: «todo debe pasar desde
// efectivo»: el dinero sale PRIMERO del cajón, y sólo si no alcanza, de las
// bolsas (`elegirOrigen`, del núcleo).
//
//   · del CAJÓN: `anotarSalida` (edge `operar-caja`, con clave para que dos
//     toques no anoten dos veces) y sale el comprobante del movimiento;
//   · de las BOLSAS: `registrarSalida` reparte entre las más viejas y sale el
//     vale de la operación más la etiqueta nueva de cada bolsa tocada;
//   · MIXTA (la bolsa no alcanza sola): la bolsa registra su parte, la caja el
//     resto ligado a ella (`operacionBolsa`), y si la caja lo rechaza se anula
//     la parte de la bolsa. Un solo vale, el de la bolsa, como en el portal.
//
// Cada motivo (`bolsas_tipos_salida`) dice qué pide: a quién o a qué entidad,
// número de boleta (que no se repita en la sala), foto del comprobante y si
// quien se lo lleva tiene que identificarse con su carné.
//
// Con foto en un motivo donde el papel manda (foto obligatoria + boleta: el POS
// Promerica), la foto se LEE con el mismo lector del portal y llena el monto, el
// número, de qué fue («Remesa Money Gram WS») y la remesadora, igual que
// `SalidaDeBolsa`. Faltaba: la sala anotaba remesas como «POS Promerica» a
// secas y con el monto escrito a mano (P8181, Salud 4, 2026-11-19).
import usePantallaDespierta from '../componentes/usePantallaDespierta';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  anotarSalida, anularSalida, boletaYaRegistrada, estadoDeCaja, fetchBolsas, fetchConceptosDeOtroLado, fetchEntidadesDeSalida, fetchSaldos,
  fetchTiposDeMovimiento, fetchTiposDeSalida, guardarLecturaDeBoleta, leerBoleta, registrarSalida,
} from '@nucleo/data/bolsas';
import { choqueDeSentido, lecturaDeBoleta } from '@nucleo/utils/ingresoDeCaja';
import { TIPOS_OTRO, detalleSuficiente, vaEnOtroLado } from '@nucleo/utils/conceptoDeOtroLado';
import { disponibles, elegirOrigen, totalDisponible } from '@nucleo/utils/bolsasReparto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Fotos, { subirFotosOEncolar } from '../componentes/formulario/Fotos';
import Identidad from '../componentes/Identidad';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { comprobanteDelMovimiento, reimprimirEtiqueta, valeDeLaSalida } from '../componentes/cortes/papel';

// Para cruzar la remesadora impresa con la lista: sin tildes, sin espacios ni signos.
const pegado = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
/* Las mismas tres ayudas de `SalidaDeBolsa` (viven en el componente del portal,
 * no en el núcleo): comparar nombres como la edge `leer-boleta`, la fecha corta
 * del aviso de boleta repetida y «a, b y c» para el aviso de lo que se pisó. */
const normalizarNombre = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const fechaCorta = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short' }) : '');
const juntarConY = (partes) => (partes.length <= 1 ? (partes[0] || '') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`);
const soloDigitos = (v) => String(v ?? '').replace(/\D+/g, '').replace(/^0+/, '');

export default function SacarDinero() {
  usePantallaDespierta('sacar-dinero'); // se cuenta efectivo: la pantalla no se apaga
  const { sala } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const nombreSala = (sucursales || []).find((b) => String(b.id) === String(sala))?.name ?? '';
  const delCajonPermitido = hasPermission('caja_vales', 'can_edit');

  const [tipos, setTipos] = useState([]);
  const [entidades, setEntidades] = useState([]);
  const [efectivo, setEfectivo] = useState(null);
  const [bolsas, setBolsas] = useState([]);
  const [tipo, setTipo] = useState(null);
  const [monto, setMonto] = useState('');
  const [entidad, setEntidad] = useState('');
  const [boleta, setBoleta] = useState('');
  // Las operaciones de bolsa de esta sala con ese número (`boletaYaRegistrada`).
  const [repetida, setRepetida] = useState([]);
  const [nota, setNota] = useState('');
  const [fotos, setFotos] = useState([]);
  const [identidad, setIdentidad] = useState(null);
  const [guardando, setGuardando] = useState(false);
  // Lo que dijo la foto. El monto se cierra sólo si la boleta lo imprime dos
  // veces y coinciden; el número, si se leyó. Quitar la foto los devuelve.
  const [leyendo, setLeyendo] = useState(false);
  const [lectura, setLectura] = useState(null);
  /* La respuesta CRUDA del lector, también cuando falló: con la foto mandando,
   * una foto sin revisar o con la revisión en error no deja registrar
   * (`SalidaDeBolsa`, `problemaDeLaFoto` y «La foto no se revisó»). */
  const [revision, setRevision] = useState(null);
  // Lo que la foto cambió de lo que ya estaba escrito (portal: `pisados`).
  const [pisados, setPisados] = useState([]);
  const [aviso, setAviso] = useState(null);
  const [sentido, setSentido] = useState(null);
  const [montoCerrado, setMontoCerrado] = useState(false);
  const [boletaCerrada, setBoletaCerrada] = useState(false);
  // Las reglas del cajón, las mismas del servidor (`caja_movimiento_regla`).
  const [tiposCaja, setTiposCaja] = useState([]);
  const [conceptos, setConceptos] = useState([]);
  const [motivoSinFoto, setMotivoSinFoto] = useState('');
  const [clave] = useState(() => `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    let vivo = true;
    fetchTiposDeSalida().then((x) => vivo && setTipos(x));
    fetchEntidadesDeSalida().then((x) => vivo && setEntidades(x));
    fetchTiposDeMovimiento().then((x) => vivo && setTiposCaja(x));
    fetchConceptosDeOtroLado().then((x) => vivo && setConceptos(x));
    if (sala) {
      estadoDeCaja(sala).then((e) => vivo && setEfectivo(e?.error ? null : (e?.efectivo ?? null)));
      fetchBolsas({ estados: ['ABIERTA'] }).then(async (lista) => {
        const mias = (lista || []).filter((b) => String(b.branch_id) === String(sala));
        const saldos = await fetchSaldos(mias.map((b) => b.id));
        if (vivo) setBolsas(disponibles(mias, saldos ?? new Map()));
      });
    }
    return () => { vivo = false; };
  }, [sala]);

  const t = tipos.find((x) => x.codigo === tipo && x.activo) || null;
  const opcionesEntidad = entidades.filter((e) => e.tipo === tipo).map((e) => e.nombre);
  // Igual que el portal: el papel manda cuando el motivo exige foto y boleta.
  const laFotoManda = t?.foto === 'OBLIGATORIA' && !!t?.pide_boleta;

  const olvidarLectura = () => {
    setLectura(null); setRevision(null); setPisados([]); setAviso(null); setSentido(null); setMontoCerrado(false); setBoletaCerrada(false);
  };

  // Al poner la foto se lee; al quitarla se olvida lo que dijo.
  const alCambiarFotos = async (lista) => {
    setFotos(lista);
    olvidarLectura();
    const f = lista[0];
    if (!f || !laFotoManda) return;
    setLeyendo(true);
    /* Lo escrito viaja como lo ESPERADO, igual que el portal: el servidor lo
     * coteja contra el papel y su `veredicto` frena si no cuadra. */
    const r = await leerBoleta(f, {
      entidad: entidad.trim() || null,
      numeroBoleta: boleta.trim() || null,
      monto: Number.isFinite(n) && n > 0 ? n : null,
    });
    setLeyendo(false);
    setRevision(r ?? { error: true });
    const l = lecturaDeBoleta(r, { pideBoleta: true });
    setAviso(l.aviso);
    if (l.error) return;
    setLectura(l.lectura);
    /* Lo que el papel pisa se DICE (portal, `pisados`): un dato escrito que
     * cambia solo y en silencio es la forma de que nadie confíe en el que quedó. */
    const queda = [];
    const habiaMonto = String(monto).trim();
    if (l.monto != null) {
      if (habiaMonto && Math.abs(Number(habiaMonto.replace(',', '.')) - Number(l.monto)) > 0.005) queda.push('el monto');
      if (r?.montoConfianza === 'CONTRADICHO') queda.push('el monto, que la boleta dice dos veces y no coinciden');
    }
    if (l.boleta != null && boleta.trim() && soloDigitos(boleta) !== soloDigitos(l.boleta)) queda.push('el número');
    if (l.concepto != null && nota.trim() && normalizarNombre(nota) !== normalizarNombre(l.concepto)) queda.push('de qué fue');
    setPisados(queda);
    if (l.monto != null) setMonto(l.monto);
    if (l.boleta != null) setBoleta(l.boleta);
    if (l.concepto != null) setNota(l.concepto);
    setMontoCerrado(!!l.puesto.monto);
    setBoletaCerrada(!!l.puesto.boleta);
    setSentido(choqueDeSentido(r, false));
    /* La remesadora SÓLO si el papel dice que es remesa y lo que nombra está en
     * la lista: arriba va el banco del POS, que no es la remesadora, y «RIA»
     * cabe dentro de «FERRETERIA» (ver `SalidaDeBolsa`). */
    const leido = r?.leido || {};
    const diceRemesa = String(leido.tipo_operacion || '').toUpperCase() === 'REMESA' || !!String(leido.red_remesas || '').trim();
    // Como el portal: sólo si nadie la eligió todavía.
    if (diceRemesa && !entidad.trim() && opcionesEntidad.length) {
      const impresos = [leido.red_remesas, ...(Array.isArray(leido.nombres) ? leido.nombres : []), leido.entidad].map(pegado).filter(Boolean);
      const acierto = opcionesEntidad.find((o) => impresos.some((nom) => nom.includes(pegado(o)) || pegado(o).includes(nom)));
      if (acierto) setEntidad(acierto);
    }
  };
  const n = String(monto).trim() === '' ? NaN : Number(String(monto).replace(',', '.'));
  const eleccion = useMemo(() => elegirOrigen({
    efectivoEnCaja: delCajonPermitido ? efectivo : null, puedeElCajon: !!t?.caja_tipo, lista: bolsas, monto: Number.isFinite(n) ? n : 0,
  }), [delCajonPermitido, efectivo, t, bolsas, n]);
  const delCajon = eleccion.origen === 'CAJA';
  // Bolsa primero y la caja el resto (`elegirOrigen`): dos escrituras ligadas.
  const mixta = eleccion.origen === 'MIXTO';
  const esOtro = TIPOS_OTRO.includes(t?.caja_tipo);
  const avisoOtro = esOtro ? vaEnOtroLado(conceptos, 'SALIDA', nota) : null;
  // Sin foto en un tipo que la pide como prueba: sale igual (cajón o bolsa) y queda pendiente de autorización.
  const sinComprobante = !!tiposCaja.find((c) => c.codigo === t?.caja_tipo)?.sin_comprobante_autoriza && !fotos.length;

  useEffect(() => {
    if (!t?.pide_boleta || !boleta.trim()) { setRepetida([]); return undefined; }
    let vivo = true;
    const id = setTimeout(() => boletaYaRegistrada(Number(sala), boleta.trim()).then((f) => vivo && setRepetida(f)), 400);
    return () => { vivo = false; clearTimeout(id); };
  }, [t, boleta, sala]);

  /* La boleta ya usada, con las dos salidas del portal (`problemaDeLaBoleta`):
   * mismo motivo y misma entidad es la MISMA boleta y frena; otra entidad es
   * otro correlativo que dio el mismo número, y sólo se avisa. */
  const problemaDeLaBoleta = useMemo(() => {
    if (!repetida.length) return null;
    const mismaEnt = repetida.find((o) => o.tipo === tipo && normalizarNombre(o.entidad) === normalizarNombre(entidad));
    const o = mismaEnt || repetida[0];
    const cuando = fechaCorta(String(o.registrado_at || '').slice(0, 10));
    if (mismaEnt) {
      return { bloquea: true, texto: `La boleta ${o.numero_boleta} de ${o.entidad} ya se registró en esta sucursal el ${cuando} por ${formatMoney(o.monto)} (${o.folio}).` };
    }
    return { bloquea: false, texto: `Ese número ya lo usó una boleta de ${o.entidad || 'otra entidad'} el ${cuando} (${o.folio}). Si son dos boletas distintas, puedes seguir.` };
  }, [repetida, tipo, entidad]);

  /* Lo que dijo el lector, con los mismos frenos del portal (`problemaDeLaFoto`).
   * Sólo donde el papel manda: en los demás motivos la foto no se lee. */
  const problemaDeLaFoto = useMemo(() => {
    if (!laFotoManda || !fotos.length || !revision) return null;
    if (revision.error) return { bloquea: true, texto: 'No se pudo revisar la foto. Vuelve a elegirla para intentar de nuevo.' };
    const l = revision.leido || {};
    switch (revision.veredicto) {
      case 'NO_ES_BOLETA': return { bloquea: true, texto: `La foto no parece la boleta${l.motivo ? `: ${l.motivo}` : '.'}` };
      case 'ILEGIBLE': return { bloquea: true, texto: 'La boleta no se lee en la foto. Acércate, sostén el papel plano y evita el reflejo.' };
      case 'MONTO_NO_COINCIDE': return { bloquea: true, texto: `La boleta dice ${l.monto != null ? formatMoney(l.monto) : 'otro monto'} y la salida es de ${formatMoney(n)}.` };
      case 'BOLETA_NO_COINCIDE': return { bloquea: true, texto: `El número de la boleta de la foto es ${l.numero_boleta || 'otro'} y aquí dice ${boleta.trim()}.` };
      default: return null;
    }
  }, [laFotoManda, fotos.length, revision, n, boleta]);

  // El mismo orden de `faltaEnElFormulario` del portal.
  const pideEntidad = !!t?.etiqueta_entidad && !t?.entidad_la_dice_el_papel;
  const falta = !t ? 'Elige el motivo.'
    : laFotoManda && pideEntidad && !entidad.trim() ? `Falta ${t.etiqueta_entidad.toLowerCase()}.`
    : laFotoManda && leyendo ? 'Revisando la boleta…'
    : laFotoManda && !fotos.length ? 'Falta la foto del comprobante.'
    : laFotoManda && !revision ? 'La foto no se revisó: vuelve a elegirla.'
    : leyendo ? 'Leyendo la foto…'
    : !(n > 0) ? 'Escribe el monto.'
      : !eleccion.alcanza ? `En la sucursal hay ${formatMoney(totalDisponible(bolsas))} en bolsas${delCajonPermitido && efectivo != null ? ' y en la caja tampoco alcanza' : ''}. No alcanza.`
        : pideEntidad && !entidad.trim() ? `Falta ${t.etiqueta_entidad.toLowerCase()}.`
          : t.pide_boleta && !boleta.trim() ? 'Falta el número de boleta.'
              : t.foto === 'OBLIGATORIA' && !fotos.length ? 'Falta la foto del comprobante.'
                : esOtro && !detalleSuficiente(nota) ? 'En «Otro» escribe de qué fue, con detalle.'
                : avisoOtro ? avisoOtro
                : sinComprobante && motivoSinFoto.trim().length < 5 ? 'Sin foto del comprobante, explica por qué. Quedará pendiente de autorización.'
                : problemaDeLaFoto?.bloquea ? problemaDeLaFoto.texto
                : problemaDeLaBoleta?.bloquea ? problemaDeLaBoleta.texto
                : t.pide_receptor && !identidad ? 'Falta identificar a quien se lo lleva.'
                  : null;

  const guardar = async () => {
    setGuardando(true); trabajando('Registrando la salida…');
    try {
      const fotoUrl = fotos.length ? (await subirFotosOEncolar(fotos, { bucket: 'payment-proofs', carpeta: `bolsas/${sala ?? 'sin-sala'}/${user?.id ?? 'anon'}` })).urls[0] ?? null : null;
      const entidadDicha = t.entidad_la_dice_el_papel ? '' : entidad.trim();
      if (delCajon) {
        const r = await anotarSalida({
          sala, monto: n, tipo: t.caja_tipo,
          concepto: [t.etiqueta, entidadDicha, nota.trim()].filter(Boolean).join(' · ').slice(0, 50),
          // El concepto ENTERO para la base (el portal lo manda como `conceptoCompleto`
          // y Mi caja lo pasa en `detalle`); la nota suelta, sin el rótulo, es la del papel.
          detalle: [t.etiqueta, entidadDicha, nota.trim()].filter(Boolean).join(' · '),
          boleta: boleta.trim() || null, fotoUrl,
          recibidoPor: t.pide_receptor ? identidad?.persona?.id : null, vale: t.pide_receptor ? identidad?.vale : null,
          recibe: t.pide_receptor ? '' : entidad.trim(), clave,
          motivoSinComprobante: sinComprobante ? motivoSinFoto.trim() : '',
          lectura: fotoUrl ? lectura : null,
        });
        if (r?.error) { if (t.pide_receptor) setIdentidad(null); throw r.error; }
        const papel = r?.movimiento ? await comprobanteDelMovimiento(r.movimiento, {
          etiqueta: t.etiqueta, detalle: [entidadDicha, nota.trim()].filter(Boolean).join(' · '),
          persona: identidad?.persona?.name || entidad.trim(), comoSeComprobo: r.movimiento.recibido_metodo,
        }, sala, nombreSala, user?.name || '') : { ok: true };
        if (r?.aviso) fallo('Salida anotada, con un pendiente', r.aviso);
        else if (!papel.ok) fallo('Salida anotada, pero el comprobante no salió', papel.detalle);
        else listo('Salida registrada', `De la caja · ${formatMoney(n)}`);
      } else {
        const { data, error } = await registrarSalida({
          // En una mixta la bolsa registra SU parte: el servidor exige que los
          // repartos sumen exactamente el monto.
          tipo: t.codigo, monto: mixta ? eleccion.deBolsas : n, repartos: eleccion.repartos.map(({ bolsa_id, monto: m }) => ({ bolsa_id, monto: m })),
          entidad, numeroBoleta: boleta, fotoUrl, nota,
          recibidoPor: t.pide_receptor ? identidad?.persona?.id : null, vale: t.pide_receptor ? identidad?.vale : null,
          motivoSinComprobante: sinComprobante ? motivoSinFoto.trim() : '',
        });
        if (error) { if (t.pide_receptor) setIdentidad(null); throw error; }
        // El rastro de la lectura, como en el portal. Es auditoría: falla en silencio.
        if (lectura && fotoUrl) guardarLecturaDeBoleta(data.id, lectura);
        /* La parte de la caja de una mixta, como el portal: después de la bolsa
         * y ligada a ella (`operacionBolsa`), que hereda quién retira. Si la caja
         * no la acepta, la parte de la bolsa se ANULA: una salida a medias
         * dejaría la bolsa descontada por algo que no se entregó. Y no imprime
         * su comprobante: el vale de la bolsa es el único papel. */
        let avisoCaja = null;
        if (mixta) {
          const rc = await anotarSalida({
            sala, monto: eleccion.delCajon, tipo: t.caja_tipo,
            concepto: [t.etiqueta, data.folio, entidadDicha, nota.trim()].filter(Boolean).join(' · ').slice(0, 50),
            detalle: [t.etiqueta, `resto de ${data.folio}`, entidadDicha, nota.trim()].filter(Boolean).join(' · '),
            boleta: boleta.trim() || null, fotoUrl,
            recibe: t.pide_receptor ? '' : entidad.trim(),
            operacionBolsa: data.id,
          });
          if (rc?.error || !rc?.ok) {
            const { error: errAnular } = await anularSalida(data.id, 'La caja no aceptó su parte: la salida no se completó');
            if (t.pide_receptor) setIdentidad(null);
            fallo('No se pudo registrar', errAnular
              ? `La caja no aceptó su parte y la salida ${data.folio} de la bolsa quedó registrada: anúlala desde el detalle de la bolsa.`
              : `${mensajeAmigable(rc?.error || 'La caja no aceptó su parte.')} No se sacó nada: vuelve a intentarlo.`);
            return;
          }
          avisoCaja = rc.aviso || null;
        }
        // El vale y la etiqueta nueva de cada bolsa tocada: sin la etiqueta, la
        // bolsa diría lo guardado y no lo que le queda.
        const vale = await valeDeLaSalida(data.id, data.branch_id ?? sala);
        const etiquetas = [];
        for (const { bolsa_id } of eleccion.repartos) {
          const b = bolsas.find((x) => x.id === bolsa_id);
          if (b) etiquetas.push(await reimprimirEtiqueta(b, nombreSala, user?.name || ''));
        }
        const malos = [!vale.ok && `el vale (${vale.detalle})`, etiquetas.some((e) => !e.ok) && 'alguna etiqueta'].filter(Boolean);
        if (malos.length) fallo('Salida registrada, pero falta papel', `No salió ${malos.join(' ni ')}. Imprímelo desde el detalle de la bolsa.`);
        else if (avisoCaja) fallo('Salida registrada, con un pendiente', avisoCaja);
        else listo('Salida registrada', mixta
          ? `${data.folio} · ${formatMoney(eleccion.deBolsas)} de la bolsa y ${formatMoney(eleccion.delCajon)} de la caja`
          : `${data.folio} · ${formatMoney(n)}`);
      }
      router.back();
    } catch (e) {
      fallo('No se pudo registrar', mensajeAmigable(e, 'Vuelve a intentar en un momento.'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Sacar dinero' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          <Seccion titulo={nombreSala || 'La sucursal'}>
            <Dato primero rotulo="En la caja" valor={efectivo != null && delCajonPermitido ? formatMoney(efectivo) : '—'} />
            <Dato rotulo="En bolsas" valor={formatMoney(totalDisponible(bolsas))} />
          </Seccion>

          <Seccion titulo="Motivo">
            <Opciones opciones={tipos.filter((x) => x.activo).map((x) => ({ id: x.codigo, label: x.etiqueta, detalle: x.leyenda || null }))}
              valor={tipo} onCambiar={(v) => { setTipo(v); setEntidad(''); setBoleta(''); setFotos([]); setIdentidad(null); olvidarLectura(); }} />
          </Seccion>

          {t ? (
            <Seccion titulo="La salida">
              {/* Donde el papel manda, la foto va PRIMERO: de ella salen el monto, el número y de qué fue. */}
              {laFotoManda ? <Fotos fotos={fotos} onCambiar={alCambiarFotos} max={1} documento /> : null}
              {aviso ? <Aviso tono={montoCerrado ? 'nota' : 'cuidado'} texto={aviso} /> : null}
              {sentido ? <Aviso tono="cuidado" texto={sentido} /> : null}
              {!leyendo && problemaDeLaFoto ? <Aviso tono="freno" texto={problemaDeLaFoto.texto} /> : null}
              {!leyendo && pisados.length ? (
                <Aviso tono="cuidado" texto={`La boleta dice otra cosa: ${pisados.length === 1 ? `se corrigió ${pisados[0]}` : `se corrigieron ${juntarConY(pisados)}`} que habías escrito. Si el papel no dice eso, quita la foto y vuelve a tomarla.`} />
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{montoCerrado ? 'Monto (confirmado por la boleta)' : 'Monto'}</Text>
                <View style={{ minWidth: 140 }}><Campo multiline={false} value={monto} editable={!montoCerrado} onChangeText={(v) => setMonto(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="$0.00" style={{ textAlign: 'center' }} /></View>
              </View>
              {n > 0 && eleccion.alcanza ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {delCajon ? 'Sale de la caja.' : `Sale de ${eleccion.repartos.map((r) => `${bolsas.find((b) => b.id === r.bolsa_id)?.folio ?? 'una bolsa'} (${formatMoney(r.monto)})`).join(', ')}${mixta ? ` y la caja pone el resto (${formatMoney(eleccion.delCajon)}). Sale un solo vale que dice cuánto salió de cada lado` : ''}.`}
                </Text>
              ) : null}
              {t.etiqueta_entidad && !t.entidad_la_dice_el_papel ? (
                opcionesEntidad.length
                  ? <Opciones opciones={opcionesEntidad} valor={entidad} onCambiar={setEntidad} />
                  : <Campo multiline={false} value={entidad} onChangeText={setEntidad} placeholder={t.etiqueta_entidad} />
              ) : null}
              {t.pide_boleta ? <Campo multiline={false} value={boleta} editable={!boletaCerrada} onChangeText={setBoleta} placeholder="Número de boleta" autoCapitalize="characters" /> : null}
              {problemaDeLaBoleta && !problemaDeLaBoleta.bloquea ? <Aviso tono="cuidado" texto={problemaDeLaBoleta.texto} /> : null}
              {t.foto && t.foto !== 'NO' && !laFotoManda ? <Fotos fotos={fotos} onCambiar={setFotos} max={1} documento /> : null}
              <Campo value={nota} onChangeText={setNota} placeholder={esOtro ? 'De qué fue: qué se pagó, a quién y quién lo autorizó' : 'Nota (opcional)'} />
              {sinComprobante ? (
                <>
                  <Aviso tono="cuidado" texto="Sin foto del comprobante, esta salida queda pendiente de autorización." />
                  <Campo value={motivoSinFoto} onChangeText={setMotivoSinFoto} placeholder="Por qué no hay comprobante" />
                </>
              ) : null}
            </Seccion>
          ) : null}

          {t?.pide_receptor ? (
            <Seccion titulo="Quién se lo lleva">
              <Identidad identidad={identidad} onIdentidad={setIdentidad} titulo="Escanea el carné de quien se lo lleva" />
            </Seccion>
          ) : null}

          {falta && t ? <Aviso tono="cuidado" texto={falta} /> : null}
          <BotonGrande texto={guardando ? 'Registrando…' : 'Registrar e imprimir'} color={MARCA.verde} deshabilitado={guardando || !!falta} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
