import { useCallback, useEffect, useId, useState } from 'react';
import { supabase } from '../supabaseClient';
import { fetchBannerPortal } from '../data/bannerPortal';

/**
 * El estado de la franja de aviso del portal, en vivo.
 *
 * Escucha la tabla por Realtime a propósito: la franja se enciende «cuando hace
 * falta», y sin el canal eso significaría «cuando cada uno vuelva a entrar» —
 * o sea, horas después, que es justo lo que la vuelve inútil. Es una tabla de
 * una fila que cambia casi nunca, así que el canal no cuesta nada.
 *
 * Un error de lectura devuelve la franja APAGADA y no rompe nada: si la base no
 * contesta, lo último que hay que hacer es pintar una barra de color encima de
 * un portal que ya está en problemas.
 */
export function useBannerPortal() {
    const id = useId();
    const [banner, setBanner] = useState(null);
    const [cargando, setCargando] = useState(true);

    const recargar = useCallback(async () => {
        const { data, error } = await fetchBannerPortal();
        setBanner(error ? null : (data ?? null));
        setCargando(false);
        return { data, error };
    }, []);

    useEffect(() => {
        let vivo = true;
        (async () => { const r = await recargar(); if (!vivo) return r; })();

        // El nombre del canal lleva el id de ESTA instancia. Dos suscripciones
        // con el mismo nombre son un solo canal para supabase-js, así que la
        // segunda no recibe nada: medido en pruebas el 2026-08-21, encender la
        // franja desde Mantenimiento no la hacía aparecer arriba —había que
        // recargar— porque esa pantalla y el banner del layout compartían
        // topic y el banner era el que se quedaba sordo.
        const ch = supabase
            .channel(`banner-portal-${id}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'banner_portal' },
                () => { if (vivo) recargar(); })
            .subscribe();

        return () => { vivo = false; supabase.removeChannel(ch); };
    }, [recargar, id]);

    return { banner, cargando, recargar };
}
