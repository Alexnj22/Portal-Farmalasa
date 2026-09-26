import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env.staging', 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { data: s, error: el } = await sb.auth.signInWithPassword({ email: 'pruebas@farmalasa.app', password: 'pruebas2026' });
if (el) throw el;
const yo = (await sb.rpc('auth_employee_id')).data;
const { data: emisor } = await sb.from('dist_emisores').select('id').single();
const { data: clientes } = await sb.from('dist_clientes').select('id, nombre, tipo').order('id');
const { data: cat } = await sb.from('dist_catalogo').select('product_id, venta_libre, precio_sin_iva').eq('venta_libre', true).limit(3);
const facturar = async (cliente, extra = {}) => {
  const { data: p, error } = await sb.from('dist_pedidos').insert({ emisor_id: emisor.id, cliente_id: cliente.id, vendedor_id: yo, client_uuid: crypto.randomUUID(), ...extra }).select('id').single();
  if (error) return { cliente: cliente.nombre, error: error.message };
  const { error: ei } = await sb.from('dist_pedido_items').insert(cat.map((c, i) => ({ pedido_id: p.id, product_id: c.product_id, cantidad: 12 * (i + 1), precio_sin_iva: 999, descripcion: '' })));
  if (ei) return { cliente: cliente.nombre, error: ei.message };
  const { data, error: ef } = await sb.functions.invoke('distribucion-dte', { body: { accion: 'facturar', pedido_id: p.id } });
  let cuerpo = data; if (ef) { try { cuerpo = await ef.context.json(); } catch { cuerpo = ef.message; } }
  return { cliente: cliente.nombre, pedido: p.id, respuesta: cuerpo };
};
const out = [];
out.push(await facturar(clientes.find(c => c.tipo === 'tienda')));
out.push(await facturar(clientes.find(c => c.tipo === 'farmacia'), { condicion: 2, plazo_dias: 30 }));
out.push(await facturar(clientes.find(c => c.tipo === 'supermercado')));
console.log(JSON.stringify(out, null, 1));
const { data: dtes } = await sb.from('dist_dte').select('tipo, numero_control, total_pagar, estado, json->resumen->totalPagar, json->resumen->ivaRete').order('id');
console.log(dtes);
