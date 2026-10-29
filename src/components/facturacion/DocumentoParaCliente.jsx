import React, { useState } from 'react';
import { Download, Loader2, Mail, FileText } from 'lucide-react';
import Button from '../common/Button';
import PortalInput from '../common/PortalInput';
import { avisoDeEntregaDeDte, correoDeLaFichaDeLaVenta, correoDelClienteValido, entregarDteAlCliente } from '@nucleo/data/facturacion';

/* ─── El documento electrónico, para el cliente que lo pide (2026-10-19) ──────
   Directo, sin solicitud: el cliente está enfrente. Si la venta no tiene sello
   —el caso típico es el consumidor final de después de las 6:00 p. m., que no
   se envía a Hacienda por regla— el servidor lo manda en ese momento, y
   después entrega el PDF y el JSON. Puede tardar: el envío espera la respuesta
   de Hacienda. Ver `dte-para-cliente`.

   Vive en los dos lugares donde la sala mira una venta: el detalle de
   «Modificar facturación» y el de Ventas. Escrito una vez para que no
   diverjan. */
export default function DocumentoParaCliente({ inv }) {
  const [porCorreo, setPorCorreo] = useState(false);
  const [correo, setCorreo] = useState('');
  const [trabajando, setTrabajando] = useState(null);   // 'descargar' | 'correo'
  const [aviso, setAviso] = useState(null);             // { ok, texto }
  const correoOk = correoDelClienteValido(correo);

  // Al abrir el correo se propone el de la ficha del cliente, si tiene uno
  // válido; sólo si el campo sigue vacío, para no pisar lo que ya se escribió.
  const alternarCorreo = async () => {
    const abrir = !porCorreo;
    setPorCorreo(abrir);
    if (!abrir || correo.trim()) return;
    const deLaFicha = await correoDeLaFichaDeLaVenta(inv.id);
    if (deLaFicha) setCorreo(actual => (actual.trim() ? actual : deLaFicha));
  };

  const pedir = async (accion) => {
    setTrabajando(accion);
    setAviso(null);
    const r = await entregarDteAlCliente({ accion, invoiceId: inv.id, correo: accion === 'correo' ? correo.trim() : null });
    setTrabajando(null);
    if (!r.ok) { setAviso({ ok: false, texto: r.error }); return; }
    setAviso({ ok: true, texto: avisoDeEntregaDeDte({ accion, correo, seEnvio: r.se_envio }) });
    if (accion === 'correo') setPorCorreo(false);
  };

  return (
    <div data-surface="card" className="px-3 py-2 flex flex-col gap-2 shrink-0">
      <div className="flex items-center gap-2">
        <FileText size={14} className="text-content-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-label font-black text-content-2">Documento electrónico</p>
          <p className="text-micro text-content-3">PDF y JSON para el cliente</p>
        </div>
        <Button size="xs" variant="secondary" icon={Download} disabled={!!trabajando}
          onClick={() => pedir('descargar')}>
          {trabajando === 'descargar' ? 'Preparando…' : 'Descargar'}
        </Button>
        <Button size="xs" variant="secondary" icon={Mail} disabled={!!trabajando}
          aria-pressed={porCorreo} onClick={alternarCorreo}>
          Correo
        </Button>
      </div>
      {porCorreo && (
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <PortalInput label="Correo del cliente" type="email" value={correo}
              onChange={e => setCorreo(e.target.value)} placeholder="cliente@correo.com" />
          </div>
          <Button size="sm" icon={Mail} disabled={!correoOk || !!trabajando} onClick={() => pedir('correo')}>
            {trabajando === 'correo' ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      )}
      {trabajando && (
        <p className="text-micro text-content-3 flex items-center gap-1">
          <Loader2 size={10} className="animate-spin" aria-hidden="true" /> Puede tardar hasta un minuto si hay que enviarlo a Hacienda.
        </p>
      )}
      {aviso && (
        <p role="status" className={`text-label font-bold leading-snug ${aviso.ok ? 'text-success-text' : 'text-danger-text'}`}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
