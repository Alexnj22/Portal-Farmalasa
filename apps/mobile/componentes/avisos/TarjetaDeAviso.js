// La tarjeta de UN aviso en la app — la de la campana del portal
// (`TarjetaDeAviso.jsx`), completa. Reporte del usuario del 2026-10-05: «no me
// da la misma info que me da en el portal web, en la app todo es compacto y
// casi nada de info».
//
// La versión anterior dibujaba un resumen de cada aviso. Ésta dibuja lo MISMO
// que el portal, pieza por pieza, y el cuerpo de cada tipo vive en su grupo:
//   · `cuerpos/cierres`      — cierre del día, del mes y de la empresa, faltante,
//                              diferencias pendientes, aperturas, créditos;
//   · `cuerpos/operacion`    — corte, bitácora, traslados por respaldo, MIN·MAX,
//                              bolsa, depósito, alerta de ventas, factura, cortes
//                              pendientes, pedido;
//   · `cuerpos/solicitudes`  — solicitud, respuesta, decisión, diferencia,
//                              conteo, Hacienda, promoción, metas, reinicio,
//                              productos sin venta.
// Los datos salen de las MISMAS funciones del núcleo que usa el portal: si un
// aviso cambia de forma, las dos tarjetas se enteran juntas.
//
// Y lo que la tarjeta HACE, como en el portal: «Ver detalle» despliega la
// solicitud ahí mismo (`DetalleDeAviso`), «Ver los N…» despliega la lista
// entera, y Aprobar / Rechazar deciden sin salir de la bandeja con la misma
// regla de quién puede (`utils/accionesDeAviso`).
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cuandoLlego, etiquetaDeAccion, RESUELTA_LABEL, severidadDelTitulo, tituloSinEmoji } from '@nucleo/utils/notificacionTexto';
import { puedeDecidirAviso, trasladoPorResolver } from '@nucleo/utils/accionesDeAviso';
import { esAvisoDeMinMax } from '@nucleo/data/solicitudDeAviso';
import { datosDeDecision, datosDeDiferencia, datosDeRespuesta, datosDeSolicitud, diferenciaMeToca } from '@nucleo/utils/avisosDeOperacion';
import { datosDeDiferenciasPendientes } from '@nucleo/utils/faltanteDeCaja';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Vidrio from '../Vidrio';
import Avatar from '../Avatar';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { decidirDesdeAviso } from '../avisos';
import { usePorDecidir } from '../porDecidir';
import { Insignia, Lista } from './Piezas';
import { usePersona } from './persona';
import { armarDeCierres } from './cuerpos/cierres';
import { armarDeOperacion } from './cuerpos/operacion';
import { armarDeSolicitudes } from './cuerpos/solicitudes';
import DetalleDeAviso from './DetalleDeAviso';

const ICONO_DE_SEVERIDAD = { AlertCircle: ['AlertCircle', MARCA.rojo], AlertTriangle: ['AlertTriangle', MARCA.ambar], CheckCircle2: ['CheckCircle2', MARCA.verde] };

function Boton({ texto, onPress, principal, color = MARCA.azul, ocupado }) {
  return (
    <Pressable onPress={(e) => { e.stopPropagation?.(); Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={ocupado}
      style={({ pressed }) => ({
        flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12,
        backgroundColor: principal ? color : 'rgba(255,255,255,0.08)', borderWidth: principal ? 0 : 0.5, borderColor: colorSistema.separador,
        opacity: ocupado ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      <Text style={{ color: principal ? '#fff' : colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

// De quién y de qué sala, con la cara adelante (el pie del portal).
function DeQuien({ id, sala }) {
  const quien = usePersona(id, null, null);
  if (!quien && !sala) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
      {quien ? <Avatar empleado={quien} tamano={22} /> : null}
      <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '700' }}>{quien ? shortEmployeeName(quien) : sala}</Text>
      {quien && sala ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`· ${sala}`}</Text> : null}
    </View>
  );
}

function Fallback({ n, detalle, expandida }) {
  return (
    <>
      {detalle?.contexto ? <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{detalle.contexto}</Text> : null}
      {detalle?.renglones?.length ? <Lista filas={detalle.renglones.map(([a, b]) => [a, b])} resto={detalle.resto ? `y ${detalle.resto} más` : null} /> : null}
      {!detalle && n.body ? <Text style={{ color: colorSistema.texto, fontSize: 15, lineHeight: 21 }} numberOfLines={expandida ? undefined : 5}>{n.body}</Text> : null}
      {detalle?.pie ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle.pie}</Text> : null}
    </>
  );
}

export default function TarjetaDeAviso({ n, detalle, onAbrir, pie = null, sinAcciones = false }) {
  const { user, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const marcarResuelto = useStaffStore((s) => s.marcarAvisoDeSolicitudResuelto);
  const [expandida, setExpandida] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const t = armarDeCierres(n) || armarDeOperacion(n, { expandida }) || armarDeSolicitudes(n, { expandida });
  const sinLeer = !n.read_at;
  const resuelta = n.metadata?.resuelta;
  const accion = resuelta ? (RESUELTA_LABEL[resuelta] || 'Resuelta') : (n.link || n.metadata?.request_id ? (etiquetaDeAccion(n) || 'Ver') : null);
  const sala = n.branch_id ? (sucursales || []).find((b) => String(b.id) === String(n.branch_id))?.name : null;
  const sev = severidadDelTitulo(n.title);
  const [icono, colorIcono] = ICONO_DE_SEVERIDAD[sev?.icono] ?? ['Bell', MARCA.azulClaro];

  // Qué se despliega: la lista entera del grupo, el detalle de la solicitud, o
  // el resto del mensaje — en ese orden, como el portal.
  const tieneDetalle = Boolean(n.metadata?.request_id);
  const largo = !t && (n.body?.length ?? 0) > 220;
  const expandir = t?.expandir
    ?? (tieneDetalle ? { cerrado: 'Ver detalle', abierto: 'Ocultar detalle', detalle: true } : null)
    ?? (largo ? { cerrado: 'Ver mensaje completo', abierto: 'Ocultar mensaje' } : null);

  // Decidir desde la tarjeta: la misma regla de quién puede que el portal.
  // En la papelera del historial no se decide: un aviso quitado se lee.
  const decidible = !sinAcciones && !resuelta && puedeDecidirAviso(n, hasPermission);
  const traslado = !sinAcciones && !resuelta && trasladoPorResolver(n, hasPermission);
  const dif = datosDeDiferencia(n);
  // La tarjeta ya trae la persona (o la sala va en el título): el pie no la repite.
  const conPersona = Boolean(datosDeSolicitud(n) || datosDeRespuesta(n) || datosDeDecision(n) || dif || datosDeDiferenciasPendientes(n));
  const difMeToca = dif && diferenciaMeToca(dif);
  const clave = esAvisoDeMinMax(n) ? `minmax:${n.metadata?.request_id}` : n.metadata?.request_id;
  const decidir = async (modo) => {
    setOcupado(true);
    const ok = await decidirDesdeAviso({ solicitud: clave, url: n.link || '/solicitudes', tarjeta: detalle ? { contexto: detalle.contexto } : undefined }, modo, user?.id);
    setOcupado(false);
    if (ok) {
      marcarResuelto?.(n.metadata?.request_id, modo === 'approve' ? 'APPROVED' : 'REJECTED');
      usePorDecidir.getState().quitar?.(clave);
    }
  };

  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onAbrir(); }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.985 : 1 }] })}>
      <Vidrio radio={22} interactivo tinte={sinLeer ? 'rgba(59,130,246,0.10)' : undefined}>
        <View style={{ padding: 14, gap: 12 }}>
          {t?.encabezado ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>{t.encabezado}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            {t?.lado ?? <Insignia icono={icono} color={colorIcono} />}
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: sinLeer ? '800' : '600', lineHeight: 21 }}>
                {sinLeer ? <Text style={{ color: MARCA.azulClaro }}>● </Text> : null}
                {tituloSinEmoji(n.title)}
              </Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {cuandoLlego(n.created_at)}
                {accion ? <Text style={{ color: resuelta ? colorSistema.texto2 : MARCA.azulClaro, fontWeight: '700' }}>{`  ·  ${accion}${resuelta ? '' : ' ›'}`}</Text> : null}
              </Text>
            </View>
          </View>

          {t?.cuerpo ?? <Fallback n={n} detalle={detalle} expandida={expandida} />}
          {t && !t.ocultarTexto && n.body ? <Text style={{ color: colorSistema.texto, fontSize: 15, lineHeight: 21 }}>{n.body}</Text> : null}

          {!conPersona && (n.created_by || sala) ? <DeQuien id={n.created_by} sala={sala} /> : null}

          {expandir ? (
            <Pressable onPress={(e) => { e.stopPropagation?.(); Haptics.selectionAsync().catch(() => {}); setExpandida((v) => !v); }} hitSlop={6}
              style={{ alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 0.5, borderColor: colorSistema.separador }}>
              <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{expandida ? expandir.abierto : expandir.cerrado}</Text>
            </Pressable>
          ) : null}
          {expandida && expandir?.detalle ? <DetalleDeAviso n={n} /> : null}

          {decidible ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Boton texto="Aprobar" principal ocupado={ocupado} onPress={() => decidir('approve')} />
              <Boton texto="Rechazar" ocupado={ocupado} onPress={() => decidir('reject')} />
            </View>
          ) : traslado ? (
            <Boton texto="Revisar el traslado" principal onPress={onAbrir} />
          ) : !sinAcciones && difMeToca ? (
            <Boton texto="Resolver la diferencia" principal onPress={onAbrir} />
          ) : null}
          {pie}
        </View>
      </Vidrio>
    </Pressable>
  );
}
