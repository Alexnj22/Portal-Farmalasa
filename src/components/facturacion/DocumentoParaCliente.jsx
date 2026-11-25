import React, { useState } from 'react';
import { Download, Mail, FileText } from 'lucide-react';
import Button from '../common/Button';
import PortalInput from '../common/PortalInput';
import {
  avisoDeEntregaDeDte, correoDeLaFichaDeLaVenta, correoDelClienteValido, entregarDteAlCliente,
  PASO_DE_SOLVENTACION, solventarHastaElFinal, solventarVenta,
} from '@nucleo/data/facturacion';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { LoadingState } from '../common/StateViews';

/* ─── El documento electrónico, para el cliente que lo pide (2026-10-19) ──────
   Directo, sin solicitud: el cliente está enfrente. Si la venta no tiene sello
   —el caso típico es el consumidor final de después de las 6:00 p. m., que no
   se envía a Hacienda por regla— el servidor lo manda en ese momento, y
   después entrega el PDF y el JSON. Puede tardar: el envío espera la respuesta
   de Hacienda. Ver `dte-para-cliente`.

   Vive en los dos lugares donde la sala mira una venta: el detalle de
   «Modificar facturación» y el de Ventas. Escrito una vez para que no
   diverjan.

   Venta sin sello de un mes ya declarado (2026-11-25): no se manda al MH (el
   servidor contesta `MES_CERRADO`). Se ofrece solventarla: una venta nueva de
   hoy con los mismos productos y el mismo total, y el documento sale de ésa.
   Ver `solventar-venta`. */
export default function DocumentoParaCliente({ inv }) {
  // La venta de la que sale el documento: la misma, o la nueva si se solventó.
  const [idDoc, setIdDoc] = useState(inv.id);
  const [solv, setSolv] = useState(null);               // { plan } | { paso } | { listo }
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
    const deLaFicha = await correoDeLaFichaDeLaVenta(idDoc);
    if (deLaFicha) setCorreo(actual => (actual.trim() ? actual : deLaFicha));
  };

  const pedir = async (accion) => {
    setTrabajando(accion);
    setAviso(null);
    const r = await entregarDteAlCliente({ accion, invoiceId: idDoc, correo: accion === 'correo' ? correo.trim() : null });
    setTrabajando(null);
    if (!r.ok && r.codigo === 'MES_CERRADO') {
      setAviso({ ok: false, texto: r.error });
      const plan = await solventarVenta({ accion: 'revisar', invoiceId: inv.id });
      setSolv(plan.ok ? { plan: plan.plan } : { error: plan.error });
      return;
    }
    if (!r.ok) { setAviso({ ok: false, texto: r.error }); return; }
    setAviso({ ok: true, texto: avisoDeEntregaDeDte({ accion, correo, seEnvio: r.se_envio }) });
    if (accion === 'correo') setPorCorreo(false);
  };

  const solventar = async () => {
    setSolv(s => ({ ...s, paso: PASO_DE_SOLVENTACION.nueva, error: null }));
    setAviso(null);
    const r = await solventarHastaElFinal(inv.id, estado => setSolv(s => ({ ...s, paso: PASO_DE_SOLVENTACION[estado] ?? 'Trabajando…' })));
    if (!r.ok) { setSolv(s => ({ ...s, paso: null, error: r.error })); return; }
    setIdDoc(r.nueva_invoice_id);
    setSolv({ listo: true });
    setAviso({ ok: true, texto: 'Listo. La venta nueva ya tiene su documento. Descárgalo o mándalo por correo.' });
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
        <LoadingState variant="inline" label="Puede tardar hasta un minuto si hay que enviarlo al MH." />
      )}
      {solv && !solv.listo && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2">
          {solv.plan && (
            <p className="text-label text-content-2 leading-snug">
              Se hace una venta nueva de hoy: {solv.plan.lineas.length} producto{solv.plan.lineas.length === 1 ? '' : 's'},
              {' '}{formatMoney(solv.plan.total)}, {solv.plan.pago === 'contado' ? 'al contado (con su vale)' : `con ${solv.plan.pago}`}.
              {' '}Los productos vuelven a la existencia antes de venderlos.
            </p>
          )}
          {solv.paso ? (
            <LoadingState variant="inline" label={solv.paso} />
          ) : solv.plan && (
            <Button size="sm" onClick={solventar}>Solventar con venta nueva</Button>
          )}
          {solv.error && <p role="alert" className="text-label font-bold text-danger-text leading-snug">{solv.error}</p>}
        </div>
      )}
      {aviso && (
        <p role="status" className={`text-label font-bold leading-snug ${aviso.ok ? 'text-success-text' : 'text-danger-text'}`}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
