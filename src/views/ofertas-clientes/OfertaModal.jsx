import React, { useState } from 'react';
import { Tag, Info } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import FileField from '../../components/common/FileField';
import Switch from '../../components/common/Switch';
import { hoySV, fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { guardarOferta, subirImagen } from '@nucleo/data/ofertasClientes';
import { etiquetaDeDescuento } from '@nucleo/utils/ofertasClientes';

/**
 * Crear o editar una oferta de la app.
 *
 * Dos clases de oferta, y la diferencia importa:
 *  · **Suelta** — la escribe quien la publica: fechas, salas, todo.
 *  · **De un descuento de la caja** (`oferta.descuento_erp_id`) — las fechas,
 *    las salas y los productos con su precio SIGUEN al descuento: los pone al
 *    día `descuentos-erp` cada vez que el descuento cambia. Por eso acá no se
 *    editan: un campo editable que después se pisa solo es un campo que miente.
 *    Lo que sí se escribe es lo que el cliente lee: título, texto, imagen.
 */
export default function OfertaModal({ oferta, salas, onClose, onGuardada, onError }) {
    const nueva = !oferta.id;
    const deDescuento = !!oferta.descuento_erp_id;
    const [f, setF] = useState({
        titulo: oferta.titulo ?? '', etiqueta: oferta.etiqueta ?? '', descripcion: oferta.descripcion ?? '',
        condiciones: oferta.condiciones ?? '', inicio: oferta.inicio ?? hoySV(), fin: oferta.fin ?? '',
        exclusiva: oferta.exclusiva ?? false, branch_ids: oferta.branch_ids ?? [], publicada: oferta.publicada ?? false,
    });
    const [archivo, setArchivo] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
    const alternarSala = (id) => setF((x) => ({
        ...x, branch_ids: x.branch_ids.includes(id) ? x.branch_ids.filter((b) => b !== id) : [...x.branch_ids, id],
    }));
    const productos = Array.isArray(oferta.productos) ? oferta.productos : [];

    const valido = f.titulo.trim().length >= 3 && f.inicio && f.fin && f.fin >= f.inicio
        && (!deDescuento || productos.length > 0);

    const guardar = async () => {
        setGuardando(true);
        try {
            const imagen_path = archivo ? await subirImagen(archivo) : oferta.imagen_path ?? null;
            await guardarOferta(oferta.id, {
                titulo: f.titulo.trim(), etiqueta: f.etiqueta.trim() || null, descripcion: f.descripcion.trim() || null,
                condiciones: f.condiciones.trim() || null, exclusiva: f.exclusiva, publicada: f.publicada, imagen_path,
                ...(deDescuento ? {
                    // La foto tal cual vino del descuento: fechas y salas incluidas.
                    descuento_erp_id: oferta.descuento_erp_id, promocion_id: oferta.promocion_id ?? null,
                    descuento_tipo: oferta.descuento_tipo, descuento_monto: oferta.descuento_monto,
                    productos, foto_at: oferta.foto_at ?? null,
                    inicio: oferta.inicio, fin: oferta.fin, branch_ids: oferta.branch_ids ?? null,
                } : {
                    inicio: f.inicio, fin: f.fin, branch_ids: f.branch_ids.length ? f.branch_ids : null,
                }),
            });
            onGuardada();
        } catch (err) {
            onError(err);
        } finally {
            setGuardando(false);
        }
    };

    const nombreSala = (id) => salas.find((s) => Number(s.id) === Number(id))?.name;

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel={nueva ? 'Nueva oferta' : 'Editar oferta'}>
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">
                    {deDescuento ? 'Oferta en la app' : nueva ? 'Nueva oferta' : 'Editar oferta'}
                </h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    {deDescuento && (
                        <Notice variant="info" icon={Info}>
                            Sale del descuento <span className="font-semibold">{etiquetaDeDescuento(oferta.descuento_tipo, oferta.descuento_monto)}</span>.
                            Las fechas, las salas y los precios siguen al descuento solos: si lo corriges o lo borras, la app se entera.
                        </Notice>
                    )}
                    {deDescuento && oferta.sin_receta > 0 && (
                        <Notice variant="warning">
                            {oferta.sin_receta === 1 ? 'Un producto bajo receta no se muestra' : `${oferta.sin_receta} productos bajo receta no se muestran`} en la app.
                            El descuento sigue valiendo en caja.
                        </Notice>
                    )}
                    {deDescuento && productos.length === 0 && (
                        <Notice variant="warning">Todos los productos de este descuento van bajo receta: no hay nada que anunciar.</Notice>
                    )}
                    <PortalInput label="Título" name="titulo" value={f.titulo} maxLength={80}
                        onChange={(e) => cambiar('titulo')(e.target.value)} placeholder="Ej. 20% en vitaminas" />
                    <PortalInput label="Etiqueta (opcional)" name="etiqueta" value={f.etiqueta} maxLength={16}
                        onChange={(e) => cambiar('etiqueta')(e.target.value)} placeholder="Ej. −20% · 2×1" />
                    <PortalTextarea label="Descripción" name="descripcion" rows={3} value={f.descripcion} maxLength={600}
                        onChange={(e) => cambiar('descripcion')(e.target.value)} />
                    <PortalTextarea label="Condiciones (opcional)" name="condiciones" rows={2} value={f.condiciones} maxLength={400}
                        onChange={(e) => cambiar('condiciones')(e.target.value)} placeholder="Ej. Hasta agotar existencias. No acumulable." />
                    {deDescuento ? (
                        <div className="rounded-lg bg-surface-card-hover p-3 space-y-2">
                            <p className="text-body-sm text-content-2">
                                Del {fechaTexto(oferta.inicio, { day: 'numeric', month: 'short' })} al {fechaTexto(oferta.fin, { day: 'numeric', month: 'short' })}
                                {' · '}{oferta.branch_ids?.length ? oferta.branch_ids.map(nombreSala).filter(Boolean).join(', ') : 'Todas las salas'}
                            </p>
                            <ul className="space-y-1 max-h-48 overflow-y-auto">
                                {productos.map((p) => (
                                    <li key={p.id} className="flex items-baseline justify-between gap-3 text-body-sm">
                                        <span className="text-content truncate">{p.nombre}</span>
                                        {p.precio != null && (
                                            <span className="tabular-nums shrink-0">
                                                <span className="text-content-3 line-through mr-2">{formatMoney(p.precio)}</span>
                                                <span className="font-semibold text-content">{formatMoney(p.precio_descuento)}</span>
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <span className="block text-label font-semibold text-content-2 mb-1">Desde</span>
                                    <LiquidDatePicker value={f.inicio} onChange={cambiar('inicio')} />
                                </div>
                                <div>
                                    <span className="block text-label font-semibold text-content-2 mb-1">Hasta</span>
                                    <LiquidDatePicker value={f.fin} onChange={cambiar('fin')} />
                                </div>
                            </div>
                            {f.fin && f.inicio && f.fin < f.inicio && <Notice variant="warning">La fecha final es anterior a la inicial.</Notice>}
                        </>
                    )}
                    <FileField label="Imagen (opcional)" accept="image/jpeg,image/png,image/webp" file={archivo} onChange={setArchivo}
                        hint={oferta.imagen_path && !archivo ? 'Ya tiene imagen; sube otra para reemplazarla' : 'Horizontal, 16:9, hasta 3 MB'} />
                    {!deDescuento && (
                        <div>
                            <span className="block text-label font-semibold text-content-2 mb-1">Salas</span>
                            <p className="text-micro text-content-3 mb-2">Sin marcar ninguna, vale en todas.</p>
                            <div className="flex flex-wrap gap-2">
                                {salas.map((s) => (
                                    <Button key={s.id} size="sm" variant={f.branch_ids.includes(s.id) ? 'primary' : 'secondary'}
                                        onClick={() => alternarSala(s.id)}>{s.name}</Button>
                                ))}
                            </div>
                        </div>
                    )}
                    <label className="flex items-center justify-between gap-3">
                        <span>
                            <span className="block text-body-sm font-semibold text-content">Exclusiva para socios</span>
                            <span className="block text-micro text-content-3">Los demás ven el título y una invitación a unirse.</span>
                        </span>
                        <Switch checked={f.exclusiva} onChange={cambiar('exclusiva')} label="Exclusiva para socios" />
                    </label>
                    <label className="flex items-center justify-between gap-3">
                        <span>
                            <span className="block text-body-sm font-semibold text-content">Publicada</span>
                            <span className="block text-micro text-content-3">Se ve en la app entre sus fechas.</span>
                        </span>
                        <Switch checked={f.publicada} onChange={cambiar('publicada')} label="Publicada" />
                    </label>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={Tag} loading={guardando} disabled={!valido} onClick={guardar}>Guardar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
