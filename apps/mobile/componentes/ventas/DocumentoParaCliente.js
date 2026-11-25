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
import { Share, Text, View } from 'react-native';
import Indicador from '../Indicador';
import { File, Paths } from 'expo-file-system';
import { zipSync } from 'fflate';
import * as Haptics from 'expo-haptics';
import {
  anotarEntregaDeDte, avisoDeEntregaDeDte, correoDeLaFichaDeLaVenta, correoDelClienteValido, pedirDteParaCliente,
  PASO_DE_SOLVENTACION, solventarHastaElFinal, solventarVenta,
} from '@nucleo/data/facturacion';
import { formatMoney } from '@nucleo/utils/formatNumber';
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
  if (!archivos.length) throw new Error('No llegaron los archivos. Intenta de nuevo.');
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

// Venta sin sello de un mes ya declarado (2026-11-25): el servidor contesta
// `MES_CERRADO` y no la manda. Se ofrece solventarla con una venta nueva de hoy,
// como en el portal (`solventar-venta`), y el documento sale de la nueva.
export default function DocumentoParaCliente({ invoiceId: idVenta }) {
  const [invoiceId, setInvoiceId] = useState(idVenta);
  const [solv, setSolv] = useState(null);               // { plan } | { paso } | { listo }
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
    if (!r.ok && r.codigo === 'MES_CERRADO') {
      setAviso({ ok: false, texto: r.error });
      const plan = await solventarVenta({ accion: 'revisar', invoiceId: idVenta });
      setSolv(plan.ok ? { plan: plan.plan } : { error: plan.error });
      return;
    }
    if (!r.ok) { setAviso({ ok: false, texto: r.error }); return; }
    anotarEntregaDeDte(accion, invoiceId, r.se_envio);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setAviso({ ok: true, texto: accion === 'correo'
      ? avisoDeEntregaDeDte({ accion, correo, seEnvio: r.se_envio })
      : `Documento listo.${r.se_envio ? ' Se envió al MH en este momento.' : ''}` });
    if (accion === 'correo') setPorCorreo(false);
  };

  const solventar = async () => {
    setSolv((s) => ({ ...s, paso: PASO_DE_SOLVENTACION.nueva, error: null }));
    setAviso(null);
    const r = await solventarHastaElFinal(idVenta, (estado) => setSolv((s) => ({ ...s, paso: PASO_DE_SOLVENTACION[estado] ?? 'Trabajando…' })));
    if (!r.ok) { setSolv((s) => ({ ...s, paso: null, error: r.error })); return; }
    setInvoiceId(r.nueva_invoice_id);
    setSolv({ listo: true });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setAviso({ ok: true, texto: 'Listo. La venta nueva ya tiene su documento. Compártelo o mándalo por correo.' });
  };

  return (
    <Seccion titulo="Documento electrónico" pie="El PDF y el JSON para el cliente. Si la venta no tiene sello, se envía al MH primero.">
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
            <Indicador size="small" />
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>Puede tardar hasta un minuto si hay que enviarlo al MH.</Text>
          </View>
        ) : null}
        {solv && !solv.listo ? (
          <View style={{ gap: 8 }}>
            {solv.plan ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                {`Se hace una venta nueva de hoy: ${solv.plan.lineas.length} producto${solv.plan.lineas.length === 1 ? '' : 's'}, ${formatMoney(solv.plan.total)}, ${solv.plan.pago === 'contado' ? 'al contado (con su vale)' : `con ${solv.plan.pago}`}. Los productos vuelven a la existencia antes de venderlos.`}
              </Text>
            ) : null}
            {solv.paso ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Indicador size="small" />
                <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{solv.paso}</Text>
              </View>
            ) : solv.plan ? (
              <BotonGrande texto="Solventar con venta nueva" color={MARCA.azul} onPress={solventar} />
            ) : null}
            {solv.error ? <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>{solv.error}</Text> : null}
          </View>
        ) : null}
        {aviso ? (
          <Text accessibilityLiveRegion="polite" style={{ color: aviso.ok ? MARCA.verde : MARCA.rojo, fontSize: 14, fontWeight: '600' }}>{aviso.texto}</Text>
        ) : null}
      </View>
    </Seccion>
  );
}
