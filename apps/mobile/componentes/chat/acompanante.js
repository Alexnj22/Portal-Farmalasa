// Un botón flotante de una pantalla que viaja PEGADO a la burbuja del chat
// (2026-11-17, el usuario en el conteo: «que funcionen como pegados en esta
// pantalla, al mover uno se muevan los dos para despejar la pantalla»).
//
// La pantalla no dibuja su propio botón flotante: lo declara aquí y
// `BurbujaFlotante` lo pinta encima de la burbuja, del mismo tamaño y dentro
// del mismo arrastre. Sin permiso de chat, la burbuja dibuja sólo éste (y se
// sigue pudiendo mover).
//
// Se declara con `useBotonFlotante` mientras la pantalla tiene el foco: una
// pantalla que queda debajo en la pila no deja su botón encima de otra.
import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { create } from 'zustand';

export const useAcompanante = create(() => ({ boton: null }));

/**
 * @param {{ icono: string, etiqueta: string, onPress: () => void } | null} boton  null = sin botón
 */
export function useBotonFlotante(boton) {
  const alTocar = useRef(boton?.onPress);
  alTocar.current = boton?.onPress;
  const icono = boton?.icono ?? null;
  const etiqueta = boton?.etiqueta ?? null;
  useFocusEffect(useCallback(() => {
    if (!icono) return undefined;
    const propio = { icono, etiqueta, onPress: () => alTocar.current?.() };
    useAcompanante.setState({ boton: propio });
    return () => {
      if (useAcompanante.getState().boton === propio) useAcompanante.setState({ boton: null });
    };
  }, [icono, etiqueta]));
}
