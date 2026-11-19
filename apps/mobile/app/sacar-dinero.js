// Sacar dinero, NATIVO — la salida de Efectivo del portal (`SalidaDeBolsa.jsx`
// abierto desde Mi caja). Regla del usuario del 3-sep: «todo debe pasar desde
// efectivo»: el dinero sale PRIMERO del cajón, y sólo si no alcanza, de las
// bolsas (`elegirOrigen`, del núcleo).
//
//   · del CAJÓN: `anotarSalida` (edge `operar-caja`, con clave para que dos
//     toques no anoten dos veces) y sale el comprobante del movimiento;
//   · de las BOLSAS: `registrarSalida` reparte entre las más viejas y sale el
//     vale de la operación más la etiqueta nueva de cada bolsa tocada.
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
  anotarSalida, boletaYaRegistrada, estadoDeCaja, fetchBolsas, fetchConceptosDeOtroLado, fetchEntidadesDeSalida, fetchSaldos,
  fetchTiposDeMovimiento, fetchTiposDeSalida, guardarLecturaDeBoleta, leerBoleta, registrarSalida,
} from '@nucleo/data/bolsas';
import { choqueDeSentido, lecturaDeBoleta } from '@nucleo/utils/ingresoDeCaja';
import { TIPOS_OTRO, detalleSuficiente, vaEnOtroLado } from '@nucleo/utils/conceptoDeOtroLado';
import { disponibles, elegirOrigen, totalDisponible } from '@nucleo/utils/bolsasReparto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Fotos, { subirFotos } from '../componentes/formulario/Fotos';
import Identidad from '../componentes/Identidad';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { comprobanteDelMovimiento, reimprimirEtiqueta, valeDeLaSalida } from '../componentes/cortes/papel';

// Para cruzar la remesadora impresa con la lista: sin tildes, sin espacios ni signos.
const pegado = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
  const [repetida, setRepetida] = useState(false);
  const [nota, setNota] = useState('');
  const [fotos, setFotos] = useState([]);
  const [identidad, setIdentidad] = useState(null);
  const [guardando, setGuardando] = useState(false);
  // Lo que dijo la foto. El monto se cierra sólo si la boleta lo imprime dos
  // veces y coinciden; el número, si se leyó. Quitar la foto los devuelve.
  const [leyendo, setLeyendo] = useState(false);
  const [lectura, setLectura] = useState(null);
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
    setLectura(null); setAviso(null); setSentido(null); setMontoCerrado(false); setBoletaCerrada(false);
  };

  // Al poner la foto se lee; al quitarla se olvida lo que dijo.
  const alCambiarFotos = async (lista) => {
    setFotos(lista);
    olvidarLectura();
    const f = lista[0];
    if (!f || !laFotoManda) return;
    setLeyendo(true);
    const r = await leerBoleta(f, { entidad: null, numeroBoleta: null, monto: null });
    setLeyendo(false);
    const l = lecturaDeBoleta(r, { pideBoleta: true });
    setAviso(l.aviso);
    if (l.error) return;
    setLectura(l.lectura);
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
    if (diceRemesa && opcionesEntidad.length) {
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
  const esOtro = TIPOS_OTRO.includes(t?.caja_tipo);
  const avisoOtro = esOtro ? vaEnOtroLado(conceptos, 'SALIDA', nota) : null;
  // Sin foto en un tipo que la pide como prueba: sale igual (cajón o bolsa) y queda pendiente de autorización.
  const sinComprobante = !!tiposCaja.find((c) => c.codigo === t?.caja_tipo)?.sin_comprobante_autoriza && !fotos.length;

  useEffect(() => {
    if (!t?.pide_boleta || !boleta.trim()) { setRepetida(false); return undefined; }
    let vivo = true;
    const id = setTimeout(() => boletaYaRegistrada(Number(sala), boleta.trim()).then((f) => vivo && setRepetida(f.length > 0)), 400);
    return () => { vivo = false; clearTimeout(id); };
  }, [t, boleta, sala]);

  const falta = !t ? 'Elige el motivo.'
    : leyendo ? 'Leyendo la foto…'
    : laFotoManda && !fotos.length ? 'Toma la foto de la boleta.'
    : !(n > 0) ? 'Escribe el monto.'
      : !eleccion.alcanza ? `En la sucursal hay ${formatMoney(totalDisponible(bolsas))} en bolsas${delCajonPermitido && efectivo != null ? ' y en la caja tampoco alcanza' : ''}. No alcanza.`
        : t.etiqueta_entidad && !t.entidad_la_dice_el_papel && !entidad.trim() ? `Falta ${t.etiqueta_entidad.toLowerCase()}.`
          : t.pide_boleta && !boleta.trim() ? 'Falta el número de boleta.'
            : repetida ? 'Esa boleta ya está registrada en esta sucursal.'
              : t.foto === 'OBLIGATORIA' && !fotos.length ? 'Falta la foto del comprobante.'
                : esOtro && !detalleSuficiente(nota) ? 'En «Otro» escribe de qué fue, con detalle.'
                : avisoOtro ? avisoOtro
                : sinComprobante && motivoSinFoto.trim().length < 5 ? 'Sin foto del comprobante, explica por qué. Quedará pendiente de autorización.'
                : t.pide_receptor && !identidad ? 'Falta identificar a quien se lo lleva.'
                  : null;

  const guardar = async () => {
    setGuardando(true); trabajando('Registrando la salida…');
    try {
      const fotoUrl = fotos.length ? (await subirFotos(fotos, { bucket: 'payment-proofs', carpeta: `bolsas/${sala ?? 'sin-sala'}/${user?.id ?? 'anon'}` }))[0] ?? null : null;
      const entidadDicha = t.entidad_la_dice_el_papel ? '' : entidad.trim();
      if (delCajon) {
        const r = await anotarSalida({
          sala, monto: n, tipo: t.caja_tipo,
          concepto: [t.etiqueta, entidadDicha, nota.trim()].filter(Boolean).join(' · ').slice(0, 50),
          detalle: [entidadDicha, nota.trim()].filter(Boolean).join(' · '),
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
          tipo: t.codigo, monto: n, repartos: eleccion.repartos.map(({ bolsa_id, monto: m }) => ({ bolsa_id, monto: m })),
          entidad, numeroBoleta: boleta, fotoUrl, nota,
          recibidoPor: t.pide_receptor ? identidad?.persona?.id : null, vale: t.pide_receptor ? identidad?.vale : null,
          motivoSinComprobante: sinComprobante ? motivoSinFoto.trim() : '',
        });
        if (error) { if (t.pide_receptor) setIdentidad(null); throw error; }
        // El rastro de la lectura, como en el portal. Es auditoría: falla en silencio.
        if (lectura && fotoUrl) guardarLecturaDeBoleta(data.id, lectura);
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
        else listo('Salida registrada', `${data.folio} · ${formatMoney(n)}`);
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{montoCerrado ? 'Monto (confirmado por la boleta)' : 'Monto'}</Text>
                <View style={{ minWidth: 140 }}><Campo multiline={false} value={monto} editable={!montoCerrado} onChangeText={(v) => setMonto(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="$0.00" style={{ textAlign: 'center' }} /></View>
              </View>
              {n > 0 && eleccion.alcanza ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {delCajon ? 'Sale de la caja.' : `Sale de ${eleccion.repartos.map((r) => `${bolsas.find((b) => b.id === r.bolsa_id)?.folio ?? 'una bolsa'} (${formatMoney(r.monto)})`).join(', ')}.`}
                </Text>
              ) : null}
              {t.etiqueta_entidad && !t.entidad_la_dice_el_papel ? (
                opcionesEntidad.length
                  ? <Opciones opciones={opcionesEntidad} valor={entidad} onCambiar={setEntidad} />
                  : <Campo multiline={false} value={entidad} onChangeText={setEntidad} placeholder={t.etiqueta_entidad} />
              ) : null}
              {t.pide_boleta ? <Campo multiline={false} value={boleta} editable={!boletaCerrada} onChangeText={setBoleta} placeholder="Número de boleta" autoCapitalize="characters" /> : null}
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
