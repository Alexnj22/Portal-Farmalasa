// Entrar: con los dos datos de la ficha (documento + teléfono) o con el código
// de 7 letras del ticket. La forma es la del sistema: control segmentado,
// formulario agrupado como Ajustes y el botón nativo (ver componentes/sistema.js).
import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import * as Device from 'expo-device';
import Segmentos from '../componentes/Segmentos';
import { BotonSistema, colorSistema, FilaCampo, Formulario, Grupo } from '../componentes/sistema';
import { Aviso, Texto } from '../componentes/ui';
import { llamar } from '../lib/api';
import { plataforma, useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';
import { documentoEscrito } from '../lib/formato';
import { datosConBiometria, entradaDisponible, guardarEntrada, olvidarEntrada } from '../lib/entradaGuardada';

// El alfabeto del código no tiene letras ni números que se confundan
// (sin O/0, I/1, S/5…), igual que el que emite la sala.
const ALFABETO = /[^ACDEFGHJKMNPQRTUVWXY34679]/g;

export default function Entrar() {
  const t = useTema();
  const abrir = useSesion((s) => s.abrir);
  // Llegando desde el QR del ticket (app/mis-puntos.js), con el código escrito.
  const { codigo: delQr } = useLocalSearchParams();
  const [modo, setModo] = useState(delQr ? 'codigo' : 'dui');
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
  useEffect(() => { entradaDisponible().then(setRapida); }, []);
  useEffect(() => {
    if (rapida && !ofrecida.current && !delQr) { ofrecida.current = true; entrarRapido(); }
  }, [rapida]); // eslint-disable-line react-hooks/exhaustive-deps

  const listo = modo === 'codigo'
    ? codigo.length === 7
    : documento.replace(/[^A-Za-z0-9]/g, '').length >= 7 && telefono.replace(/\D/g, '').length >= 8;

  async function entrarCon(datos) {
    setError(null);
    setEnviando(true);
    const r = await llamar('entrar', { ...datos, plataforma, dispositivo: Device.modelName ?? null });
    setEnviando(false);
    if (r?.ok && r.token) {
      await guardarEntrada(datos);
      await abrir(r.token);
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
      <Segmentos
        valor={modo}
        alCambiar={(m) => { setModo(m); setError(null); }}
        opciones={[{ valor: 'dui', rotulo: 'DUI y teléfono' }, { valor: 'codigo', rotulo: 'Código del ticket' }]}
      />
      {motivo === 'vencida' ? <Aviso tipo="aviso">Tu sesión terminó. Vuelve a entrar para ver tus puntos.</Aviso> : null}
      {rapida ? (
        <BotonSistema etiqueta={enviando ? 'Entrando…' : `Entrar con ${rapida.biometria}`} alTocar={entrarRapido}
          deshabilitado={enviando} color={t.color.magenta} />
      ) : null}
      {modo === 'dui' ? (
        <Grupo pie="Los dos datos que dejaste en tu ficha. Sólo números: el guion se pone solo. Si te registraste con NIT, escríbelo en lugar del DUI.">
          <FilaCampo
            placeholder="DUI"
            keyboardType="number-pad"
            autoCorrect={false}
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
            value={telefono}
            onChangeText={(v) => setTelefono(v.replace(/[^\d ]/g, '').slice(0, 9))}
            returnKeyType="go"
            onSubmitEditing={entrar}
          />
        </Grupo>
      ) : (
        <Grupo pie="Las 7 letras que vienen impresas en tu ticket de puntos.">
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
      {error ? <Aviso>{error}</Aviso> : null}
      <BotonSistema etiqueta={enviando ? 'Entrando…' : 'Entrar'} alTocar={entrar} deshabilitado={!listo || enviando} color={t.color.magenta} />
      <Texto nivel={2} estilo={{ textAlign: 'center', marginHorizontal: 32, color: colorSistema.texto2, fontSize: 13 }}>
        ¿No te reconoce? Pregunta en cualquiera de nuestras salas: revisamos tu ficha.
      </Texto>
    </Formulario>
  );
}
