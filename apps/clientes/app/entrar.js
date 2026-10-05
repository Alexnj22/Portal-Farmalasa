// Entrar con lo mismo que en la consulta de puntos: documento y teléfono, los
// dos que están en la ficha. (El código de 7 letras del ticket también sirve:
// el servidor lo reconoce por su forma y entonces no pide teléfono.)
import { useState } from 'react';
import * as Device from 'expo-device';
import { Aviso, Boton, Campo, Pantalla, Texto } from '../componentes/ui';
import { llamar } from '../lib/api';
import { plataforma, useSesion } from '../lib/sesion';

const ES_CODIGO = /^[ACDEFGHJKMNPQRTUVWXY34679]{7}$/;

export default function Entrar() {
  const abrir = useSesion((s) => s.abrir);
  const [documento, setDocumento] = useState('');
  const [telefono, setTelefono] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const esCodigo = ES_CODIGO.test(documento.replace(/[^A-Za-z0-9]/g, '').toUpperCase());

  async function entrar() {
    setError(null);
    setEnviando(true);
    const r = await llamar('entrar', { documento, telefono, plataforma, dispositivo: Device.modelName ?? null });
    setEnviando(false);
    if (r?.ok && r.token) await abrir(r.token);
    else setError(r?.mensaje ?? 'No se pudo entrar.');
  }

  return (
    <Pantalla conPestanas={false}>
      <Texto nivel={2}>Usa los dos datos que están en tu ficha de cliente.</Texto>
      <Campo
        etiqueta="DUI o documento"
        placeholder="00000000-0"
        autoCapitalize="characters"
        autoCorrect={false}
        value={documento}
        onChangeText={setDocumento}
        ayuda="También sirve el código de 7 letras de tu ticket."
      />
      {esCodigo ? null : (
        <Campo
          etiqueta="Teléfono"
          placeholder="7000 0000"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          value={telefono}
          onChangeText={setTelefono}
        />
      )}
      {error ? <Aviso>{error}</Aviso> : null}
      <Boton alTocar={entrar} cargando={enviando} deshabilitado={documento.length < 7 || (!esCodigo && telefono.replace(/\D/g, '').length < 8)}>
        Entrar
      </Boton>
      <Texto nivel={3}>¿No te reconoce? Pregunta en cualquiera de nuestras salas: revisamos tu ficha.</Texto>
    </Pantalla>
  );
}
