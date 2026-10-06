// Crear o editar un cargo, NATIVO — el formulario de `RolesView`: nombre,
// ámbito (por sucursal o global), superior directo, superior matricial y
// límite de plazas. Las reglas de qué impide guardarlo (`errorDeCargo`) y de
// qué impide eliminarlo (`bloqueoParaEliminarCargo`) salen del núcleo, las
// mismas del portal; se guarda con `addRole` / `updateRole` / `deleteRole` del
// store, que anotan la bitácora.
//
// Los superiores se eligen de la TABLA de cargos (id + nombre de la fila),
// nunca de una lista escrita a mano. Un cargo no puede ser su propio superior.
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { AMBITOS_DE_CARGO, bloqueoParaEliminarCargo, errorDeCargo } from '@nucleo/utils/jerarquiaDeCargos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import ConAurora from '../ConAurora';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Opciones, Seccion } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { CampoConRotulo, Elegir, Rotulo } from '../personas/Formulario';
import { listo } from '../Progreso';

const vacio = { nombre: '', ambito: 'BRANCH', parentId: '', secundarioId: '', maxLimit: '99' };

/** `cargo`: el que se edita, o null para crear. `abierto`/`onCerrar` como un Modal. */
export default function EditorDeCargo({ abierto, cargo, onCerrar }) {
  const roles = useStaffStore((s) => s.roles);
  const empleados = useStaffStore((s) => s.employees);
  const addRole = useStaffStore((s) => s.addRole);
  const updateRole = useStaffStore((s) => s.updateRole);
  const deleteRole = useStaffStore((s) => s.deleteRole);
  const [f, setF] = useState(vacio);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setError('');
    setF(cargo ? {
      nombre: cargo.name || '', ambito: cargo.scope || 'BRANCH',
      parentId: cargo.parent_role_id ? String(cargo.parent_role_id) : '',
      secundarioId: cargo.secondary_parent_role_id ? String(cargo.secondary_parent_role_id) : '',
      maxLimit: String(cargo.max_limit ?? 99),
    } : vacio);
  }, [abierto, cargo]);

  const poner = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const otros = (roles || []).filter((r) => !cargo || r.id !== cargo.id).map((r) => ({ id: String(r.id), label: r.name }));

  const guardar = async () => {
    const falla = errorDeCargo({ nombre: f.nombre, parentId: f.parentId, secundarioId: f.secundarioId, maxLimit: f.maxLimit, editandoId: cargo?.id ?? null }, roles);
    if (falla) { setError(falla); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); return; }
    setGuardando(true);
    setError('');
    try {
      const args = [f.nombre.trim(), f.parentId ? Number(f.parentId) : null, f.secundarioId ? Number(f.secundarioId) : null, f.ambito, Number(f.maxLimit)];
      if (cargo) await updateRole(cargo.id, ...args);
      else await addRole(...args);
      listo(cargo ? 'Cargo actualizado' : 'Cargo creado', f.nombre.trim());
      onCerrar();
    } catch (e) {
      setError(mensajeAmigable(e, 'No se pudo guardar el cargo. Intenta de nuevo.'));
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = () => {
    const bloqueo = bloqueoParaEliminarCargo(cargo, roles, empleados);
    if (bloqueo) { Alert.alert(bloqueo.titulo, bloqueo.mensaje); return; }
    Alert.alert(`¿Eliminar «${cargo.name}»?`, 'El cargo desaparece del organigrama y de los permisos. No se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        setGuardando(true);
        try {
          await deleteRole(cargo.id, cargo.name);
          listo('Cargo eliminado', cargo.name);
          onCerrar();
        } catch (e) {
          setError(mensajeAmigable(e, 'No se pudo eliminar el cargo.'));
        } finally {
          setGuardando(false);
        }
      } },
    ]);
  };

  return (
    <Modal visible={abierto} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{cargo ? 'Editar cargo' : 'Nuevo cargo'}</Text>
            <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cancelar</Text>
            </Pressable>
          </View>
          {error ? <Aviso tono="freno" texto={error} /> : null}
          <Seccion titulo="El cargo">
            <CampoConRotulo rotulo="Nombre" requerido value={f.nombre} onChangeText={poner('nombre')} placeholder="Ej. Auxiliar de Farmacia" autoCapitalize="words" />
            <View style={{ gap: 8 }}>
              <Rotulo texto="Ámbito" />
              <Opciones valor={f.ambito} onCambiar={poner('ambito')} opciones={AMBITOS_DE_CARGO.map((a) => ({ id: a.value, label: a.label }))} />
            </View>
            <CampoConRotulo rotulo="Límite de plazas" requerido value={f.maxLimit} onChangeText={(v) => poner('maxLimit')(v.replace(/\D/g, ''))} keyboardType="number-pad" />
          </Seccion>
          <Seccion titulo="A quién reporta">
            <Elegir rotulo="Superior directo" valor={f.parentId} opciones={otros} vacio="Ninguno (nivel raíz)" onCambiar={poner('parentId')} />
            <Elegir rotulo="Superior matricial" valor={f.secundarioId} opciones={otros} vacio="Ninguno" onCambiar={poner('secundarioId')} />
          </Seccion>
          <BotonGrande texto={guardando ? 'Guardando…' : (cargo ? 'Guardar cambios' : 'Crear cargo')} onPress={guardar} deshabilitado={guardando} />
          {cargo ? <BotonGrande texto="Eliminar cargo" color={MARCA.rojo} borde onPress={eliminar} deshabilitado={guardando} /> : null}
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}
