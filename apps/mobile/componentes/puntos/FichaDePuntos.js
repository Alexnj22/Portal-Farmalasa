// Dos marcas de la ficha de puntos, NATIVAS — `ObservacionDelCliente` y
// `TipoDePersona` de `src/views/puntos/ClientePuntosModal.jsx` (2026-11-13,
// usuario: «dejemos TODO completamente nativo»). Mismas lecturas y mismas
// RPC del núcleo; lo decide quien puede dar o quitar puntos (`puntos_ajustar`).
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { cerrarObservacion, fetchObservacionDeCliente, fetchTipoDePersona, guardarTipoDePersona } from '@nucleo/data/puntos';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { BotonGrande, Campo } from '../formulario/Piezas';
import Tocable from '../Tocable';
import Vidrio from '../Vidrio';
import IconoFijo from '../IconoFijo';
import { iconoDe } from '../../tema/iconos';
import { MARCA, tintaSobre } from '../inicio/marca';

function Tarjeta({ icono, color, titulo, children }) {
  return (
    <Vidrio radio={20} tinte={`${color}22`}>
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconoFijo name={iconoDe(icono)} size={18} color={color} />
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700', flex: 1 }}>{titulo}</Text>
        </View>
        {children}
      </View>
    </Vidrio>
  );
}

/**
 * En observación (Reglamento v2, cláusula 8.2): se le anuló una compra después
 * de canjear sus puntos. Sólo es una marca —no bloquea el canje—; la abre la
 * base sola y la cierra quien puede ajustar puntos, con la nota de qué revisó.
 */
export function ObservacionDelCliente({ customerId, nombre, salas, puedeCerrar, version, onHecho }) {
  const [casos, setCasos] = useState([]);
  const [cerrando, setCerrando] = useState(false);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchObservacionDeCliente(customerId)
      .then((c) => { if (vivo) setCasos(c); })
      .catch((e) => console.warn('[puntos] observación', e?.message));
    return () => { vivo = false; };
  }, [customerId, version]);

  if (!casos.length) return null;

  const cerrar = async () => {
    if (!nota.trim() || guardando) return;
    setGuardando(true);
    try {
      // La bitácora la anota `cerrarObservacion`.
      await cerrarObservacion({ customerId, nota }, { nombre, desde: 'app' });
      setCasos([]);
      setCerrando(false);
      setNota('');
      onHecho?.();
      Alert.alert('Observación cerrada', 'El cliente ya no está en observación.');
    } catch (e) {
      Alert.alert('No se pudo cerrar', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Tarjeta icono="Eye" color={MARCA.ambar} titulo="En observación">
      <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
        {casos.length === 1
          ? 'Se le anuló una compra después de canjear los puntos que esa compra le dio.'
          : `Se le anularon ${casos.length} compras después de canjear los puntos que le dieron.`}
      </Text>
      <View style={{ gap: 4 }}>
        {casos.map((c) => (
          <Text key={c.id} style={{ color: colorSistema.texto, fontSize: 13, fontVariant: ['tabular-nums'] }}>
            {[fechaNumerica(c.created_at), salas?.[c.sucursal] ?? null, c.motivo].filter(Boolean).join(' · ')}
          </Text>
        ))}
      </View>
      {puedeCerrar && !cerrando ? <BotonGrande texto="Cerrar observación" borde color={MARCA.ambar} onPress={() => setCerrando(true)} /> : null}
      {cerrando ? (
        <View style={{ gap: 8 }}>
          <Campo value={nota} onChangeText={(t) => setNota(t.slice(0, 200))} autoFocus
            placeholder="Qué se revisó. Ej.: se habló con el cliente, la anulación fue un error de caja" />
          <BotonGrande texto={guardando ? 'Cerrando…' : 'Cerrar observación'} color={MARCA.ambar}
            deshabilitado={!nota.trim() || guardando} onPress={cerrar} />
          <BotonGrande texto="Cancelar" borde color={colorSistema.texto2} deshabilitado={guardando}
            onPress={() => { setCerrando(false); setNota(''); }} />
        </View>
      ) : null}
    </Tarjeta>
  );
}

const TIPOS = [{ id: 'natural', label: 'Persona natural' }, { id: 'juridica', label: 'Persona jurídica' }];

/**
 * Persona natural o jurídica (Reglamento v2, cláusula 2.2): desde el 15 de
 * noviembre sólo la natural acumula. La base lo decide sola por la forma legal
 * del nombre y pide evaluar los nombres de negocio; lo decide quien puede
 * ajustar puntos y los demás sólo lo ven.
 */
export function TipoDePersona({ customerId, nombre, puedeCambiar }) {
  const [ficha, setFicha] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchTipoDePersona(customerId)
      .then((f) => { if (vivo) setFicha(f); })
      .catch((e) => console.warn('[puntos] tipo de persona', e?.message));
    return () => { vivo = false; };
  }, [customerId]);

  if (!ficha) return null;
  const juridica = ficha.tipo_persona === 'juridica';
  const porEvaluar = !!ficha.tipo_persona_revisar;
  // Una natural decidida sola no necesita aviso: es el caso de casi todas.
  if (!juridica && !porEvaluar && !puedeCambiar) return null;

  const elegir = async (tipo) => {
    if (guardando || (tipo === ficha.tipo_persona && !porEvaluar)) return;
    setGuardando(true);
    try {
      // La bitácora la anota `guardarTipoDePersona`.
      await guardarTipoDePersona({ customerId, tipo }, { nombre, desde: 'app' });
      setFicha({ tipo_persona: tipo, tipo_persona_revisar: false, tipo_persona_manual_at: new Date().toISOString() });
      Alert.alert('Tipo de persona guardado',
        tipo === 'juridica' ? 'Desde el 15 de noviembre esta ficha no acumula puntos.' : 'La ficha acumula puntos como persona natural.');
    } catch (e) {
      Alert.alert('No se pudo guardar', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  const texto = porEvaluar
    ? 'Su nombre parece de un negocio. Hay que decidir si es persona natural o jurídica: desde el 15 de noviembre sólo la persona natural acumula. Mientras tanto acumula.'
    : juridica
      ? `Es persona jurídica${ficha.tipo_persona_manual_at ? '' : ' por su nombre'}: desde el 15 de noviembre no acumula puntos.`
      : 'Persona natural: acumula puntos.';
  const color = porEvaluar ? MARCA.ambar : juridica ? MARCA.azulClaro : colorSistema.texto2;

  return (
    <Tarjeta icono={juridica ? 'Building2' : 'User'} color={color} titulo={porEvaluar ? 'Falta decidir el tipo de persona' : 'Tipo de persona'}>
      <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{texto}</Text>
      {puedeCambiar ? (
        // Dos botones propios y no `Segmentos`: dentro de una lista que se
        // desplaza, la capa SwiftUI del segmentado no sigue a su vista en iOS.
        <View style={{ flexDirection: 'row', gap: 8, opacity: guardando ? 0.6 : 1 }}>
          {TIPOS.map((t) => {
            const activa = !porEvaluar && ficha.tipo_persona === t.id;
            return (
              <Tocable key={t.id} disabled={guardando} onPress={() => elegir(t.id)} accessibilityRole="button" accessibilityState={{ selected: activa }}
                style={{ flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                  backgroundColor: activa ? MARCA.azul : 'rgba(127,127,127,0.14)' }}>
                <Text style={{ color: activa ? tintaSobre(MARCA.azul) : colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{t.label}</Text>
              </Tocable>
            );
          })}
        </View>
      ) : null}
    </Tarjeta>
  );
}
