/**
 * La pantalla del teléfono: tomar la foto y mandarla.
 *
 * ── Por qué no pide iniciar sesión ──────────────────────────────────────────
 *
 * Quien escanea el QR puede no tener el portal abierto en ese teléfono, y
 * pedirle usuario y contraseña con la cámara esperando mata justo la fluidez
 * que esto viene a dar. La llave es el código del QR: vive cinco minutos, sirve
 * una vez, y lo único que consigue quien lo robe es meter una imagen en un
 * formulario que una persona está mirando y todavía no guardó.
 *
 * ── Una pantalla, un botón ──────────────────────────────────────────────────
 *
 * Sin menú, sin barra lateral, sin nada que tocar por error. Quien llega acá
 * llegó a hacer una cosa. Y cada estado DICE lo que pasa: «comprobando»,
 * «tomá la foto», «mandando», «lista». Un botón que no acusa recibo en un
 * teléfono es indistinguible de uno roto.
 */
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { capturaVigente, mandarFoto } from '../data/capturaDeFoto';
import { PROPS_CAMARA } from '../utils/capturaDeFoto';
import Button from '../components/common/Button';

export default function CapturaDeFotoView() {
    const { secreto } = useParams();
    const [estado, setEstado] = useState('comprobando');   // comprobando · listo · mandando · hecho · error
    const [motivo, setMotivo] = useState('');
    const [para, setPara] = useState('');
    const [vista, setVista] = useState(null);

    useEffect(() => {
        let vivo = true;
        (async () => {
            const r = await capturaVigente(secreto);
            if (!vivo) return;
            if (!r?.ok) {
                setEstado('error');
                setMotivo('Este código ya se usó o venció. Pide uno nuevo en la computadora.');
                return;
            }
            setPara(r.para || '');
            setEstado('listo');
        })();
        return () => { vivo = false; };
    }, [secreto]);

    const tomar = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        // La vista previa se pinta ANTES de mandar: en una red lenta, esos
        // segundos sin nada en pantalla se leen como que no pasó nada.
        setVista(URL.createObjectURL(file));
        setEstado('mandando');
        const r = await mandarFoto(secreto, file);
        if (r.ok) { setEstado('hecho'); return; }
        setEstado('error');
        setMotivo(r.motivo);
    };

    return (
        <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-6 px-6 py-10
                        pt-[max(2.5rem,var(--sa-top))] pb-[max(2.5rem,var(--sa-bottom))]">
            <div className="text-center">
                <p className="text-caption font-black uppercase tracking-widest text-content-3">Foto para el expediente</p>
                {para && <p className="text-display-sm font-black text-content mt-1">{para}</p>}
            </div>

            {vista && (
                <img src={vista} alt="" className="w-40 h-40 rounded-3xl object-cover shadow-[var(--shadow-glass-3)]" />
            )}

            {estado === 'comprobando' && (
                <p className="text-body text-content-3 font-bold flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Comprobando el código…
                </p>
            )}

            {estado === 'listo' && (
                <>
                    <label htmlFor="captura-foto"
                        className="flex flex-col items-center justify-center gap-3 w-full max-w-xs
                                   min-h-[var(--tap-min)] py-8 rounded-3xl cursor-pointer
                                   bg-brand text-white font-black text-body-lg
                                   active:scale-[0.97] transition-transform">
                        <Camera size={32} strokeWidth={2.5} />
                        Tomar la foto
                    </label>
                    <input id="captura-foto" type="file" {...PROPS_CAMARA} className="hidden" onChange={tomar} />
                    <p className="text-caption text-content-3 font-medium text-center max-w-xs leading-snug">
                        Se va a ver sola en la computadora. Este código sirve una vez.
                    </p>
                </>
            )}

            {estado === 'mandando' && (
                <p className="text-body font-black text-brand-text flex items-center gap-2">
                    <Loader2 size={18} className="animate-spin" /> Mandando la foto…
                </p>
            )}

            {estado === 'hecho' && (
                <div className="flex flex-col items-center gap-2 text-center">
                    <CheckCircle2 size={40} className="text-success" strokeWidth={2.5} />
                    <p className="text-body-lg font-black text-content">Lista</p>
                    <p className="text-caption text-content-3 font-medium max-w-xs leading-snug">
                        Ya está en la computadora. Puedes cerrar esta pantalla.
                    </p>
                </div>
            )}

            {estado === 'error' && (
                <div className="flex flex-col items-center gap-3 text-center">
                    <AlertTriangle size={36} className="text-danger" strokeWidth={2.5} />
                    <p className="text-body font-bold text-danger-text max-w-xs leading-snug">{motivo}</p>
                    {/* Reintentar sólo tiene sentido si el código sigue vivo. Si
                        venció, el botón prometería algo que no puede cumplir. */}
                    {!/venció|usó/.test(motivo) && (
                        <Button variant="secondary" onClick={() => { setEstado('listo'); setVista(null); }}>
                            Intentar de nuevo
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
