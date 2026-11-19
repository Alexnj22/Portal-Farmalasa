// «Sin número», como `views/clientes/SinNumeroDeFicha.jsx` del portal: las
// fichas que todavía no tienen número y que necesitan a una persona. El portal
// le da el número a cada cliente nuevo solo; acá quedan los casos en que no se
// atrevió (un documento a nombre de otra persona, dos fichas posibles, o una
// ficha vieja que no aparece y que crear podría resucitar a alguien dado de baja).
//
// «Reintentar» vuelve a buscar. «Crear de todas formas» autoriza a crearla: es
// una decisión, y queda anotada (`reintentarAlta` la anota). Las dos con
// `clientes_crear`. Sin pendientes ni error, no pinta nada.
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchAltasPendientes, mensajeDeError, reintentarAlta } from '@nucleo/data/customers';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { anotar } from '@nucleo/data/audit';
import { Presionable as Pressable } from '../Tocable';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { avisar, fallo, listo } from '../Progreso';

const cuando = (t) => (t ? `${fechaNumerica(t)} ${hora12(new Date(t))}` : '—');

function Accion({ texto, color, onPress, deshabilitada }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitada} hitSlop={6}
      style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center',
        backgroundColor: `${color}2E`, opacity: deshabilitada ? 0.5 : pressed ? 0.7 : 1 })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function SinNumeroDeFicha() {
  const { hasPermission } = useAuth();
  const puedeCrear = hasPermission('clientes_crear');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(null);

  const cargar = useCallback(async () => {
    try { setDatos(await fetchAltasPendientes()); setError(''); }
    catch (e) { setError(mensajeDeError(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const actuar = async (f, crear) => {
    setOcupado(f.customer_id);
    try {
      const r = await reintentarAlta(f.customer_id, crear, { nombre: f.name });
      if (r?.hecho) listo('Listo', `${f.name}: número ${r.erp_id}.`);
      else if (r?.revisar) avisar('Sigue sin número', r.error || 'Hay que revisarlo.');
      else listo('En camino', 'Se le asigna el número en unos minutos.');
      await cargar();
    } catch (e) {
      const m = mensajeDeError(e);
      setError(m);
      fallo('No se pudo', m);
    } finally {
      setOcupado(null);
    }
  };

  const filas = datos?.porRevisar ?? [];
  if (!filas.length && !error) return null;
  const n = datos?.revisar ?? 0;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ marginHorizontal: 16 }}>
        <Aviso tono="cuidado" texto={`${n === 1 ? 'Un cliente no tiene' : `${n} clientes no tienen`} número. Revísalos. Sin número no se les puede facturar a su nombre.`} />
      </View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {filas.map((f) => (
        <Pressable key={f.customer_id}
          onPress={() => { Haptics.selectionAsync().catch(() => {}); anotar('CLIENTES_VER_FICHA', f.customer_id, { nombre: f.name, desde: 'sin-numero' }); router.push({ pathname: '/cliente/[id]', params: { id: String(f.customer_id) } }); }}
          style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <Vidrio radio={20} interactivo>
            <View style={{ padding: 14, gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{f.name}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>{cuando(f.ultimo_intento_at)}</Text>
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[f.dui, f.phone].filter(Boolean).join(' · ') || 'Sin documento'}</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 13 }}>{f.error || 'Sin detalle'}</Text>
              {puedeCrear ? (
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Accion texto="Reintentar" color={MARCA.azulClaro} deshabilitada={ocupado === f.customer_id} onPress={() => actuar(f, false)} />
                  {!f.permitir_crear ? (
                    <Accion texto="Crear de todas formas" color={MARCA.ambar} deshabilitada={ocupado === f.customer_id} onPress={() => actuar(f, true)} />
                  ) : null}
                </View>
              ) : null}
            </View>
          </Vidrio>
        </Pressable>
      ))}
    </View>
  );
}
