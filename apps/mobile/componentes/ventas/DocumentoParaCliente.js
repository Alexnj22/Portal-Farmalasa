// El documento electrónico para el cliente que lo pide (2026-10-19) — la gemela
// de `src/components/facturacion/DocumentoParaCliente.jsx`. Directo, sin
// solicitud: el cliente está enfrente. Si la venta no tiene sello —el caso
// típico es el consumidor final de después de las 6:00 p. m., que por regla no
// se envía a Hacienda— el servidor lo manda en ese momento y después entrega
// el PDF y el JSON (`pedirDteParaCliente`, núcleo).
//
//   · «Compartir»: los dos archivos en un ZIP a la hoja del sistema (el portal
//     lo descarga). Es una salida de datos: `registrarEgreso('dte_venta')`
//     sólo si de verdad se compartió.
//   · «Por correo»: lo manda el servidor al correo que se escriba.
//
// Vive donde la sala mira una venta: la ficha de Ventas y la factura elegida
// en «Modificar facturación», igual que en el portal.
import { useState } from 'react';
import { ActivityIndicator, Share, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { zipSync } from 'fflate';
import * as Haptics from 'expo-haptics';
import {
  anotarEntregaDeDte, avisoDeEntregaDeDte, correoDeLaFichaDeLaVenta, correoDelClienteValido, pedirDteParaCliente,
} from '@nucleo/data/facturacion';
import { registrarEgreso } from '@nucleo/data/egreso';
import { colorSistema } from '../Formulario';
import { BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';

const limpio = (n) => String(n).replace(/[\\/:*?"<>|]+/g, '-');

function bytesDeBase64(b64) {
  const bin = globalThis.atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Los archivos que devolvió el servidor, en un ZIP, a la hoja de compartir. */
async function compartirArchivos(archivos, invoiceId) {
  if (!archivos.length) throw new Error('El servidor no devolvió archivos.');
  const zip = zipSync(Object.fromEntries(archivos.map((a) => [a.nombre, bytesDeBase64(a.base64)])));
  const nombre = limpio(`${(archivos[0]?.nombre || 'documento').replace(/\.[^.]+$/, '')}.zip`);
  const f = new File(Paths.cache, nombre);
  if (f.exists) f.delete();
  f.create();
  f.write(zip);
  const r = await Share.share({ url: f.uri, title: nombre });
  if (r.action === Share.sharedAction) {
    registrarEgreso('dte_venta', { formato: 'zip', filas: archivos.length, detalle: { invoice_id: invoiceId, para: 'cliente', via: 'app' } });
  }
}

export default function DocumentoParaCliente({ invoiceId }) {
  const [porCorreo, setPorCorreo] = useState(false);
  const [correo, setCorreo] = useState('');
  const [trabajando, setTrabajando] = useState(null);   // 'descargar' | 'correo'
  const [aviso, setAviso] = useState(null);             // { ok, texto }
  const correoOk = correoDelClienteValido(correo);

  // Se propone el correo de la ficha del cliente, si tiene uno válido; sólo
  // si el campo sigue vacío, para no pisar lo que ya se escribió.
  const abrirCorreo = async () => {
    setPorCorreo(true);
    if (correo.trim()) return;
    const deLaFicha = await correoDeLaFichaDeLaVenta(invoiceId);
    if (deLaFicha) setCorreo((actual) => (actual.trim() ? actual : deLaFicha));
  };

  const pedir = async (accion) => {
    setTrabajando(accion);
    setAviso(null);
    const r = await pedirDteParaCliente({ accion, invoiceId, correo: accion === 'correo' ? correo.trim() : null });
    if (r.ok && accion === 'descargar') {
      try { await compartirArchivos(r.archivos, invoiceId); } catch (e) {
        setTrabajando(null);
        setAviso({ ok: false, texto: e?.message || 'No se pudo preparar el archivo.' });
        return;
      }
    }
    setTrabajando(null);
    if (!r.ok) { setAviso({ ok: false, texto: r.error }); return; }
    anotarEntregaDeDte(accion, invoiceId, r.se_envio);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setAviso({ ok: true, texto: accion === 'correo'
      ? avisoDeEntregaDeDte({ accion, correo, seEnvio: r.se_envio })
      : `Documento listo.${r.se_envio ? ' Se envió a Hacienda en este momento.' : ''}` });
    if (accion === 'correo') setPorCorreo(false);
  };

  return (
    <Seccion titulo="Documento electrónico" pie="El PDF y el JSON para el cliente. Si la venta no tiene sello, se envía a Hacienda primero.">
      <View style={{ gap: 8 }}>
        <BotonGrande texto={trabajando === 'descargar' ? 'Preparando…' : 'Compartir PDF y JSON'} borde color={MARCA.azulClaro}
          deshabilitado={!!trabajando} onPress={() => pedir('descargar')} />
        {porCorreo ? (
          <>
            <Campo multiline={false} value={correo} onChangeText={setCorreo} placeholder="cliente@correo.com"
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" />
            <BotonGrande texto={trabajando === 'correo' ? 'Enviando…' : 'Enviar por correo'} color={MARCA.azul}
              deshabilitado={!correoOk || !!trabajando} onPress={() => pedir('correo')} />
          </>
        ) : (
          <BotonGrande texto="Mandarlo por correo" borde color={MARCA.azulClaro} deshabilitado={!!trabajando} onPress={abrirCorreo} />
        )}
        {trabajando ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <ActivityIndicator size="small" />
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>Puede tardar hasta un minuto si hay que enviarlo a Hacienda.</Text>
          </View>
        ) : null}
        {aviso ? (
          <Text accessibilityLiveRegion="polite" style={{ color: aviso.ok ? MARCA.verde : MARCA.rojo, fontSize: 14, fontWeight: '600' }}>{aviso.texto}</Text>
        ) : null}
      </View>
    </Seccion>
  );
}
