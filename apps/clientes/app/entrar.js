// Entrar: con los dos datos de la ficha (documento + teléfono) o con el código
// de 7 letras del ticket. La forma es la del sistema: control segmentado,
// formulario agrupado como Ajustes y el botón nativo (ver componentes/sistema.js).
import { useState } from 'react';
import * as Device from 'expo-device';
import Segmentos from '../componentes/Segmentos';
import { BotonSistema, colorSistema, FilaCampo, Formulario, Grupo } from '../componentes/sistema';
import { Aviso, Texto } from '../componentes/ui';
import { llamar } from '../lib/api';
import { plataforma, useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';

// El alfabeto del código no tiene letras ni números que se confundan
// (sin O/0, I/1, S/5…), igual que el que emite la sala.
const ALFABETO = /[^ACDEFGHJKMNPQRTUVWXY34679]/g;

/** 12345678-9 mientras se escribe: así se lee como en el documento. */
function conGuion(v) {
  const d = v.replace(/\D/g, '').slice(0, 9);
  return d.length > 8 ? `${d.slice(0, 8)}-${d.slice(8)}` : d;
}

export default function Entrar() {
  const t = useTema();
  const abrir = useSesion((s) => s.abrir);
  const [modo, setModo] = useState('dui');
  const [documento, setDocumento] = useState('');
  const [telefono, setTelefono] = useState('');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const listo = modo === 'codigo'
    ? codigo.length === 7
    : documento.replace(/[^A-Za-z0-9]/g, '').length >= 7 && telefono.replace(/\D/g, '').length >= 8;

  async function entrar() {
    if (!listo || enviando) return;
    setError(null);
    setEnviando(true);
    const r = await llamar('entrar', {
      documento: modo === 'codigo' ? codigo : documento,
      telefono: modo === 'codigo' ? '' : telefono,
      plataforma, dispositivo: Device.modelName ?? null,
    });
    setEnviando(false);
    if (r?.ok && r.token) await abrir(r.token);
    else setError(r?.mensaje ?? 'No se pudo entrar.');
  }

  return (
    <Formulario>
      <Segmentos
        valor={modo}
        alCambiar={(m) => { setModo(m); setError(null); }}
        opciones={[{ valor: 'dui', rotulo: 'DUI y teléfono' }, { valor: 'codigo', rotulo: 'Código del ticket' }]}
      />
      {modo === 'dui' ? (
        <Grupo pie="Los dos datos que dejaste en tu ficha. Si te registraste con NIT o pasaporte, escríbelo en lugar del DUI.">
          <FilaCampo
            placeholder="DUI"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            autoCapitalize="characters"
            value={documento}
            onChangeText={(v) => setDocumento(/[A-Za-z]/.test(v) ? v.toUpperCase() : conGuion(v))}
            returnKeyType="next"
          />
          <FilaCampo
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
