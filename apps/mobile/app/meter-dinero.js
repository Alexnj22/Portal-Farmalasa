// Meter dinero, NATIVO — el ingreso de Mi caja del portal (`DialogoMovimiento`
// con `entra`): lo que más se anota en la caja después de vender — los pagos de
// recibos por el POS Promerica, las aplicaciones de inyección, la toma de
// glucosa, el domicilio. Los motivos salen del catálogo (`caja_tipos_movimiento`,
// los de ENTRADA), y cada uno dice si pide boleta, foto o el nombre de quien lo
// trae.
//
// Con foto, la foto se LEE (`leerBoleta`, el mismo lector del portal) y llena
// el monto, el número y el detalle; qué se llena, qué se cierra y qué se le
// dice a quien registra lo decide el núcleo (`lecturaDeBoleta`), igual que en
// el portal: el monto se cierra sólo si la boleta lo imprime dos veces y
// coinciden. Una boleta ya anotada en la sala frena (`problemaDeBoleta`).
//
// Se anota por `anotarIngreso` con una clave por formulario —dos toques no
// anotan dos veces— y sale el comprobante del movimiento.
//
// Los motivos que llevan comprobante propio se ofrecen igual que en el portal,
// y al elegirlos se abre su pantalla (`DialogoMovimiento` → `onComprobante`):
// la aplicación de inyección (`APLICACION`) va a `aplicacion-inyeccion` y el
// resto —el abono para apartar— a `abono-apartado`.
import usePantallaDespierta from '../componentes/usePantallaDespierta';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { anotarIngreso, boletaYaEnCaja, fetchTiposDeMovimiento, leerBoleta } from '@nucleo/data/bolsas';
import { choqueDeSentido, lecturaDeBoleta, PISTA_DE_DETALLE, problemaDeBoleta } from '@nucleo/utils/ingresoDeCaja';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Fotos, { subirFotos } from '../componentes/formulario/Fotos';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { comprobanteDelMovimiento } from '../componentes/cortes/papel';
import FormaDePago from '../componentes/formulario/FormaDePago';
import { datosDeFormaDePago, estadoDeFormaDePago, FORMA_DE_PAGO_INICIAL } from '@nucleo/utils/formaDePago';

export default function MeterDinero() {
  usePantallaDespierta('meter-dinero'); // se cuenta efectivo: la pantalla no se apaga
  const { sala } = useLocalSearchParams();
  const { user } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const nombreSala = (sucursales || []).find((b) => String(b.id) === String(sala))?.name ?? '';

  const [tipos, setTipos] = useState([]);
  const [codigo, setCodigo] = useState(null);
  const [monto, setMonto] = useState('');
  const [boleta, setBoleta] = useState('');
  const [detalle, setDetalle] = useState('');
  const [persona, setPersona] = useState('');
  const [fotos, setFotos] = useState([]);
  const [leyendo, setLeyendo] = useState(false);
  const [lectura, setLectura] = useState(null);
  const [montoCerrado, setMontoCerrado] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [sentido, setSentido] = useState(null);
  const [repetidas, setRepetidas] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [pago, setPago] = useState(FORMA_DE_PAGO_INICIAL);
  const [clave] = useState(() => `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    let vivo = true;
    fetchTiposDeMovimiento().then((t) => vivo && setTipos((t || []).filter((x) => x.sentido === 'ENTRADA')));
    return () => { vivo = false; };
  }, []);

  const tipo = tipos.find((t) => t.codigo === codigo) || null;
  const n = String(monto).trim() === '' ? NaN : Number(String(monto).replace(',', '.'));
  const exigeDetalle = !tipo || tipo.codigo.startsWith('OTRO');
  /* Cómo se pagó (2026-10-19), con la misma regla del portal: las operaciones
   * del POS Promerica son en efectivo por ventanilla y no la llevan. Con
   * tarjeta o transferencia el respaldo es el comprobante del pago, así que la
   * boleta y su foto dejan de pedirse. */
  const conFormaDePago = !!tipo && !tipo.codigo.startsWith('POS_');
  const estadoPago = estadoDeFormaDePago(conFormaDePago ? pago : null, n);
  const noEfectivo = conFormaDePago && estadoPago.noEfectivo;

  useEffect(() => {
    const num = boleta.trim();
    if (!num || !sala) { setRepetidas([]); return undefined; }
    let vivo = true;
    const id = setTimeout(() => boletaYaEnCaja(Number(sala), num).then((f) => vivo && setRepetidas(f)), 400);
    return () => { vivo = false; clearTimeout(id); };
  }, [boleta, sala]);
  const problema = useMemo(() => problemaDeBoleta(repetidas, true, boleta), [repetidas, boleta]);

  const elegir = (v) => {
    const elegido = tipos.find((t) => t.codigo === v);
    if (elegido?.lleva_comprobante) {
      /* Cada tipo con diálogo propio va al SUYO. Antes todo lo que no era la
       * inyección caía en el abono para apartar, y el «Pago de asegurado
       * Mapfre» (2026-10-19) abría esa pantalla. Lo que todavía no tiene
       * pantalla nativa se abre en el portal, en Mi caja de esa sala. */
      const nativa = { APLICACION: '/aplicacion-inyeccion', ABONO_CLIENTE: '/abono-apartado' }[elegido.codigo];
      if (nativa) router.replace({ pathname: nativa, params: { sala } });
      else router.replace({ pathname: '/portal', params: { ruta: `/caja?sala=${sala}` } });
      return;
    }
    setCodigo(v); setPago(FORMA_DE_PAGO_INICIAL); setFotos([]); setLectura(null); setAviso(null); setSentido(null); setMontoCerrado(false);
  };

  // Al poner la foto se lee; al quitarla se olvida lo que dijo.
  const alCambiarFotos = async (lista) => {
    setFotos(lista);
    setAviso(null); setSentido(null); setLectura(null); setMontoCerrado(false);
    const f = lista[0];
    if (!f) return;
    setLeyendo(true);
    const r = await leerBoleta(f, { entidad: null, numeroBoleta: null, monto: null });
    setLeyendo(false);
    const l = lecturaDeBoleta(r, { pideBoleta: !!tipo?.pide_boleta });
    setAviso(l.aviso);
    if (l.error) return;
    setLectura(l.lectura);
    if (l.monto != null) setMonto(l.monto);
    if (l.boleta != null) setBoleta(l.boleta);
    if (l.concepto != null) setDetalle(l.concepto);
    setMontoCerrado(!!l.puesto.monto);
    setSentido(choqueDeSentido(r, true));
  };

  const falta = !tipo ? 'Elige el motivo.'
    : leyendo ? 'Leyendo la foto…'
      : !noEfectivo && tipo.foto === 'OBLIGATORIA' && !fotos.length ? 'Falta la foto del comprobante.'
        : !(n > 0) ? 'Escribe el monto.'
          : exigeDetalle && detalle.trim().length < 3 ? 'Escribe el detalle.'
            : !noEfectivo && tipo.pide_boleta && !boleta.trim() ? 'Falta el número de boleta.'
              : !noEfectivo && problema?.bloquea ? problema.texto
                : tipo.pide_persona && persona.trim().length < 2 ? 'Escribe quién lo trae.'
                  : estadoPago.falta;

  const guardar = async () => {
    setGuardando(true); trabajando('Anotando el ingreso…');
    try {
      // Con tarjeta o transferencia la foto que vale es la del comprobante del pago.
      const fotosQueVan = noEfectivo ? (pago.foto ? [pago.foto] : []) : fotos;
      const fotoUrl = fotosQueVan.length ? (await subirFotos(fotosQueVan, { bucket: 'payment-proofs', carpeta: `bolsas/${sala ?? 'sin-sala'}/${user?.id ?? 'anon'}` }))[0] ?? null : null;
      // Sin la foto el servidor pediría una autorización que nadie pidió: la sala SÍ tenía el papel.
      if (noEfectivo && pago.foto && !fotoUrl) throw new Error('No se pudo subir la foto del comprobante. Revisa la conexión y vuelve a intentarlo.');
      const r = await anotarIngreso({
        sala, monto: n, tipo: tipo.codigo, clave,
        concepto: [tipo.etiqueta, detalle.trim()].filter(Boolean).join(' · ').slice(0, 50),
        conceptoCompleto: [tipo.etiqueta, detalle.trim()].filter(Boolean).join(' · '),
        boleta: boleta.trim() || null, fotoUrl, lectura: fotoUrl ? lectura : null,
        ...(tipo.pide_persona ? { vendedor: persona.trim() } : {}),
        ...(conFormaDePago ? datosDeFormaDePago(pago, fotoUrl) : {}),
      });
      if (r?.error) throw r.error;
      const papel = r?.movimiento ? await comprobanteDelMovimiento(r.movimiento, {
        etiqueta: tipo.etiqueta, detalle: detalle.trim(), persona: persona.trim(), comoSeComprobo: r.movimiento.recibido_metodo,
      }, sala, nombreSala, user?.name || '') : { ok: true };
      if (r?.aviso) fallo('Ingreso anotado, con un pendiente', r.aviso);
      else if (!papel.ok) fallo('Ingreso anotado, pero el comprobante no salió', papel.detalle);
      else listo('Ingreso anotado', `${tipo.etiqueta} · ${formatMoney(n)}`);
      router.back();
    } catch (e) {
      fallo('No se pudo anotar', mensajeAmigable(e, 'Vuelve a intentar en un momento.'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Meter dinero' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {nombreSala ? <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 4 }}>{`Entra a la caja de ${nombreSala}`}</Text> : null}

          <Seccion titulo="Motivo">
            <Opciones opciones={tipos.map((x) => ({ id: x.codigo, label: x.etiqueta, detalle: x.leyenda || null }))}
              valor={codigo} onCambiar={elegir} />
          </Seccion>

          {conFormaDePago ? (
            <FormaDePago valor={pago} onCambiar={setPago} monto={n}
              onMontoLeido={(t) => { if (String(monto).trim() === '') setMonto(String(t)); }} />
          ) : null}

          {tipo && tipo.foto !== 'NO' && !noEfectivo ? (
            <Seccion titulo={tipo.foto === 'OBLIGATORIA' ? 'Foto de la boleta' : 'Foto de la boleta (opcional)'}
              pie="La foto se lee sola: llena el monto, el número y el detalle.">
              <Fotos fotos={fotos} onCambiar={alCambiarFotos} max={1} />
            </Seccion>
          ) : null}
          {aviso && !noEfectivo ? <Aviso tono={montoCerrado ? 'nota' : 'cuidado'} texto={aviso} /> : null}
          {sentido && !noEfectivo ? <Aviso tono="cuidado" texto={sentido} /> : null}

          {tipo ? (
            <Seccion titulo="El ingreso">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{noEfectivo ? 'Cuánto es de este ingreso' : montoCerrado ? 'Monto (confirmado por la boleta)' : 'Monto'}</Text>
                <View style={{ minWidth: 140 }}>
                  <Campo multiline={false} value={monto} editable={noEfectivo || !montoCerrado} onChangeText={(v) => setMonto(v.replace(/[^\d.,]/g, ''))}
                    keyboardType="decimal-pad" placeholder="$0.00" style={{ textAlign: 'center' }} />
                </View>
              </View>
              {tipo.pide_boleta && !noEfectivo ? <Campo multiline={false} value={boleta} onChangeText={setBoleta} placeholder="Número de boleta" autoCapitalize="characters" /> : null}
              {tipo.pide_persona ? <Campo multiline={false} value={persona} onChangeText={setPersona} placeholder="Quién lo trae" autoCapitalize="words" /> : null}
              <Campo value={detalle} onChangeText={setDetalle}
                placeholder={`Detalle${exigeDetalle ? '' : ' (opcional)'}${PISTA_DE_DETALLE[tipo.codigo] ? ` — p. ej. ${PISTA_DE_DETALLE[tipo.codigo]}` : ''}`} />
            </Seccion>
          ) : null}

          {problema && !problema.bloquea && !noEfectivo ? <Aviso tono="cuidado" texto={problema.texto} /> : null}
          {falta && tipo ? <Aviso tono={!noEfectivo && problema?.bloquea ? 'freno' : 'cuidado'} texto={falta} /> : null}
          <BotonGrande texto={guardando ? 'Anotando…' : 'Anotar e imprimir'} color={MARCA.verde} deshabilitado={guardando || !!falta} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
