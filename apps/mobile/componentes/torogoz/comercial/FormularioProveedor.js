// El alta y la edición de un proveedor de la distribuidora (el
// `ProveedorModal` del portal). Lo usan la pantalla del proveedor y la compra
// (cuando el documento del proveedor trae uno que todavía no está registrado:
// `inicial` viene con nombre, NIT y NRC ya leídos, y registrarlo es confirmar).
import { useEffect, useRef, useState } from 'react';
import { Alert, Text } from 'react-native';
import useBorrador from '@nucleo/hooks/useBorrador';
import { guardarProveedor } from '@nucleo/data/distribucionCompras';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { anotar } from '@nucleo/data/audit';
import { leerFormularioDeProveedor, mensajeDeProveedor, proveedorAFormulario } from '@nucleo/utils/distribucionComercial';
import { colorSistema } from '../../Formulario';
import { BotonGrande, Seccion } from '../../formulario/Piezas';
import { CampoConRotulo } from '../../personas/Formulario';
import { fallo, listo, trabajando } from '../../Progreso';
import { Interruptor, Nota, PETROLEO } from './Piezas';

export default function FormularioProveedor({ emisorId, inicial = {}, onGuardado }) {
  const nuevo = !inicial.id;
  const [f, setF] = useState(() => proveedorAFormulario(inicial));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const { recuperado, descartar } = useBorrador(nuevo && !inicial.nit && emisorId ? `distribucion-proveedor-nuevo-${emisorId}` : null, f,
    { vale: (v) => !!(v?.nombre || v?.nit) });
  const repuesto = useRef(false);
  useEffect(() => {
    if (repuesto.current || !recuperado) return;
    repuesto.current = true;
    setF((x) => ({ ...x, ...recuperado }));
  }, [recuperado]);

  const { nit, nrc, plazo, errNit, errNrc, errPlazo, listo: valido } = leerFormularioDeProveedor(f);

  const guardar = () => Alert.alert(nuevo ? 'Registrar proveedor' : 'Guardar proveedor', f.nombre.trim(), [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Guardar', onPress: async () => {
      setGuardando(true); setError('');
      trabajando('Guardando el proveedor…');
      try {
        const id = await guardarProveedor({ ...f, id: inicial.id, emisor_id: emisorId, nit: nit || null, nrc: nrc || null, plazo_dias: plazo });
        anotar(nuevo ? 'DISTRIBUCION_PROVEEDOR_ALTA' : 'DISTRIBUCION_PROVEEDOR_EDICION', String(id),
          { nombre: f.nombre.trim(), nit: nit || null, relacionada: !!f.relacionada });
        descartar();
        listo(nuevo ? 'Proveedor registrado' : 'Proveedor guardado', f.nombre.trim());
        onGuardado?.(id);
      } catch (e) {
        const m = mensajeDeProveedor(e, mensajeDeDistribucion);
        setError(m); fallo('No se pudo guardar', m);
      } finally { setGuardando(false); }
    } },
  ]);

  return (
    <>
      {error ? <Nota tono="danger" texto={error} /> : null}
      <Seccion titulo="Proveedor">
        <CampoConRotulo rotulo="Nombre o razón social" requerido value={f.nombre} onChangeText={set('nombre')} />
        <CampoConRotulo rotulo="NIT (sin guiones)" value={f.nit} keyboardType="number-pad" onChangeText={set('nit')} error={errNit ? 'De 9 a 14 dígitos' : undefined} />
        <CampoConRotulo rotulo="NRC" value={f.nrc} keyboardType="number-pad" onChangeText={set('nrc')} error={errNrc ? 'De 2 a 8 dígitos' : undefined} />
        <CampoConRotulo rotulo="Teléfono" value={f.telefono ?? ''} keyboardType="phone-pad" onChangeText={set('telefono')} />
        <CampoConRotulo rotulo="Correo" value={f.correo ?? ''} keyboardType="email-address" autoCapitalize="none" onChangeText={set('correo')} />
        <CampoConRotulo rotulo="Plazo de pago (días)" value={f.plazo_dias} keyboardType="number-pad" onChangeText={set('plazo_dias')}
          error={errPlazo ? 'De 0 a 180 días' : undefined} />
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>0 = de contado. Llena solo el vencimiento de sus compras al crédito.</Text>
      </Seccion>
      <Seccion>
        <Interruptor rotulo="Es una empresa relacionada" ayuda="Del mismo grupo (por ejemplo, las farmacias). Se separa en los reportes."
          valor={!!f.relacionada} onCambiar={set('relacionada')} />
        <Interruptor rotulo="Es gran contribuyente" ayuda="Sus Créditos Fiscales pueden traer percepción del 1 %."
          valor={!!f.gran_contribuyente} onCambiar={set('gran_contribuyente')} />
      </Seccion>
      <BotonGrande texto="Guardar proveedor" color={PETROLEO} deshabilitado={!valido || guardando || !emisorId} onPress={guardar} />
    </>
  );
}
