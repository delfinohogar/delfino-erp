-- Delfino ERP — 0002: movimientos de stock y servicio de venta
-- movimientos_stock quedó fuera de 0001 por omisión; se agrega acá.

create table movimientos_stock (
  id bigserial primary key,
  producto_id bigint not null references productos(id),
  deposito_id bigint not null references depositos(id),
  delta       numeric(14,3) not null,
  motivo      text not null check (motivo in ('venta','entrega','compra','ajuste','devolucion')),
  origen_tipo text, origen_id bigint,
  usuario_uid text not null,
  creado_en   timestamptz not null default now()
);
create index on movimientos_stock (producto_id, deposito_id);

create table idempotency_keys (
  clave text primary key,
  operacion text not null,
  resultado jsonb,
  creado_en timestamptz not null default now()
);

-- Contadores. Se incrementan DENTRO de la misma transacción de la venta, a diferencia
-- del código actual que usa una transacción aparte solo para el contador.
create table contadores (nombre text primary key, ultimo bigint not null default 0);
insert into contadores(nombre,ultimo) values ('ventas',0),('asientos',0),('entregas',0),('pedidos',0);

create or replace function siguiente_numero(p_nombre text) returns bigint as $$
declare n bigint;
begin
  update contadores set ultimo = ultimo + 1 where nombre = p_nombre returning ultimo into n;
  if n is null then raise exception 'No existe el contador %', p_nombre; end if;
  return n;
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- crear_venta: TODO en una sola transacción.
--   venta → items → pagos → stock (o reserva) → movimientos → asiento → movimientos contables
-- p_items: [{"producto_id":1,"deposito_id":1,"cantidad":2,"precio_unitario":100,
--            "costo_unitario":60,"descuento_pct":0}]
-- p_pagos: [{"medio_id":1,"monto":150}]
-- p_entrega: 'inmediata' (descuenta físico) | 'pendiente' (crea reserva)
-- p_fallar_en: solo para tests — 'asiento' | 'pagos' | null. Fuerza un error en ese punto
--              para poder probar FALLO_INTERMEDIO sin tocar la lógica real.
-- ---------------------------------------------------------------------------
create or replace function crear_venta(
  p_cliente_id bigint, p_vendedor text, p_fecha date,
  p_items jsonb, p_pagos jsonb, p_entrega text,
  p_idem text, p_fallar_en text default null
) returns bigint as $$
declare
  v_id bigint; v_numero bigint; a_id bigint; a_numero bigint;
  it jsonb; pg jsonb;
  v_subtotal numeric(14,2) := 0; v_total numeric(14,2) := 0;
  v_pagado numeric(14,2) := 0; v_pendiente numeric(14,2) := 0; v_cmv numeric(14,2) := 0;
  sub numeric(14,2); disp numeric(14,3); r_id bigint; vi_id bigint;
  prev jsonb;
begin
  -- DOBLE_ENVIO: si la clave ya existe, devolvemos la venta anterior sin crear nada.
  select resultado into prev from idempotency_keys where clave = p_idem;
  if found then return (prev->>'venta_id')::bigint; end if;

  -- Orden de bloqueo obligatorio: stock por (producto_id, deposito_id) ascendente.
  perform 1 from stock s
    where (s.producto_id, s.deposito_id) in (
      select (i->>'producto_id')::bigint, (i->>'deposito_id')::bigint
      from jsonb_array_elements(p_items) i)
    order by s.producto_id, s.deposito_id
    for update;

  -- Disponibilidad antes de escribir nada.
  for it in select * from jsonb_array_elements(p_items) loop
    select disponible into disp from stock
      where producto_id=(it->>'producto_id')::bigint and deposito_id=(it->>'deposito_id')::bigint;
    if disp is null then raise exception 'Sin stock para producto % en deposito %',
      it->>'producto_id', it->>'deposito_id'; end if;
    if disp < (it->>'cantidad')::numeric then
      raise exception 'STOCK_INSUFICIENTE: producto % disponible % pedido %',
        it->>'producto_id', disp, it->>'cantidad';
    end if;
  end loop;

  for it in select * from jsonb_array_elements(p_items) loop
    sub := round((it->>'cantidad')::numeric * (it->>'precio_unitario')::numeric
                 * (1 - coalesce((it->>'descuento_pct')::numeric,0)/100), 2);
    v_subtotal := v_subtotal + sub;
    v_cmv := v_cmv + round((it->>'cantidad')::numeric * coalesce((it->>'costo_unitario')::numeric,0), 2);
  end loop;
  v_total := v_subtotal;

  for pg in select * from jsonb_array_elements(p_pagos) loop
    v_pagado := v_pagado + (pg->>'monto')::numeric;
  end loop;
  v_pendiente := v_total - v_pagado;
  if v_pendiente < 0 then raise exception 'PAGOS_VENTA: los pagos (%) superan el total (%)', v_pagado, v_total; end if;

  v_numero := siguiente_numero('ventas');
  insert into ventas(numero,fecha_operacion,cliente_id,vendedor_uid,subtotal,total,monto_pendiente,
                     tipo_entrega,idempotency_key)
    values (v_numero,p_fecha,p_cliente_id,p_vendedor,v_subtotal,v_total,v_pendiente,
            case when p_entrega='inmediata' then 'Retira ahora' else 'Envio a domicilio' end, p_idem)
    returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    sub := round((it->>'cantidad')::numeric * (it->>'precio_unitario')::numeric
                 * (1 - coalesce((it->>'descuento_pct')::numeric,0)/100), 2);
    insert into venta_items(venta_id,producto_id,cantidad,precio_unitario,costo_unitario,descuento_pct,subtotal)
      values (v_id,(it->>'producto_id')::bigint,(it->>'cantidad')::numeric,
              (it->>'precio_unitario')::numeric, coalesce((it->>'costo_unitario')::numeric,0),
              coalesce((it->>'descuento_pct')::numeric,0), sub)
      returning id into vi_id;

    if p_entrega = 'inmediata' then
      update stock set fisico = fisico - (it->>'cantidad')::numeric
        where producto_id=(it->>'producto_id')::bigint and deposito_id=(it->>'deposito_id')::bigint;
      insert into movimientos_stock(producto_id,deposito_id,delta,motivo,origen_tipo,origen_id,usuario_uid)
        values ((it->>'producto_id')::bigint,(it->>'deposito_id')::bigint,
                -(it->>'cantidad')::numeric,'venta','venta',v_id,p_vendedor);
    else
      insert into reservas(producto_id,deposito_id,cantidad,origen_tipo,venta_id,usuario_uid)
        values ((it->>'producto_id')::bigint,(it->>'deposito_id')::bigint,
                (it->>'cantidad')::numeric,'venta',v_id,p_vendedor)
        returning id into r_id;
      update stock set reservado = reservado + (it->>'cantidad')::numeric
        where producto_id=(it->>'producto_id')::bigint and deposito_id=(it->>'deposito_id')::bigint;
    end if;
  end loop;

  if p_fallar_en = 'pagos' then raise exception 'FALLO_FORZADO en pagos'; end if;

  for pg in select * from jsonb_array_elements(p_pagos) loop
    insert into venta_pagos(venta_id,medio_id,monto)
      values (v_id,(pg->>'medio_id')::bigint,(pg->>'monto')::numeric);
  end loop;

  if p_fallar_en = 'asiento' then raise exception 'FALLO_FORZADO en asiento'; end if;

  a_numero := siguiente_numero('asientos');
  insert into asientos(numero,fecha_operacion,descripcion,origen_tipo,origen_id,usuario_uid)
    values (a_numero,p_fecha,'Venta '||v_numero,'venta',v_id,p_vendedor) returning id into a_id;
  if v_pagado > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'1.1.1',v_pagado,0);
  end if;
  if v_pendiente > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'1.1.2',v_pendiente,0);
  end if;
  insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'4.1',0,v_total);
  if v_cmv > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'5.1',v_cmv,0);
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'1.1.3',0,v_cmv);
  end if;

  insert into idempotency_keys(clave,operacion,resultado)
    values (p_idem,'crear_venta',jsonb_build_object('venta_id',v_id,'numero',v_numero));

  return v_id;
end $$ language plpgsql;
