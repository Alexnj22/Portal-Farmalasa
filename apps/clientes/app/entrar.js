// Entrar: con los dos datos de la ficha (documento + teléfono) o con el código
// de 7 letras del ticket. Dos caminos y se dice cuál es cuál: antes el código
// se reconocía «por su forma» en el mismo campo del DUI, y quien tenía un
// código no sabía que podía usarlo.
import { useState } from 'react';
import * as Device from 'expo-device';
import { Aviso, Boton, Campo, Pantalla, Segmentos, Tarjeta, Texto } from '../componentes/ui';
import { llamar } from '../lib/api';
import { plataforma, useSesion } from '../lib/sesion';

// El alfabeto del código no tiene letras ni números que se confundan
// (sin O/0, I/1, S/5…), igual que el que emite la sala.
const ALFABETO = /[^ACDEFGHJKMNPQRTUVWXY34679]/g;

/** 12345678-9 mientras se escribe: así se lee como en el documento. */
function conGuion(v) {
  const d = v.replace(/\D/g, '').slice(0, 9);
  return d.length > 8 ? `${d.slice(0, 8)}-${d.slice(8)}` : d;
}

export default function Entrar() {
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
    <Pantalla conPestanas={false}>
      <Segmentos
        valor={modo}
        alCambiar={(m) => { setModo(m); setError(null); }}
        opciones={[{ valor: 'dui', rotulo: 'DUI y teléfono' }, { valor: 'codigo', rotulo: 'Código del ticket' }]}
      />
      <Tarjeta estilo={{ gap: 16 }}>
        {modo === 'dui' ? (
          <>
            <Texto nivel={2}>Los dos datos que dejaste en tu ficha de cliente.</Texto>
            <Campo
              etiqueta="DUI"
              placeholder="00000000-0"
              keyboardType="number-pad"
              autoCorrect={false}
              value={documento}
              onChangeText={(v) => setDocumento(/[A-Za-z]/.test(v) ? v.toUpperCase() : conGuion(v))}
              ayuda="Si te registraste con NIT o pasaporte, escríbelo aquí."
            />
            <Campo
              etiqueta="Teléfono"
              placeholder="7000 0000"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              value={telefono}
              onChangeText={(v) => setTelefono(v.replace(/[^\d ]/g, '').slice(0, 9))}
            />
          </>
        ) : (
          <>
            <Texto nivel={2}>El código de 7 letras que viene impreso en tu ticket de puntos.</Texto>
            <Campo
              etiqueta="Código"
              placeholder="K7MP4XN"
              autoCapitalize="characters"
              autoCorrect={false}
              value={codigo}
              onChangeText={(v) => setCodigo(v.toUpperCase().replace(ALFABETO, '').slice(0, 7))}
              estilo={{ fontSize: 24, letterSpacing: 6, fontWeight: '700', textAlign: 'center' }}
            />
          </>
        )}
        {error ? <Aviso>{error}</Aviso> : null}
        <Boton alTocar={entrar} cargando={enviando} deshabilitado={!listo}>Entrar</Boton>
      </Tarjeta>
      <Texto nivel={3} estilo={{ textAlign: 'center', paddingHorizontal: 12 }}>
        ¿No te reconoce? Pregunta en cualquiera de nuestras salas: revisamos tu ficha.
      </Texto>
    </Pantalla>
  );
}
