// El código por WhatsApp al entrar desde un teléfono nuevo (2026-11-11).
//
// Lo muestran Entrar y Registro cuando el servidor contesta `pide_codigo`. El
// servidor decide cuándo hace falta (fila `clientes_codigo_whatsapp` de
// security_config y las llaves de WhatsApp en `app-clientes`): mientras esté
// apagado, esta pantalla no aparece nunca. Viaja en el build de la tienda a
// propósito — una instalación nueva arranca con el código del build, no con la
// actualización por aire, y sin este paso no podría entrar.
//
// Quien llama hace lo mismo que con una entrada normal al recibir el token:
// `alVerificado(r)` recibe la misma respuesta que `entrar`.
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import * as Device from 'expo-device';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotonSistema, FilaCampo, Formulario, Grupo } from './sistema';
import { Aviso } from './ui';
import { llamar } from '../lib/api';
import { plataforma } from '../lib/sesion';
import { idDispositivo } from '../lib/dispositivo';
import { useTema } from '../tema/tema';

export default function PasoCodigoWhatsapp({ reto, telefono, segundos = 60, extra = null, alVerificado, alReenviar, alVolver }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [espera, setEspera] = useState(segundos);
  const campo = useRef(null);

  // Código nuevo (reenviado): se empieza otra vez.
  useEffect(() => { setCodigo(''); setError(null); setEspera(segundos); campo.current?.focus(); }, [reto, segundos]);
  useEffect(() => {
    if (espera <= 0) return undefined;
    const id = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [espera]);

  async function verificar(valor = codigo) {
    if (valor.length !== 6 || enviando) return;
    setError(null);
    setEnviando(true);
    const r = await llamar('verificar_entrada', {
      reto, codigo: valor, id_dispositivo: await idDispositivo(),
      plataforma, dispositivo: Device.modelName ?? null, ...(extra ?? {}),
    });
    if (r?.ok && r.token) { await alVerificado(r); return; }
    setEnviando(false);
    setCodigo('');
    setError(r?.mensaje ?? 'No se pudo comprobar el código.');
  }

  async function reenviar() {
    if (espera > 0 || enviando) return;
    setError(null);
    setEnviando(true);
    const msg = await alReenviar();
    setEnviando(false);
    if (msg) setError(msg);
  }

  const pie = (
    <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', gap: 12, paddingTop: 12, paddingBottom: Math.max(ins.bottom, 12) }}>
      {error ? <Aviso>{error}</Aviso> : null}
      <BotonSistema etiqueta={enviando ? 'Comprobando…' : 'Entrar'} alTocar={() => verificar()}
        deshabilitado={codigo.length !== 6 || enviando} color={t.color.magenta} />
      <BotonSistema etiqueta={espera > 0 ? `Mandar otro código (${espera})` : 'Mandar otro código'} alTocar={reenviar}
        variante="outlined" deshabilitado={espera > 0 || enviando} color={t.color.magenta} />
      <BotonSistema etiqueta="No es mi número: volver" alTocar={alVolver} variante="text" deshabilitado={enviando} color={t.color.magenta} />
    </View>
  );

  return (
    <Formulario pie={pie}>
      <Grupo titulo="Confirma que eres tú" pie={`Es la primera vez que entras desde este teléfono. Te mandamos un código de 6 números por WhatsApp al ${telefono ?? 'teléfono de tu ficha'}. Vence en 10 minutos.`}>
        <FilaCampo
          ref={campo}
          autoFocus
          placeholder="Código"
          accessibilityLabel="Código de WhatsApp, 6 números"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
          value={codigo}
          editable={!enviando}
          onChangeText={(v) => {
            const limpio = v.replace(/\D/g, '').slice(0, 6);
            setCodigo(limpio);
            // Pegado o escrito entero: se comprueba solo.
            if (limpio.length === 6) verificar(limpio);
          }}
          style={{ fontSize: 26, letterSpacing: 8, fontWeight: '600', textAlign: 'center' }}
        />
      </Grupo>
    </Formulario>
  );
}
