import React, { useState } from 'react';
import { User, Lock, LogIn, Loader2, ArrowLeftRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import PortalInput from '../../components/common/PortalInput';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { useAuth } from '@nucleo/context/AuthContext';
import { useMarca } from '../../plataforma/useMarca';
import { MARCA_DISTRIBUIDORA } from './marca';

// La entrada de la distribuidora. Mismas cuentas que el portal —«las mismas
// cuentas, por permiso», decisión del usuario del 2026-09-28—, así que el login
// es el mismo `loginWithUsername`; lo que cambia es la marca y adónde lleva.
//
// Sin carné ni kiosco a propósito: son de las salas. Y el cambio obligado de
// contraseña (cuenta nueva) se hace en el portal, que ya tiene ese flujo
// completo con sus reglas: acá se avisa y se manda allá, en vez de escribir
// un segundo formulario que un día diga otra cosa.

export default function TorogozLoginView() {
    useMarca('distribucion');
    const { loginWithUsername } = useAuth();
    const [usuario, setUsuario] = useState('');
    const [clave, setClave] = useState('');
    const [entrando, setEntrando] = useState(false);
    const [error, setError] = useState('');
    const [cambiarClave, setCambiarClave] = useState(false);

    const entrar = async (e) => {
        e?.preventDefault();
        if (!usuario.trim() || !clave) { setError('Escribe tu usuario y tu contraseña.'); return; }
        setEntrando(true);
        setError('');
        try {
            const r = await loginWithUsername(usuario, clave);
            if (!r.ok) { setError(r.error || 'Usuario o contraseña incorrectos.'); setClave(''); }
            else if (r.mustChangePassword) setCambiarClave(true);
            // Si entró, la ruta cambia sola a la distribuidora (App.jsx).
        } catch {
            setError('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
        } finally {
            setEntrando(false);
        }
    };

    return (
        <div className="relative min-h-[100dvh] w-full flex items-center justify-center p-4 pt-[max(1rem,var(--sa-top))] pb-[max(1rem,var(--sa-bottom))]">
            <form onSubmit={entrar} data-surface="card" className="w-full max-w-sm p-6 md:p-8 flex flex-col gap-5">
                <div className="flex flex-col items-center gap-3 text-center">
                    <img src={MARCA_DISTRIBUIDORA.icono} alt={MARCA_DISTRIBUIDORA.nombre} className="w-16 h-16 rounded-2xl" />
                    <div>
                        <h1 className="text-display font-black text-content leading-tight">{MARCA_DISTRIBUIDORA.nombre}</h1>
                        <p className="text-caption font-black text-brand-text uppercase tracking-[0.25em]">{MARCA_DISTRIBUIDORA.bajada}</p>
                    </div>
                </div>
                {cambiarClave ? (
                    <Notice variant="info" bloque>
                        Es tu primera entrada: tienes que elegir una contraseña nueva. Hazlo una vez en el portal y vuelve aquí.
                        <div className="mt-3"><Link to="/login" className="font-bold text-brand-text underline">Ir al portal</Link></div>
                    </Notice>
                ) : (
                    <>
                        <PortalInput icon={User} name="usuario" label="Usuario" value={usuario} autoComplete="username"
                            autoCapitalize="none" onChange={(e) => setUsuario(e.target.value)} />
                        <PortalInput icon={Lock} name="clave" label="Contraseña" type="password" value={clave} autoComplete="current-password"
                            onChange={(e) => setClave(e.target.value)} />
                        {error && <Notice variant="danger" compact>{error}</Notice>}
                        <Button type="submit" variant="primary" icon={entrando ? Loader2 : LogIn} disabled={entrando}>
                            Entrar
                        </Button>
                        <p className="text-caption text-content-3 text-center">Con el mismo usuario del portal.</p>
                    </>
                )}
                <Link to="/login" className="flex items-center justify-center gap-2 text-caption text-content-3 hover:text-content-2 min-h-[var(--tap-min)]">
                    <ArrowLeftRight size={14} /> Portal de las farmacias
                </Link>
            </form>
        </div>
    );
}
