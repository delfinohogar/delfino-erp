-- Delfino ERP — 0004: lista de precios en la venta e historial de costos
--
-- Cambios 3 y 4 de ARCHITECTURE §2.3:
--   3. `venta_items` con referencia OPCIONAL a la lista de precios usada          (P3)
--   4. Historial de costos con origen, compra relacionada y motivo, inmutable      (P5)
--
-- Las migraciones ya aplicadas no se editan: 0001, 0002 y 0003 quedan como están y acá se
-- agrega con CREATE TABLE, ALTER TABLE y CREATE OR REPLACE FUNCTION.
--
-- ===========================================================================
-- LO MÁS IMPORTANTE DE ESTE ARCHIVO, DICHO ANTES QUE NADA:
-- ESTA MIGRACIÓN NO CONTIENE NINGÚN `update productos ... costo_referencia`.
-- No es un olvido. Es P5.
--
-- `js/compras.js → crearCompra()` (líneas 103-119) hoy hace, dentro de la misma transacción
-- que suma el stock:
--     costoNuevo = (costoModo === 'promedio' && stockAnterior > 0)
--                    ? (stockAnterior*costoAnterior + cantidad*costoNetoUnitario) / stockNuevo
--                    : costoNetoUnitario;
--     tx.update(productoRef, { costoReferencia: costoNuevo, costoUltimo: ... });
-- o sea: **cada compra pisa el costo maestro sola, sin que nadie lo acepte**, y recién después
-- deja la fila en `productos/{id}/historialCostos`.
--
-- P5 decide lo contrario y P5 gana:
--   - COSTO DE COMPRA (el de la factura) y COSTO MAESTRO (el que el ERP usa para precios y
--     márgenes) son dos cosas separadas;
--   - una factura puede registrar un costo distinto SIN modificar el maestro;
--   - el maestro cambia solo por modificación manual de un usuario autorizado o por
--     ACEPTACIÓN EXPLÍCITA de una propuesta. Nunca en silencio.
--
-- Consecuencia directa para el que lea esto buscando el bug: si comparás con `js/compras.js`
-- vas a ver que "falta" el UPDATE del costo. No falta. Sobra allá, y por eso no está acá.
--
-- Lo que sí queda: `registrar_costo()`, que escribe la fila de historial y deja el maestro
-- exactamente como estaba. La aceptación explícita (que sí mueve el maestro, y que para
-- `costo_modo='promedio'` necesita las cantidades de la compra para ponderar) pertenece al
-- servicio de compras, que está FUERA DE ALCANCE de la PoC según ARCHITECTURE §2.3. No se
-- inventa acá una fórmula de ponderación que nadie decidió.
--
-- Nota de nombres: donde TASK-003 dice `productos.costo`, el esquema dice
-- `productos.costo_referencia` — la columna que creó 0001, con el mismo nombre que
-- `costoReferencia` en el ERP. Es el costo maestro. No se renombra nada.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Listas de precios (P3)
--
-- P3: "La PoC NO reimplementa listas de precios. El modelo queda preparado para determinar
-- precios por lista, cliente o sucursal sin migración destructiva". Entonces esta tabla se
-- crea, pero NADA en el esquema calcula un precio a partir de ella: el precio sigue saliendo
-- de `producto.precio_venta` y de lo que el vendedor escriba en la línea, igual que hoy.
--
-- `regla_margen` y `regla_redondeo` quedan NULLABLES y sin CHECK de dominio a propósito: qué
-- valores admiten (margen sobre costo o sobre precio, redondeo a decena/centena/terminación 9)
-- es una regla comercial que Gastón todavía no definió. Ponerle acá un CHECK con valores
-- inventados sería decidirlo por él, y después habría que migrarlo. `numeric` y `text` guardan
-- lo que la decisión diga cuando exista.
-- ---------------------------------------------------------------------------
create table listas_precios (
  id bigserial primary key,
  nombre text not null unique,
  regla_margen numeric(9,4),
  regla_redondeo text,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. La venta guarda qué lista usó — o ninguna
--
-- NULLABLE y sin default a propósito: hoy la venta no usa listas, y una venta sin lista tiene
-- que seguir funcionando exactamente igual que antes de esta migración. Eso ES el
-- comportamiento de P3, no una carencia. Un NOT NULL o un default apuntando a una lista
-- "general" romperían P3 y obligarían a inventar una lista para poder vender.
--
-- Va en `venta_items` y no en `ventas` porque el precio se determina por línea: dos líneas de
-- la misma venta pueden venir de listas distintas (una en promoción, otra no). Es también
-- coherente con P4: la línea congela todo lo necesario para reconstruir el resultado.
-- ---------------------------------------------------------------------------
alter table venta_items
  add column lista_precio_id bigint references listas_precios(id);

create index on venta_items (lista_precio_id) where lista_precio_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Historial de costos (P5)
--
-- Campos exactamente los que pide P5: producto, costo anterior, costo nuevo, fecha/hora,
-- usuario, origen (manual | factura_compra), compra relacionada, método de costeo y motivo.
--
-- Dos fechas, por P8: `fecha_operacion` es el día comercial al que pertenece el registro y
-- `creado_en` el instante real en que se escribió, que es dato de auditoría.
--
-- `compra_id` es NULLABLE y NO tiene FK: la tabla `compras` no existe en la PoC (ARCHITECTURE
-- §2.3, "Fuera de alcance: compras"). Cuando exista, agregarle la FK es un ALTER TABLE de una
-- línea, no una migración destructiva. El CHECK deja claro mientras tanto que un cambio
-- `manual` no puede colgar de una factura.
--
-- `costo_anterior` y `costo_nuevo` pueden ser iguales: registrar que una compra llegó al mismo
-- costo que el maestro también es información. (El ERP actual, en cambio, ni siquiera escribe
-- la fila si el costo no cambió — `js/compras.js:135`.)
-- ---------------------------------------------------------------------------
create table historial_costos (
  id bigserial primary key,
  producto_id bigint not null references productos(id),
  costo_anterior numeric(14,2) not null check (costo_anterior >= 0),
  costo_nuevo    numeric(14,2) not null check (costo_nuevo    >= 0),
  fecha_operacion date not null default fecha_local(),
  usuario_uid text not null,
  origen text not null check (origen in ('manual','factura_compra')),
  compra_id bigint,
  metodo_costeo text not null check (metodo_costeo in ('ultimo','promedio')),
  motivo text not null,
  creado_en timestamptz not null default now(),
  constraint compra_solo_si_viene_de_factura
    check (origen = 'factura_compra' or compra_id is null)
);

create index on historial_costos (producto_id, creado_en desc);

-- ---------------------------------------------------------------------------
-- 4. El historial es inmutable, y lo es EN LA BASE
--
-- Mismo criterio que `firestore.rules:73-77`, donde la subcolección `historialCostos` ya tiene
-- `allow update, delete: if false`, y mismo espíritu que `asiento_balanceado_trg`: la regla no
-- se cumple porque nadie la viola, se cumple porque la base la rechaza.
--
-- BEFORE, no AFTER: la fila no llega a modificarse ni por un instante.
-- El trigger de TRUNCATE tapa la vía por la que se borra una tabla entera sin pasar por DELETE.
-- (DROP TABLE no lo cubre ningún trigger; para eso están los permisos, que no son de esta capa.
-- `recrearEsquema()` de los tests usa DROP SCHEMA y sigue funcionando, que es lo buscado.)
-- ---------------------------------------------------------------------------
create or replace function historial_costos_inmutable() returns trigger as $$
begin
  raise exception
    'HISTORIAL_COSTOS_INMUTABLE: el historial de costos no se modifica ni se borra (intento de % sobre la fila %)',
    tg_op, old.id
    using errcode = 'restrict_violation';
  return null;
end $$ language plpgsql;

create trigger historial_costos_sin_update
  before update on historial_costos
  for each row execute function historial_costos_inmutable();

create trigger historial_costos_sin_delete
  before delete on historial_costos
  for each row execute function historial_costos_inmutable();

create or replace function historial_costos_sin_truncate_fn() returns trigger as $$
begin
  raise exception 'HISTORIAL_COSTOS_INMUTABLE: el historial de costos no se trunca'
    using errcode = 'restrict_violation';
  return null;
end $$ language plpgsql;

create trigger historial_costos_sin_truncate
  before truncate on historial_costos
  for each statement execute function historial_costos_sin_truncate_fn();

-- ---------------------------------------------------------------------------
-- 5. registrar_costo(): deja constancia SIN tocar el maestro
--
-- Este es el camino por el que una factura de compra registra el costo que realmente pagó.
-- Toma `costo_anterior` y `metodo_costeo` del producto en el momento del registro y escribe la
-- fila. NO hay `update productos` en el cuerpo: ese es todo el punto de P5.
--
-- Después de llamarla, `productos.costo_referencia` vale exactamente lo mismo que antes. Si el
-- usuario autorizado decide aceptar el costo nuevo, eso es OTRA operación, explícita, que
-- todavía no existe en la PoC (ver la cabecera del archivo).
--
-- `p_origen` no se valida acá con un IF: lo valida el CHECK de la tabla, que es la barrera que
-- también atrapa a quien inserte directo sin pasar por esta función.
-- ---------------------------------------------------------------------------
create or replace function registrar_costo(
  p_producto_id bigint,
  p_costo_nuevo numeric,
  p_usuario text,
  p_origen text,
  p_motivo text,
  p_compra_id bigint default null,
  p_fecha date default null
) returns bigint as $$
declare v_anterior numeric(14,2); v_modo text; v_id bigint;
begin
  select costo_referencia, costo_modo into v_anterior, v_modo
    from productos where id = p_producto_id;
  if not found then
    raise exception 'No existe el producto %', p_producto_id;
  end if;

  insert into historial_costos(producto_id, costo_anterior, costo_nuevo, fecha_operacion,
                               usuario_uid, origen, compra_id, metodo_costeo, motivo)
    values (p_producto_id, v_anterior, round(p_costo_nuevo, 2),
            coalesce(p_fecha, fecha_local()), p_usuario, p_origen, p_compra_id, v_modo, p_motivo)
    returning id into v_id;

  -- P5: el costo maestro queda como estaba. Acá NO va un UPDATE de productos.
  return v_id;
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 6. Verificación independiente de "el esquema no recalcula el costo maestro solo"
--
-- La ausencia de un trigger no se puede probar mirando el mismo lugar donde no está. Esta
-- función pregunta al catálogo de PostgreSQL —otra vía— si EXISTE alguna función del esquema
-- público que escriba `productos.costo_referencia`, o algún trigger sobre `productos`.
-- Vacío = ninguna operación puede mover el maestro sola. Cualquier fila = alguien lo reintrodujo.
--
-- Cuando llegue la aceptación explícita de P5 (una función que SÍ mueve el maestro, a pedido de
-- un usuario), va a aparecer acá y habrá que excluirla POR NOMBRE en esa misma tarea. Que
-- excluirla cueste una línea visible en una migración es deliberado: la excepción se ve.
-- ---------------------------------------------------------------------------
create or replace function verificar_sin_recalculo_de_costo()
returns table(objeto text, tipo text) as $$
  select p.proname::text, 'funcion'::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~* 'update\s+productos'
     and p.prosrc ~* 'costo_referencia'
  union all
  select t.tgname::text, 'trigger'::text
    from pg_trigger t
   where t.tgrelid = 'productos'::regclass
     and not t.tgisinternal;
$$ language sql stable;

-- ---------------------------------------------------------------------------
-- 7. crear_venta(): idéntica a la de 0003, más la lista de precios opcional
--
-- Se vuelve a declarar completa porque 0003 ya está aplicada y registrada en
-- `schema_migrations`: editarla rompería el registro. Lo ÚNICO que cambia respecto de 0003 son
-- tres líneas marcadas con «0004»: leer `lista_precio_id` del ítem, llevarlo en `v_lineas` e
-- insertarlo en `venta_items`. El IVA, el destino contable, la fecha local, el redondeo con el
-- neto como residuo y el orden de bloqueo quedan exactamente como estaban.
--
-- `lista_precio_id` es opcional en el JSON del ítem: si no viene, `->>` da NULL y la venta se
-- registra sin lista, que es el comportamiento de P3 y el de todas las ventas de hoy.
-- ---------------------------------------------------------------------------
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
