// Nueva solicitud de facturación — paso 3: el formulario de lo que se pidió.
// Las mismas reglas del portal (`WidgetAnnulmentRequest.jsx`), del núcleo:
//
//   · anular   — motivo de la lista cerrada; un CCF de otro día exige
//                comentario y confirmar que se tiene autorización; se vuelve a
//                preguntar por la caja justo antes de enviar.
//   · pago     — a qué forma de pago (`pagosPosibles`: nunca la misma ni
//                crédito).
//   · vendedor — alguien activo de la sala (o que ya vendió ahí), distinto del
//                actual.
//   · cliente  — búsqueda de clientes (`buscarClientes`); el id del sistema de
//                origen es obligatorio: sin él no se puede aplicar.
//
// La solicitud se arma con `solicitudDeFacturacion` y se guarda con
// `insertApprovalRequestSilent` (anota la bitácora). A Supervisión le avisa la
// base (`notificar_solicitud_creada`), no la app.
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Presionable as Pressable } from '../../componentes/Tocable';
import Interruptor from '../../componentes/Interruptor';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { insertApprovalRequestSilent } from '@nucleo/data/requests';
import { salaConCajaAbierta } from '@nucleo/data/cortes';
import { buscarClientes } from '@nucleo/data/customers';
import { fetchBranchInvoicesRecent } from '@nucleo/data/facturacion';
import { ambitoDeFacturas, esDeHoy, MOTIVOS_ANULACION, pagosPosibles, ROTULO_PAGO, solicitudDeFacturacion } from '@nucleo/utils/solicitudFacturacion';
import { supervisorQueResuelve } from '@nucleo/utils/aprobadorOperativo';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { Aviso, BotonGrande, Campo, Opciones, Seccion, PantallaSinDato } from '../../componentes/formulario/Piezas';
import { facturaElegida } from '../../componentes/formulario/facturaElegida';
import Avatar from '../../componentes/Avatar';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import MarcaDeEleccion from '../../componentes/MarcaDeEleccion';

const TITULO = { anular: 'Anular la factura', pago: 'Forma de pago', vendedor: 'Cambiar vendedor', cliente: 'Cambiar cliente' };
const TIPO = { anular: 'ANNULMENT_REQUEST', pago: 'PAYMENT_CHANGE_REQUEST', vendedor: 'VENDOR_CHANGE_REQUEST', cliente: 'CLIENT_CHANGE_REQUEST' };

export default function Cambio() {
  const { id, accion } = useLocalSearchParams();
  const inv = facturaElegida(id);
  const { user } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const [motivo, setMotivo] = useState(null);
  const [comentario, setComentario] = useState('');
  const [autorizado, setAutorizado] = useState(false);
  const [pago, setPago] = useState(null);
  const [vendedor, setVendedor] = useState(null);
  const [cliente, setCliente] = useState(null);
  const [texto, setTexto, aplicado] = useBusqueda();
  const [clientes, setClientes] = useState([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (accion !== 'cliente' || aplicado.trim().length < 2) { setClientes([]); return; }
    let vivo = true;
    buscarClientes(aplicado).then((r) => { if (vivo) setClientes(r.data || []); });
    return () => { vivo = false; };
  }, [accion, aplicado]);

  /* Como el portal (`codigosVistos`): quien REALMENTE factura en la sala
   * también se ofrece, aunque esté asignado a otra. Hay códigos que venden
   * donde no están asignados, y sin esto no se les puede reasignar una venta
   * que hicieron. Salen de las facturas recientes de la sala, la misma lista
   * que el portal tiene delante. */
  const salaId = inv?._sala?.id ?? inv?.branch_id;
  const [codigosVistos, setCodigosVistos] = useState(() => new Set());
  useEffect(() => {
    if (accion !== 'vendedor' || salaId == null) return undefined;
    let vivo = true;
    fetchBranchInvoicesRecent(salaId, ambitoDeFacturas()).then((r) => {
      if (vivo && !r?.error) setCodigosVistos(new Set((r.data || []).map((i) => String(i.cod_vendedor ?? '')).filter(Boolean)));
    }).catch(() => {});
    return () => { vivo = false; };
  }, [accion, salaId]);

  const vendedores = useMemo(() => (empleados || [])
    .filter((e) => e.status === 'ACTIVO' && e.code && String(e.code) !== String(inv?.cod_vendedor)
      && (String(e.branchId ?? e.branch_id ?? '') === String(salaId) || codigosVistos.has(String(e.code))))
    .sort((a, b) => shortEmployeeName(a).localeCompare(shortEmployeeName(b))), [empleados, inv, salaId, codigosVistos]);
  const vendedorActual = (empleados || []).find((e) => String(e.code) === String(inv?.cod_vendedor));

  if (!inv || !TIPO[accion]) {
    return <PantallaSinDato titulo="Solicitud" texto="Vuelve a elegir la factura." />;
  }

  const esCCF = inv.tipo_documento === 'CCF';
  const ccfDeOtroDia = esCCF && !esDeHoy(String(inv.fecha).slice(0, 10));
  const aCredito = String(inv.tipo_pago || '').toLowerCase() === 'credito';

  const listoParaEnviar = {
    anular: !!motivo && (!ccfDeOtroDia || (comentario.trim() && autorizado)),
    pago: !!pago,
    vendedor: !!vendedor,
    cliente: !!cliente,
  }[accion];

  const extra = () => {
    switch (accion) {
      case 'anular': return { tipo_pago: inv.tipo_pago, reason: motivo, comment: comentario.trim() || null, is_ccf: esCCF, is_credit_payment: aCredito };
      case 'pago': return { current_pago: inv.tipo_pago, new_pago: pago };
      case 'vendedor': return {
        current_vendor_code: inv.cod_vendedor, current_vendor_name: vendedorActual?.name ?? null, current_vendor_photo: vendedorActual?.photo_url ?? null,
        new_vendor_id: vendedor.id, new_vendor_code: vendedor.code, new_vendor_name: vendedor.name, new_vendor_photo: vendedor.photo_url ?? null,
      };
      default: return {
        current_cliente: inv.cliente ?? null, new_client_id: cliente.id,
        // El id que entiende el sistema de origen es OTRO que el del portal:
        // sin él la solicitud no se puede aplicar.
        new_client_erp_id: cliente.erp_id ?? null,
        new_client_name: cliente.name, new_client_nit: cliente.nit ?? null, new_client_dui: cliente.dui ?? null,
      };
    }
  };

  const enviar = async () => {
    setEnviando(true); trabajando('Enviando la solicitud…');
    try {
      // La caja se vuelve a preguntar AL ENVIAR: pudo cerrar mientras se llenaba.
      if (accion === 'anular' && (await salaConCajaAbierta(inv._sala?.id ?? inv.branch_id)) !== true) {
        fallo('No se puede anular ahora', 'La sucursal ya no tiene caja abierta.'); return;
      }
      const aprobador = supervisorQueResuelve(empleados || []);
      const { error } = await insertApprovalRequestSilent(solicitudDeFacturacion(TIPO[accion], {
        inv, usuarioId: user?.id, sala: inv._sala, aprobador, nota: comentario, extra: extra(),
      }));
      if (error) throw error;
      listo('Solicitud enviada', `La revisa ${aprobador ? shortEmployeeName(aprobador) : 'un supervisor o administrador'}.`);
      router.dismissTo('/solicitudes');
    } catch (e) {
      fallo('No se pudo enviar', mensajeAmigable(e, 'Vuelve a intentar en un momento.'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: TITULO[accion] }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>
            {inv.correlativo} · {formatMoney(inv.total)} · {inv.cliente || 'Consumidor final'}
          </Text>

          {accion === 'anular' ? (
            <>
              {aCredito ? <Aviso tono="cuidado" texto="Venta al crédito. Si se aprueba, también se quita su cuenta por cobrar. Si ya tiene abonos, primero hay que resolverlos." /> : null}
              {esCCF && !ccfDeOtroDia ? <Aviso tono="cuidado" texto="Es un crédito fiscal. Asegúrate de que se emita la nota de crédito." /> : null}
              <Seccion titulo="¿Por qué se anula?"><Opciones opciones={MOTIVOS_ANULACION} valor={motivo} onCambiar={setMotivo} /></Seccion>
              {ccfDeOtroDia ? (
                <Seccion titulo="Crédito fiscal de otro día">
                  <Aviso tono="freno" texto="Solo se anulan el mismo día. Llevan nota de crédito." />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Entiendo y confirmo que tengo autorización para solicitarlo</Text>
                    <Interruptor value={autorizado} onValueChange={setAutorizado} />
                  </View>
                </Seccion>
              ) : null}
            </>
          ) : null}

          {accion === 'pago' ? (
            <Seccion titulo="¿A qué forma de pago?">
              <Opciones opciones={pagosPosibles(inv.tipo_pago).map((p) => ({ id: p, label: ROTULO_PAGO[p] }))} valor={pago} onCambiar={setPago} />
            </Seccion>
          ) : null}

          {accion === 'vendedor' ? (
            <Seccion titulo="¿Quién hizo la venta?">
              {vendedores.length ? vendedores.map((e, i) => (
                <Pressable key={e.id} onPress={() => setVendedor(e)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <Avatar empleado={e} tamano={36} />
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{shortEmployeeName(e)}</Text>
                  <MarcaDeEleccion elegida={vendedor?.id === e.id} />
                </Pressable>
              )) : <Text style={{ color: colorSistema.texto2 }}>No hay otras personas activas en la sucursal.</Text>}
            </Seccion>
          ) : null}

          {accion === 'cliente' ? (
            <Seccion titulo="¿A nombre de quién?">
              <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Nombre, NIT o DUI" autoCorrect={false} />
              {clientes.map((c) => (
                <Pressable key={c.id} onPress={() => setCliente(c)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{c.name}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[c.nit && `NIT ${c.nit}`, c.dui && `DUI ${c.dui}`].filter(Boolean).join(' · ') || 'Sin documento'}</Text>
                  </View>
                  <MarcaDeEleccion elegida={cliente?.id === c.id} />
                </Pressable>
              ))}
              {cliente && !cliente.erp_id ? <Aviso tono="freno" texto="Ese cliente todavía no está registrado en la caja. Elige otro." /> : null}
            </Seccion>
          ) : null}

          <Seccion titulo={accion === 'anular' && ccfDeOtroDia ? 'Comentario (obligatorio)' : 'Comentario (opcional)'}>
            <Campo value={comentario} onChangeText={setComentario} placeholder="Algo que deba saber quien la revisa" />
          </Seccion>

          <BotonGrande texto="Enviar solicitud" color={accion === 'anular' ? MARCA.rojo : MARCA.azul}
            deshabilitado={enviando || !listoParaEnviar || (accion === 'cliente' && !cliente?.erp_id)} onPress={enviar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
