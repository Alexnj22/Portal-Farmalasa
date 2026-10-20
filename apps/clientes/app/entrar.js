// Entrar: con los dos datos de la ficha (documento + teléfono) o con el código
// de 7 letras del ticket. La forma es la del sistema: control segmentado,
// formulario agrupado como Ajustes y el botón nativo (ver componentes/sistema.js).
import { useEffect, useRef, useState } from 'react';
import { InputAccessoryView, Platform, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Device from 'expo-device';
import Segmentos from '../componentes/Segmentos';
import { BotonSistema, colorSistema, FilaCampo, Formulario, Grupo } from '../componentes/sistema';
import { Aviso, Texto } from '../componentes/ui';
import { llamar } from '../lib/api';
import { plataforma, useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';
import { documentoEscrito } from '../lib/formato';
import { duiValido } from '../lib/fiscal';
import { conBiometria, useBloqueo } from '../lib/bloqueo';
import { datosConBiometria, entradaDisponible, guardarEntrada, olvidarEntrada } from '../lib/entradaGuardada';
import { useCuenta } from '../lib/cuenta';

// El alfabeto del código no tiene letras ni números que se confundan
// (sin O/0, I/1, S/5…), igual que el que emite la sala.
const ALFABETO = /[^ACDEFGHJKMNPQRTUVWXY34679]/g;

// El teclado numérico de iOS no tiene tecla de «siguiente» ni de «ir»: sin una
// barra encima, desde el DUI no había cómo pasar al teléfono (2026-10-15).
const BARRA_DUI = 'entrar-dui';
const BARRA_TEL = 'entrar-tel';
const IOS = Platform.OS === 'ios';

export default function Entrar() {
  const t = useTema();
  const abrir = useSesion((s) => s.abrir);
  // Llegando desde el QR del ticket (app/mis-puntos.js), con el código escrito.
  const { codigo: delQr, completar } = useLocalSearchParams();
  // Completar (2026-10-19): llega desde «Para ver esto, entra con tu DUI y
  // teléfono» con la sesión de CÓDIGO todavía abierta. Sólo DUI y teléfono,
  // sin la entrada rápida (la guardada puede ser el mismo código), y al
  // entrar la sesión de código se reemplaza (`reemplaza`: el servidor la
  // revoca). Si vuelve atrás, sigue con la de código.
  const completando = completar === '1' && !!useSesion.getState().token;
  useEffect(() => (completando ? () => useSesion.getState().dejarDeCompletar() : undefined), [completando]);
  const [modo, setModo] = useState(delQr && !completando ? 'codigo' : 'dui');
  const [documento, setDocumento] = useState('');
  const [telefono, setTelefono] = useState('');
  const [codigo, setCodigo] = useState(delQr ? String(delQr) : '');
  const [error, setError] = useState(null);
  const telRef = useRef(null);
  // La sesión terminó sola (venció o se cerró en el servidor): se dice por qué.
  const motivo = useSesion((s) => s.motivoCierre);
  const [enviando, setEnviando] = useState(false);
  // Entrar con Face ID: si ya entró antes en este teléfono.
  const [rapida, setRapida] = useState(null);
  // Y se ofrece sola al abrir la pantalla, una vez: es lo que se espera del gesto.
  const ofrecida = useRef(false);
  useEffect(() => { if (!completando) entradaDisponible().then(setRapida); }, [completando]);
  useEffect(() => {
    if (rapida && !ofrecida.current && !delQr && !completando) { ofrecida.current = true; entrarRapido(); }
  }, [rapida]); // eslint-disable-line react-hooks/exhaustive-deps

  const listo = modo === 'codigo'
    ? codigo.length === 7
    : duiValido(documento) && telefono.replace(/\D/g, '').length >= 8;
  // Los 9 números escritos pero el verificador no cuadra: se dice aquí, antes
  // de mandarlo, en vez de un «no te encontramos» que no explica nada.
  const duiMalo = documento.replace(/\D/g, '').length === 9 && !duiValido(documento);

  async function entrarCon(datos) {
    setError(null);
    setEnviando(true);
    const reemplaza = completando ? useSesion.getState().token : undefined;
    const r = await llamar('entrar', { ...datos, plataforma, dispositivo: Device.modelName ?? null, ...(reemplaza ? { reemplaza } : {}) });
    setEnviando(false);
    if (r?.ok && r.token) {
      await guardarEntrada(datos);
      // Recién entró con sus datos o su cara: no se le pide Face ID otra vez.
      useBloqueo.setState({ bloqueada: false });
      // De código a completa: el resumen recortado no sirve, se pide de nuevo.
      if (completando) useCuenta.getState().limpiar();
      await abrir(r.token, r.alcance);
      return true;
    }
    setError(r?.mensaje ?? 'No se pudo entrar.');
    return false;
  }

  async function entrar() {
    if (!listo || enviando) return;
    await entrarCon({ documento: modo === 'codigo' ? codigo : documento, telefono: modo === 'codigo' ? '' : telefono });
  }

  async function entrarRapido() {
    if (enviando || !rapida) return;
    const datos = await datosConBiometria(rapida.biometria);
    if (!datos) return;
    // Si el servidor ya no reconoce esos datos, se olvidan: la próxima vez se escriben.
    if (!(await entrarCon(datos))) { await olvidarEntrada(); setRapida(null); }
  }

  return (
    <Formulario>
      {completando ? (
        <Aviso tipo="aviso">Entraste con el código de tu ticket. Para ver tus compras, facturas, reservas y el chat, entra con tu DUI y teléfono.</Aviso>
      ) : (
        <Segmentos
          valor={modo}
          alCambiar={(m) => { setModo(m); setError(null); }}
          opciones={[{ valor: 'dui', rotulo: 'DUI y teléfono' }, { valor: 'codigo', rotulo: 'Código del ticket' }]}
        />
      )}
      {motivo === 'vencida' ? <Aviso tipo="aviso">Tu sesión terminó. Vuelve a entrar para ver tus puntos.</Aviso> : null}
      {rapida && !completando ? (
        <BotonSistema etiqueta={enviando ? 'Entrando…' : `Entrar ${conBiometria(rapida.biometria)}`} alTocar={entrarRapido}
          deshabilitado={enviando} color={t.color.magenta} />
      ) : null}
      {modo === 'dui' ? (
        <Grupo pie={duiMalo ? 'Revisa tu DUI: ese número no es válido.' : 'Los dos datos que dejaste en tu ficha. Sólo números: el guion se pone solo.'}>
          <FilaCampo
            placeholder="DUI"
            keyboardType="number-pad"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            inputAccessoryViewID={IOS ? BARRA_DUI : undefined}
            value={documento}
            onChangeText={(v) => setDocumento(documentoEscrito(v))}
            returnKeyType="next"
            onSubmitEditing={() => telRef.current?.focus()}
            blurOnSubmit={false}
          />
          <FilaCampo
            ref={telRef}
            placeholder="Teléfono"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            inputAccessoryViewID={IOS ? BARRA_TEL : undefined}
            value={telefono}
            onChangeText={(v) => setTelefono(v.replace(/[^\d ]/g, '').slice(0, 9))}
            returnKeyType="go"
            onSubmitEditing={entrar}
          />
        </Grupo>
      ) : (
        <Grupo pie="Las 7 letras que vienen impresas en tu ticket de puntos. Con el código ves tus puntos, tu tarjeta y las ofertas; para tus compras, facturas, reservas y el chat, entra con tu DUI y teléfono.">
          <FilaCampo
            placeholder="Código"
            autoCapitalize="characters"
            autoCorrect={false}
            value={codigo}
            onChangeText={(v) => setCodigo(v.toUpperCase().replace(ALFABETO, '').slice(0, 7))}
            returnKeyType="go"
            onSubmitEditing={entrar}
            style={{ fontSize: 22, letterSpacing: 6, fontWeight: '600', textAlign: 'center' }}
          />
        </Grupo>
      )}
      {IOS && modo === 'dui' ? (
        <>
          <BarraTeclado id={BARRA_DUI} etiqueta="Siguiente" color={t.color.magentaTexto} alTocar={() => telRef.current?.focus()} />
          <BarraTeclado id={BARRA_TEL} etiqueta={listo ? 'Entrar' : 'Listo'} color={t.color.magentaTexto}
            alTocar={() => { telRef.current?.blur(); if (listo) entrar(); }} />
        </>
      ) : null}
      {error ? <Aviso>{error}</Aviso> : null}
      <BotonSistema etiqueta={enviando ? 'Entrando…' : 'Entrar'} alTocar={entrar} deshabilitado={!listo || enviando} color={t.color.magenta} />
      <Texto nivel={2} estilo={{ textAlign: 'center', marginHorizontal: 32, color: colorSistema.texto2, fontSize: 13 }}>
        ¿No te reconoce? Pregunta en cualquiera de nuestras salas: revisamos tu ficha.
      </Texto>
    </Formulario>
  );
}

// La barra sobre el teclado numérico (sólo iOS): un botón a la derecha, como
// la de los formularios del sistema.
function BarraTeclado({ id, etiqueta, color, alTocar }) {
  return (
    <InputAccessoryView nativeID={id}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8,
        backgroundColor: colorSistema.barra, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
        <Pressable onPress={alTocar} accessibilityRole="button" hitSlop={6}
          style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ fontSize: 17, fontWeight: '600', color }}>{etiqueta}</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}
