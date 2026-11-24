import { useCallback, useEffect, useRef, useState } from 'react';
import * as almacen from '@plataforma/almacen';
import { fetchMisVistas, marcarVistas } from '../data/novedades';

/**
 * Las novedades que ya vio una persona (2026-11-17).
 *
 * La verdad está en la base (`novedades_vistas`): así sigue a la persona en
 * cualquier dispositivo. Pedido del usuario: «así si entra en otro dispositivo
 * sepa cuál vio y cuál no».
 *
 * Antes se guardaba en el navegador. Lo que ese navegador ya tenía se sube una
 * vez al cargar y después se borra de ahí, para que nadie pierda lo que revisó.
 *
 * `vistas` es `null` mientras carga. Si la base no responde queda vacío y la
 * pantalla funciona igual (a lo sumo vuelve a mostrar algo como nuevo).
 */
const VACIO = new Set();
const LEGADO_REVISADAS = (empId) => `novedades-revisadas:${empId || 'anon'}`;
const LEGADO_ENTRADA = /^novedades-entrada:([^:]+):(.+)$/;

function leerLegado(empId) {
    const claves = [];
    const borrar = [];
    try {
        const lista = JSON.parse(almacen.leer(LEGADO_REVISADAS(empId)) || '[]');
        if (Array.isArray(lista) && lista.length) { claves.push(...lista); borrar.push(LEGADO_REVISADAS(empId)); }
    } catch { /* sin legado legible */ }
    try {
        for (const k of almacen.claves()) {
            const m = LEGADO_ENTRADA.exec(k);
            if (m && m[2] === String(empId) && almacen.leer(k) === '1') { claves.push(`entrada:${m[1]}`); borrar.push(k); }
        }
    } catch { /* sin legado legible */ }
    return { claves, borrar };
}

export default function useNovedadesVistas(empId) {
    // Ligado al empleado: si cambia, vuelve a «cargando» sin un setState en el efecto.
    const [estado, setEstado] = useState(/** @type {{ emp: any, set: any, leido?: boolean }} */ ({ emp: null, set: null }));
    const vistas = !empId ? VACIO : estado.emp === empId ? estado.set : null;
    const vivo = useRef(true);

    useEffect(() => {
        vivo.current = true;
        if (!empId) return () => { vivo.current = false; };
        (async () => {
            // Un tropiezo de red (pasó un 521 el 2026-11-19) no puede leerse como
            // «no vio nada»: se reintenta una vez y, si sigue fallando, `leido`
            // queda en false para que la pantalla de entrada no salga.
            let enBase = new Set();
            let leido = false;
            for (let intento = 0; intento < 2 && !leido; intento++) {
                if (intento) await new Promise((r) => setTimeout(r, 1500));
                try { enBase = await fetchMisVistas(empId); leido = true; } catch { /* reintenta */ }
                if (!vivo.current) return;
            }
            const { claves, borrar } = leerLegado(empId);
            const faltan = claves.filter((c) => !enBase.has(c));
            let subido = true;
            if (faltan.length) {
                try { await marcarVistas(faltan); } catch { subido = false; }
            }
            // Lo del navegador cuenta igual en pantalla; sólo se borra de ahí
            // cuando ya quedó en la base (si no, se reintenta la próxima vez).
            claves.forEach((c) => enBase.add(c));
            if (subido) borrar.forEach((k) => { try { almacen.borrar(k); } catch { /* nada */ } });
            if (vivo.current) setEstado({ emp: empId, set: enBase, leido });
        })();
        return () => { vivo.current = false; };
    }, [empId]);

    const marcar = useCallback((claves) => {
        const lista = (Array.isArray(claves) ? claves : [claves]).filter(Boolean);
        setEstado((prev) => {
            const base = prev.set ?? new Set();
            if (lista.every((c) => base.has(c))) return prev;
            const sig = new Set(base);
            lista.forEach((c) => sig.add(c));
            return { ...prev, set: sig };
        });
        marcarVistas(lista).catch(() => { /* queda marcada en pantalla; se vuelve a intentar al abrirla */ });
    }, []);

    // `leido`: la base respondió. Sin eso, `vistas` es sólo lo que se sabe localmente.
    const leido = !empId || (estado.emp === empId && estado.leido === true);
    return { vistas, marcar, leido };
}
