import React, { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import Notice from '../../components/common/Notice';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fetchPuntosDelCambioDeCliente } from '@nucleo/data/puntos';

/**
 * Qué pasa con los puntos de una venta cuando cambia de cliente (2026-10-01).
 *
 * Pedido del usuario: «debe aparecer en la solicitud eso, que se descontarán
 * los puntos y se acumularán a la otra persona». Antes de aprobar se le
 * pregunta a la base con la MISMA función que hace el traspaso, en modo
 * consulta, así que lo que dice este recuadro es lo que va a pasar. Después de
 * aprobar se muestra lo que pasó, que la aprobación dejó en
 * `metadata.erp_aplicado.puntos`.
 *
 * Si la consulta falla no se muestra nada: un recuadro de puntos que no se
 * pudo calcular no puede frenar ni confundir una solicitud de facturación.
 */
const pts = (n) => formatQty(Number(n) || 0);

export default function PuntosDelCambio({ invoiceId, customerNuevo, aplicado }) {
    const [vista, setVista] = useState(null);

    useEffect(() => {
        if (aplicado || !invoiceId || !customerNuevo) return undefined;
        let vivo = true;
        fetchPuntosDelCambioDeCliente(invoiceId, customerNuevo)
            .then((v) => { if (vivo) setVista(v); })
            .catch((e) => console.warn('[PuntosDelCambio]', e?.message ?? e));
        return () => { vivo = false; };
    }, [invoiceId, customerNuevo, aplicado]);

    if (aplicado) {
        const a = aplicado;
        if (!a.hay_puntos) return null;
        if (a.ya_es_suyo) {
            return <Notice variant="info" icon={Star}>Los {pts(a.puntos)} puntos de esta venta ya eran de {a.a_nombre}.</Notice>;
        }
        return (
            <Notice variant={a.no_recuperados > 0 ? 'warning' : 'success'} icon={Star}>
                Puntos: se le quitaron {pts(a.se_quitaron)} a {a.de_nombre}
                {a.recibio > 0 ? ` y ${a.a_nombre} recibió ${pts(a.recibio)}.` : `. ${a.a_nombre} no acumula puntos, así que no recibió nada.`}
                {a.de_otras_compras > 0 && ` ${pts(a.de_otras_compras)} salieron de sus otros puntos porque ya había usado los de esta compra.`}
                {a.no_recuperados > 0 && ` ${pts(a.no_recuperados)} ya los había gastado y no se pudieron recuperar.`}
            </Notice>
        );
    }

    if (!vista || !vista.hay_puntos) return null;
    if (vista.ya_es_suyo) return null;

    return (
        <Notice variant={vista.ya_gastados > 0 ? 'warning' : 'info'} icon={Star}>
            Esta venta le dio {pts(vista.puntos)} puntos a {vista.de_nombre}. Al aprobar
            {vista.se_quitan > 0 ? `, se le quitan ${pts(vista.se_quitan)}` : ', no se le puede quitar ninguno'}
            {vista.recibe > 0
                ? ` y ${vista.a_nombre} recibe ${pts(vista.recibe)}.`
                : `. ${vista.a_nombre} no acumula puntos, así que no recibe nada.`}
            {vista.de_otras_compras > 0 && ` ${pts(vista.de_otras_compras)} saldrían de sus otros puntos porque ya usó los de esta compra.`}
            {vista.ya_gastados > 0 && ` ${pts(vista.ya_gastados)} ya los gastó: no se le pueden quitar.`}
        </Notice>
    );
}
