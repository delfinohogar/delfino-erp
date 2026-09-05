-- ===========================================================================
-- crear_venta() — MIGRACIÓN REPETIBLE. Ésta es la definición vigente y la única que se edita.
--
-- Cierra R28. Hasta la migración 0006 esta función se copiaba entera en cada migración numerada
-- que la tocaba (0002:46, 0003:112, 0004:241) y había que mantener tres copias a mano. Desde acá
-- vive en un solo archivo: el migrador lo reaplica cuando cambia su hash, siempre después de las
-- numeradas (ver backend/README.md, "Migraciones repetibles").
--
-- El contenido de abajo es, carácter por carácter, la definición de
-- backend/db/migrations/0004_precios_y_costos.sql:241-408. TASK-018 MUDA, no refactoriza: no hay
-- un solo cambio de comportamiento. Si algo se comporta distinto, es un bug de la mudanza.
--
-- Las copias de 0002, 0003 y 0004 NO se borran ni se editan: son historia ya aplicada y
-- registrada en schema_migrations. Reconstruir la base desde cero sigue dando el mismo esquema,
-- porque las numeradas dejan la última versión histórica y esta repetible la reemplaza después
-- por la vigente, que hoy es idéntica.
--
-- La próxima tarea que toque crear_venta() (TASK-007, facturar_pedido) edita ESTE archivo. No
-- se vuelve a copiar el cuerpo en una migración numerada.
--
-- Qué NO cambiar sin leer primero:
--   - el orden de bloqueo de `stock` por (producto_id, deposito_id) ascendente, que es la
--     invariante ORDEN_DE_BLOQUEO;
--   - el redondeo: iva_total = round(SUM(iva_linea)) y neto_total = round(total - iva_total)
--     como RESIDUO. El centavo lo absorbe el neto, no el IVA (decisión Nivel 3 del 2026-09-04,
--     igual que js/ventas.js:412-413). No pasarlo a "neto por línea + suma";
--   - `coalesce(pg->>'destino_contable', 'caja')`: hay un riesgo abierto sobre ese default
--     (R23) y su cierre es de la tarea que construya el primer llamador, no de ésta.
-- ===========================================================================
create or replace function crear_venta(
  p_cliente_id bigint, p_vendedor text, p_fecha date,
  p_items jsonb, p_pagos jsonb, p_entrega text,
  p_idem text, p_fallar_en text default null
) returns bigint as $$
declare
  v_id bigint; v_numero bigint; a_id bigint; a_numero bigint;
  it jsonb; pg jsonb;
  v_fecha date;
  v_subtotal numeric(14,2) := 0; v_total numeric(14,2) := 0;
  v_pagado numeric(14,2) := 0; v_pendiente numeric(14,2) := 0; v_cmv numeric(14,2) := 0;
  v_iva_total numeric(14,2) := 0; v_neto_total numeric(14,2) := 0;
  v_debe_caja numeric(14,2) := 0; v_debe_tarjetas numeric(14,2) := 0;
  v_lineas jsonb := '[]'::jsonb;
  sub numeric(14,2); ali numeric(5,2); iva_l numeric(14,2);
  destino text;
  disp numeric(14,3); r_id bigint; vi_id bigint;
  prev jsonb;
begin
  -- DOBLE_ENVIO: si la clave ya existe, devolvemos la venta anterior sin crear nada.
  select resultado into prev from idempotency_keys where clave = p_idem;
  if found then return (prev->>'venta_id')::bigint; end if;

  v_fecha := coalesce(p_fecha, fecha_local());

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

  -- Un solo lugar donde se calcula cada línea: subtotal, alícuota e IVA quedan guardados en
  -- v_lineas y se reusan tal cual al insertar. Recalcularlos en el segundo loop sería una
  -- oportunidad de que las dos cuentas den distinto.
  for it in select * from jsonb_array_elements(p_items) loop
    sub := round((it->>'cantidad')::numeric * (it->>'precio_unitario')::numeric
                 * (1 - coalesce((it->>'descuento_pct')::numeric,0)/100), 2);
    ali := coalesce(
             (it->>'iva_pct')::numeric,
             (select p.iva from productos p where p.id = (it->>'producto_id')::bigint),
             21);
    iva_l := discriminar_iva(sub, ali);
    v_lineas := v_lineas || jsonb_build_object(
      'producto_id',   (it->>'producto_id')::bigint,
      'deposito_id',   (it->>'deposito_id')::bigint,
      'cantidad',      (it->>'cantidad')::numeric,
      'precio_unitario', (it->>'precio_unitario')::numeric,
      'costo_unitario',  coalesce((it->>'costo_unitario')::numeric,0),
      'descuento_pct',   coalesce((it->>'descuento_pct')::numeric,0),
      'subtotal',      sub,
      'iva_pct',       ali,
      'iva_monto',     iva_l,
      'lista_precio_id', (it->>'lista_precio_id')::bigint);   -- 0004: NULL si no vino
    v_subtotal  := v_subtotal + sub;
    v_iva_total := v_iva_total + iva_l;
    v_cmv := v_cmv + round((it->>'cantidad')::numeric * coalesce((it->>'costo_unitario')::numeric,0), 2);
  end loop;
  v_total := v_subtotal;

  -- iva_total: suma de los IVA por línea, redondeada. neto_total: RESIDUO. Ver el bloque de
  -- REDONDEO de 0003; no cambiar por "neto por línea + suma".
  v_iva_total  := round(v_iva_total, 2);
  v_neto_total := round(v_total - v_iva_total, 2);

  -- Los pagos, repartidos por destino contable. Cada peso cobrado tiene que terminar en la
  -- cuenta que dice dónde está realmente esa plata.
  for pg in select * from jsonb_array_elements(p_pagos) loop
    destino := coalesce(pg->>'destino_contable', 'caja');
    if destino not in ('caja','banco','cuentaPorCobrar') then
      raise exception 'DESTINO_PAGO: destino contable invalido "%"', destino;
    end if;
    v_pagado := v_pagado + (pg->>'monto')::numeric;
    if destino = 'cuentaPorCobrar'
      then v_debe_tarjetas := v_debe_tarjetas + (pg->>'monto')::numeric;
      else v_debe_caja     := v_debe_caja     + (pg->>'monto')::numeric;
    end if;
  end loop;
  v_pendiente := v_total - v_pagado;
  if v_pendiente < 0 then raise exception 'PAGOS_VENTA: los pagos (%) superan el total (%)', v_pagado, v_total; end if;

  v_numero := siguiente_numero('ventas');
  insert into ventas(numero,fecha_operacion,cliente_id,vendedor_uid,subtotal,iva_total,total,
                     monto_pendiente,tipo_entrega,idempotency_key)
    values (v_numero,v_fecha,p_cliente_id,p_vendedor,v_subtotal,v_iva_total,v_total,v_pendiente,
            case when p_entrega='inmediata' then 'Retira ahora' else 'Envio a domicilio' end, p_idem)
    returning id into v_id;

  for it in select * from jsonb_array_elements(v_lineas) loop
    insert into venta_items(venta_id,producto_id,cantidad,precio_unitario,costo_unitario,
                            descuento_pct,iva_pct,iva_monto,subtotal,lista_precio_id)
      values (v_id,(it->>'producto_id')::bigint,(it->>'cantidad')::numeric,
              (it->>'precio_unitario')::numeric,(it->>'costo_unitario')::numeric,
              (it->>'descuento_pct')::numeric,(it->>'iva_pct')::numeric,
              (it->>'iva_monto')::numeric,(it->>'subtotal')::numeric,
              (it->>'lista_precio_id')::bigint)                 -- 0004
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
    insert into venta_pagos(venta_id,medio_id,monto,destino_contable)
      values (v_id,(pg->>'medio_id')::bigint,(pg->>'monto')::numeric,
              coalesce(pg->>'destino_contable','caja'));
  end loop;

  if p_fallar_en = 'asiento' then raise exception 'FALLO_FORZADO en asiento'; end if;

  -- Asiento. Debe: 1.1.1 lo cobrado que ya está disponible, 1.1.5 lo cobrado que todavía no
  -- se acreditó, 1.1.2 lo que quedó a cuenta corriente. Haber: 4.1 el neto y 2.1.2 el IVA.
  -- El costo, como hasta ahora: 5.1 contra 1.1.3.
  a_numero := siguiente_numero('asientos');
  insert into asientos(numero,fecha_operacion,descripcion,origen_tipo,origen_id,usuario_uid)
    values (a_numero,v_fecha,'Venta '||v_numero,'venta',v_id,p_vendedor) returning id into a_id;
  if v_debe_caja > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'1.1.1',v_debe_caja,0);
  end if;
  if v_debe_tarjetas > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'1.1.5',v_debe_tarjetas,0);
  end if;
  if v_pendiente > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'1.1.2',v_pendiente,0);
  end if;
  if v_neto_total <> 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'4.1',0,v_neto_total);
  end if;
  if v_iva_total > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'2.1.2',0,v_iva_total);
  end if;
  if v_cmv > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'5.1',v_cmv,0);
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'1.1.3',0,v_cmv);
  end if;

  insert into idempotency_keys(clave,operacion,resultado)
    values (p_idem,'crear_venta',jsonb_build_object('venta_id',v_id,'numero',v_numero));

  return v_id;
end $$ language plpgsql;
