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
// Los motivos que llevan comprobante propio (el abono de un crédito) no se
// anotan acá: tienen su pantalla.
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

export default function MeterDinero() {
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
  const [clave] = useState(() => `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    let vivo = true;
    fetchTiposDeMovimiento().then((t) => vivo && setTipos((t || []).filter((x) => x.sentido === 'ENTRADA' && !x.lleva_comprobante)));
    return () => { vivo = false; };
  }, []);

  const tipo = tipos.find((t) => t.codigo === codigo) || null;
  const n = String(monto).trim() === '' ? NaN : Number(String(monto).replace(',', '.'));
  const exigeDetalle = !tipo || tipo.codigo.startsWith('OTRO');

  useEffect(() => {
    const num = boleta.trim();
    if (!num || !sala) { setRepetidas([]); return undefined; }
    let vivo = true;
    const id = setTimeout(() => boletaYaEnCaja(Number(sala), num).then((f) => vivo && setRepetidas(f)), 400);
    return () => { vivo = false; clearTimeout(id); };
  }, [boleta, sala]);
  const problema = useMemo(() => problemaDeBoleta(repetidas, true, boleta), [repetidas, boleta]);

  const elegir = (v) => {
    setCodigo(v); setFotos([]); setLectura(null); setAviso(null); setSentido(null); setMontoCerrado(false);
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
      : tipo.foto === 'OBLIGATORIA' && !fotos.length ? 'Falta la foto del comprobante.'
        : !(n > 0) ? 'Escribe el monto.'
          : exigeDetalle && detalle.trim().length < 3 ? 'Escribe el detalle.'
            : tipo.pide_boleta && !boleta.trim() ? 'Falta el número de boleta.'
              : problema?.bloquea ? problema.texto
                : tipo.pide_persona && persona.trim().length < 2 ? 'Escribe quién lo trae.'
                  : null;

  const guardar = async () => {
    setGuardando(true); trabajando('Anotando el ingreso…');
    try {
      const fotoUrl = fotos.length ? (await subirFotos(fotos, { bucket: 'payment-proofs', carpeta: `bolsas/${sala ?? 'sin-sala'}/${user?.id ?? 'anon'}` }))[0] ?? null : null;
      const r = await anotarIngreso({
        sala, monto: n, tipo: tipo.codigo, clave,
        concepto: [tipo.etiqueta, detalle.trim()].filter(Boolean).join(' · ').slice(0, 50),
        conceptoCompleto: [tipo.etiqueta, detalle.trim()].filter(Boolean).join(' · '),
        boleta: boleta.trim() || null, fotoUrl, lectura: fotoUrl ? lectura : null,
        ...(tipo.pide_persona ? { vendedor: persona.trim() } : {}),
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

          {tipo && tipo.foto !== 'NO' ? (
            <Seccion titulo={tipo.foto === 'OBLIGATORIA' ? 'Foto de la boleta' : 'Foto de la boleta (opcional)'}
              pie="La foto se lee sola: llena el monto, el número y el detalle.">
              <Fotos fotos={fotos} onCambiar={alCambiarFotos} max={1} />
            </Seccion>
          ) : null}
          {aviso ? <Aviso tono={montoCerrado ? 'nota' : 'cuidado'} texto={aviso} /> : null}
          {sentido ? <Aviso tono="cuidado" texto={sentido} /> : null}

          {tipo ? (
            <Seccion titulo="El ingreso">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{montoCerrado ? 'Monto (confirmado por la boleta)' : 'Monto'}</Text>
                <View style={{ width: 140 }}>
                  <Campo multiline={false} value={monto} editable={!montoCerrado} onChangeText={(v) => setMonto(v.replace(/[^\d.,]/g, ''))}
                    keyboardType="decimal-pad" placeholder="$0.00" style={{ textAlign: 'center' }} />
                </View>
              </View>
              {tipo.pide_boleta ? <Campo multiline={false} value={boleta} onChangeText={setBoleta} placeholder="Número de boleta" autoCapitalize="characters" /> : null}
              {tipo.pide_persona ? <Campo multiline={false} value={persona} onChangeText={setPersona} placeholder="Quién lo trae" autoCapitalize="words" /> : null}
              <Campo value={detalle} onChangeText={setDetalle}
                placeholder={`Detalle${exigeDetalle ? '' : ' (opcional)'}${PISTA_DE_DETALLE[tipo.codigo] ? ` — p. ej. ${PISTA_DE_DETALLE[tipo.codigo]}` : ''}`} />
            </Seccion>
          ) : null}

          {problema && !problema.bloquea ? <Aviso tono="cuidado" texto={problema.texto} /> : null}
          {falta && tipo ? <Aviso tono={problema?.bloquea ? 'freno' : 'cuidado'} texto={falta} /> : null}
          <BotonGrande texto={guardando ? 'Anotando…' : 'Anotar e imprimir'} color={MARCA.verde} deshabilitado={guardando || !!falta} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
