import React, { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import Notice from '../../components/common/Notice';
import { avisoDeCambioDeCliente } from '@nucleo/utils/puntosTexto';
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
// El texto sale del núcleo (`avisoDeCambioDeCliente`): la app dice lo mismo.
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

    const aviso = avisoDeCambioDeCliente({ vista, aplicado });
    if (!aviso) return null;
    return <Notice variant={aviso.tono} icon={Star}>{aviso.texto}</Notice>;
}
