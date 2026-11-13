import React, { useEffect, useState } from 'react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import CampoMesAnio from '../../components/common/CampoMesAnio';
import CampoLote from '../../components/caja/CampoLote';
import { fetchLotesConocidosDeProducto } from '@nucleo/data/traslados';
import {
    choqueDeLote, loteDeCajaParaEnviar, motivoDeLoteDeCaja,
    motivoDeVenceDeCaja, venceDeCajaParaEnviar,
} from '@nucleo/utils/loteDeCaja';
import { hoySV } from '@nucleo/utils/fecha';

const mesAnio = (v) => { const [a, m] = String(v).split('-'); return `${m}/${a}`; };

/**
 * El lote y el vencimiento que trae la caja, para lo que sale sin lote
 * asignado (2026-11-05). Mismo campo que el de las inyecciones: al entrar se
 * despliegan los lotes ya registrados del producto en todas las salas, y
 * elegir uno llena también el vencimiento.
 *
 * El valor es `{ lote, vence: 'AAAA-MM', nuevo?, envio }`. `envio` lo pone este
 * componente: `{ lote, vence: 'AAAA-MM-DD' }` cuando lo escrito se puede
 * mandar, `null` mientras no. Quien lo usa sólo mira `envio`.
 *
 * Un número ya registrado con OTRO vencimiento no tiene «es otro lote»: el
 * sistema crearía un segundo lote con el mismo número. Ver `utils/loteDeCaja`.
 *
 * `soloVence` (2026-11-13): un perecedero sin control de lote. No hay número
 * que copiar, sólo la fecha; `envio` sale `{ lote: '', vence }`.
 */
export default function LoteDeLaCaja({ erpProductId, producto, valor, onChange, soloVence = false }) {
    const [conocidos, setConocidos] = useState([]);
    useEffect(() => {
        if (soloVence) return undefined;
        let vivo = true;
        fetchLotesConocidosDeProducto(erpProductId).then((l) => { if (vivo) setConocidos(l); });
        return () => { vivo = false; };
    }, [erpProductId, soloVence]);

    const motivo = soloVence ? motivoDeVenceDeCaja(valor) : motivoDeLoteDeCaja(valor, conocidos);
    const envio = motivo ? null
        : soloVence ? venceDeCajaParaEnviar(valor) : loteDeCajaParaEnviar(valor, conocidos);
    const choque = soloVence ? null : choqueDeLote(valor, conocidos);
    const tocado = Boolean(valor?.lote || valor?.vence);

    // `envio` viaja en el valor para que la pantalla que despacha no tenga que
    // conocer la lista de lotes registrados ni repetir la regla.
    const envioLote = envio ? envio.lote : null;
    const envioVence = envio?.vence ?? null;
    useEffect(() => {
        if ((valor?.envio?.lote ?? null) !== envioLote || (valor?.envio?.vence ?? null) !== envioVence)
            onChange({ ...valor, envio: envioVence ? { lote: envioLote, vence: envioVence } : null });
    }, [envioLote, envioVence, valor, onChange]);

    const usar = (c) => onChange({ lote: c.lote, vence: c.vence, envio: valor?.envio ?? null });

    if (soloVence) {
        return (
            <div className="flex flex-col gap-1.5">
                <div className="sm:max-w-[50%]">
                    <CampoMesAnio
                        label={`Vencimiento de ${producto}`} placeholder="MM/AAAA"
                        value={valor?.vence ?? ''} desde={hoySV().slice(0, 7)}
                        onChange={(vence) => onChange({ ...valor, lote: '', vence })}
                    />
                </div>
                {motivo && (
                    <p className={`text-caption ${tocado ? 'text-warning-text' : 'text-content-3'}`}>{motivo}</p>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <CampoLote
                    label="Lote de la caja" ariaLabel={`Lote de ${producto}`}
                    value={valor?.lote ?? ''} conocidos={conocidos}
                    onChange={(lote) => {
                        const c = conocidos.find((k) => k.lote === lote);
                        onChange({ ...valor, lote, nuevo: false, ...(c && !valor?.vence ? { vence: c.vence } : {}) });
                    }}
                    onElegir={usar}
                />
                <CampoMesAnio
                    label={`Vencimiento de ${producto}`} placeholder="MM/AAAA"
                    value={valor?.vence ?? ''} desde={hoySV().slice(0, 7)}
                    onChange={(vence) => onChange({ ...valor, vence, nuevo: false })}
                />
            </div>
            {choque ? (
                <Notice variant="warning">
                    <span className="block">
                        {choque.mismoNumero
                            ? <>El lote <b>{choque.lote}</b> ya está registrado con vencimiento <b>{mesAnio(choque.vence)}</b>. Un lote tiene un solo vencimiento: revisa la caja.</>
                            : <>¿Es el lote <b>{choque.lote}</b> · {mesAnio(choque.vence)}? Se parece al que escribiste.</>}
                    </span>
                    <span className="flex flex-wrap gap-2 mt-2">
                        <Button size="sm" variant="primary" onClick={() => usar(choque)}>
                            Usar {choque.lote} · {mesAnio(choque.vence)}
                        </Button>
                        {!choque.mismoNumero && (
                            <Button size="sm" variant="secondary" onClick={() => onChange({ ...valor, nuevo: true })}>
                                No, es otro lote
                            </Button>
                        )}
                    </span>
                </Notice>
            ) : motivo && (
                <p className={`text-caption ${tocado ? 'text-warning-text' : 'text-content-3'}`}>{motivo}</p>
            )}
        </div>
    );
}
