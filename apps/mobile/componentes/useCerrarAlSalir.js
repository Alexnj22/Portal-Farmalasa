// Una hoja (ModalBottomSheet de Android) se dibuja por encima de TODO, no
// dentro de su pantalla: si la app navega a otra mientras está abierta (un
// aviso que se toca, un enlace), la hoja se quedaba flotando sobre la pantalla
// nueva (visto el 2026-11-14 con la hoja de filtros sobre la baja). Este hook
// la cierra cuando su pantalla deja de estar enfocada. Sólo escucha `blur`: el
// cierre normal no lo dispara, así que `onCerrar` no corre dos veces.
import { useEffect, useRef } from 'react';
import { useNavigation } from 'expo-router';

export default function useCerrarAlSalir(onCerrar) {
  const navigation = useNavigation();
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;
  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    return navigation.addListener('blur', () => cerrar.current?.());
  }, [navigation]);
}
