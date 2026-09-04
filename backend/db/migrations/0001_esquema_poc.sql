-- Delfino ERP — esquema de la PoC (alcance B)
-- Validado empíricamente contra PostgreSQL 16.15 el 2026-09-03: 8 pruebas del asiento
-- balanceado, 18 de constraints, 2 de concurrencia de stock, 2 de deadlock y 4 de la
-- carrera FACTURAR vs. MODIFICAR. Ver PRUEBAS-ESQUEMA.md.
-- NO es esquema aprobado: falta la verificación del Director y del Auditor.

create table clientes (
  id bigserial primary key,
  razon_social text not null,
  cuit text unique,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create table depositos (id bigserial primary key, nombre text not null);
create table productos (
  id bigserial primary key,
  sku text not null unique,
  descripcion text not null,
  costo_referencia numeric(14,2) not null default 0 check (costo_referencia >= 0),
  costo_modo text not null default 'ultimo' check (costo_modo in ('ultimo','promedio')),
  precio_venta numeric(14,2) not null default 0 check (precio_venta >= 0)
);
create table medios_pago (id bigserial primary key, nombre text not null unique, activo boolean not null default true);
create table cuentas_contables (
  codigo text primary key, nombre text not null,
  tipo text not null check (tipo in ('activo','pasivo','patrimonio','ingreso','egreso')),
  padre text references cuentas_contables(codigo), imputable boolean not null default true
);

create table stock (
  producto_id bigint not null references productos(id),
  deposito_id bigint not null references depositos(id),
  fisico     numeric(14,3) not null default 0,
  reservado  numeric(14,3) not null default 0,
  disponible numeric(14,3) generated always as (fisico - reservado) stored,
  primary key (producto_id, deposito_id),
  constraint fisico_no_negativo    check (fisico >= 0),
  constraint reservado_no_negativo check (reservado >= 0),
  constraint reservado_no_supera_fisico check (reservado <= fisico)
);

create table pedidos (
  id bigserial primary key,
  numero bigint not null unique,
  fecha_operacion date not null,
  valido_hasta date,
  cliente_id bigint not null references clientes(id),
  vendedor_uid text not null,
  estado text not null default 'confirmado' check (estado in ('confirmado','facturado','cancelado')),
  venta_id bigint,
  idempotency_key text not null unique,
  creado_en timestamptz not null default now(),
  cerrado_en timestamptz,
  constraint facturado_tiene_venta check (
    (estado = 'facturado' and venta_id is not null) or (estado <> 'facturado' and venta_id is null)),
  constraint una_venta_por_pedido unique (venta_id)
);

create table pedido_items (
  id bigserial primary key,
  pedido_id bigint not null references pedidos(id) on delete restrict,
  producto_id bigint not null references productos(id),
  deposito_id bigint not null references depositos(id),
  cantidad numeric(14,3) not null check (cantidad > 0),
  precio_unitario numeric(14,2) not null check (precio_unitario >= 0),
  descuento_pct numeric(5,2) not null default 0,
  quitado_en timestamptz, quitado_por text,
  creado_en timestamptz not null default now()
);
create index on pedido_items (pedido_id) where quitado_en is null;

create table ventas (
  id bigserial primary key,
  numero bigint not null unique,
  fecha_operacion date not null,
  cliente_id bigint references clientes(id),
  vendedor_uid text not null,
  pedido_id bigint references pedidos(id),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  descuento_global numeric(5,2) not null default 0,
  iva_total numeric(14,2) not null default 0,
  total numeric(14,2) not null check (total >= 0),
  monto_pendiente numeric(14,2) not null default 0,
  tipo_entrega text not null default 'Retira ahora',
  idempotency_key text not null unique,
  creado_en timestamptz not null default now(),
  constraint pendiente_en_rango check (monto_pendiente >= 0 and monto_pendiente <= total),
  constraint pendiente_exige_cliente check (monto_pendiente = 0 or cliente_id is not null)
);
alter table pedidos add constraint pedidos_venta_fk foreign key (venta_id) references ventas(id);

create table venta_items (
  id bigserial primary key,
  venta_id bigint not null references ventas(id) on delete restrict,
  producto_id bigint not null references productos(id),
  cantidad numeric(14,3) not null check (cantidad > 0),
  precio_unitario numeric(14,2) not null check (precio_unitario >= 0),
  costo_unitario numeric(14,2) not null default 0,
  descuento_pct numeric(5,2) not null default 0,
  iva_pct numeric(5,2) not null default 0,
  iva_monto numeric(14,2) not null default 0,
  subtotal numeric(14,2) not null
);

create table venta_pagos (
  id bigserial primary key,
  venta_id bigint not null references ventas(id) on delete restrict,
  medio_id bigint not null references medios_pago(id),
  monto numeric(14,2) not null check (monto > 0)
);

create table reservas (
  id bigserial primary key,
  producto_id bigint not null references productos(id),
  deposito_id bigint not null references depositos(id),
  cantidad           numeric(14,3) not null check (cantidad > 0),
  cantidad_consumida numeric(14,3) not null default 0 check (cantidad_consumida >= 0),
  cantidad_liberada  numeric(14,3) not null default 0 check (cantidad_liberada  >= 0),
  cantidad_pendiente numeric(14,3) generated always as (cantidad - cantidad_consumida - cantidad_liberada) stored,
  origen_tipo text not null check (origen_tipo in ('pedido','venta')),
  pedido_id bigint references pedidos(id),
  pedido_item_id bigint references pedido_items(id),
  venta_id bigint references ventas(id),
  usuario_uid text not null,
  creado_en timestamptz not null default now(),
  cerrado_en timestamptz, motivo_cierre text,
  constraint no_excede check (cantidad_consumida + cantidad_liberada <= cantidad),
  constraint origen_coherente check (
    (origen_tipo = 'pedido' and pedido_id is not null) or (origen_tipo = 'venta' and venta_id is not null)),
  constraint origen_pedido_tiene_linea check (origen_tipo <> 'pedido' or pedido_item_id is not null),
  constraint cierre_coherente check (
    (cantidad_consumida + cantidad_liberada <  cantidad and cerrado_en is null) or
    (cantidad_consumida + cantidad_liberada =  cantidad and cerrado_en is not null))
);
create index on reservas (producto_id, deposito_id) where cantidad_pendiente > 0;

create table entregas (
  id bigserial primary key, numero bigint not null unique,
  venta_id bigint not null references ventas(id),
  fecha_operacion date not null, usuario_uid text not null,
  idempotency_key text not null unique,
  creado_en timestamptz not null default now()
);
create table entrega_items (
  id bigserial primary key,
  entrega_id bigint not null references entregas(id) on delete restrict,
  venta_item_id bigint not null references venta_items(id),
  reserva_id bigint not null references reservas(id),
  cantidad numeric(14,3) not null check (cantidad > 0)
);

create table asientos (
  id bigserial primary key, numero bigint not null unique,
  fecha_operacion date not null, descripcion text not null,
  origen_tipo text not null, origen_id bigint, usuario_uid text not null,
  creado_en timestamptz not null default now()
);
create table asiento_movimientos (
  id bigserial primary key,
  asiento_id bigint not null references asientos(id) on delete restrict,
  cuenta text not null references cuentas_contables(codigo),
  debe  numeric(14,2) not null default 0 check (debe  >= 0),
  haber numeric(14,2) not null default 0 check (haber >= 0),
  constraint no_debe_y_haber check (debe = 0 or haber = 0)
);

create or replace function asiento_balanceado() returns trigger as $$
declare d numeric(14,2); h numeric(14,2); aid bigint;
begin
  aid := coalesce(new.asiento_id, old.asiento_id);
  select coalesce(sum(debe),0), coalesce(sum(haber),0) into d, h
    from asiento_movimientos where asiento_id = aid;
  if d <> h then
    raise exception 'Asiento % no balanceado: debe % vs haber %', aid, d, h;
  end if;
  return null;
end $$ language plpgsql;

create constraint trigger asiento_balanceado_trg
  after insert or update or delete on asiento_movimientos
  deferrable initially deferred
  for each row execute function asiento_balanceado();

create view pedidos_vencidos as
  select p.*, (current_date - p.valido_hasta) as dias_vencido
  from pedidos p
  where p.estado='confirmado' and p.valido_hasta is not null and p.valido_hasta < current_date;

-- ---------------------------------------------------------------------------
-- Guarda: un pedido facturado o cancelado no se puede modificar.
-- Descubierto empíricamente: el SELECT ... FOR UPDATE sobre `pedidos` serializa
-- FACTURAR y MODIFICAR, pero NO impide que la modificación se aplique sobre un
-- pedido que quedó facturado mientras esperaba el lock. Sin este trigger, el
-- resultado es una venta por 3 unidades con solo 1 unidad reservada.
-- ---------------------------------------------------------------------------
create or replace function pedido_editable() returns trigger as $$
declare est text; pid bigint;
begin
  pid := coalesce(new.pedido_id, old.pedido_id);
  select estado into est from pedidos where id = pid for update;
  if est <> 'confirmado' then
    raise exception 'El pedido % está en estado % y no se puede modificar', pid, est;
  end if;
  return coalesce(new, old);
end $$ language plpgsql;

create trigger pedido_items_editable
  before insert or update or delete on pedido_items
  for each row execute function pedido_editable();

-- ---------------------------------------------------------------------------
-- Invariante RESERVAS_CONSISTENTES, verificable en cualquier momento.
-- Devuelve las filas donde stock.reservado no coincide con la suma de las
-- reservas pendientes. Vacío = consistente. La usan los tests después de cada
-- escenario, incluidos los de rollback y fallo intermedio.
-- ---------------------------------------------------------------------------
create or replace function verificar_reservas_consistentes()
returns table(producto_id bigint, deposito_id bigint, stock_reservado numeric, suma_reservas numeric)
as $$
  select s.producto_id, s.deposito_id, s.reservado,
         coalesce((select sum(r.cantidad_pendiente) from reservas r
                   where r.producto_id = s.producto_id and r.deposito_id = s.deposito_id), 0)
  from stock s
  where s.reservado <> coalesce((select sum(r.cantidad_pendiente) from reservas r
                   where r.producto_id = s.producto_id and r.deposito_id = s.deposito_id), 0);
$$ language sql;
