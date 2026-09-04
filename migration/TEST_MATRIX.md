# Matriz de tests

Escribe solo el tester. Las invariantes tienen nombre fijo: se usan tal cual en los nombres de
los tests y el auditor las cita en sus veredictos.

| ID | Caso | Resultado esperado |
|---|---|---|
| VENTA_NORMAL | stock 5, venta 2 | stock 3; venta, ítems, cobro, asiento balanceado y auditoría creados |
| STOCK_INSUFICIENTE | stock 1, venta 2 | rechazada; stock 1; sin venta, sin cobro, sin asiento, sin auditoría |
| FALLO_INTERMEDIO | falla el asiento | rollback total: stock, venta y cobro no existen |
| DOBLE_ENVIO | misma operación, misma clave de idempotencia, dos veces | una sola venta; la segunda devuelve la primera |
| CONCURRENCIA | dos vendedores, última unidad, simultáneo | exactamente una confirmada; stock 0; la otra STOCK_INSUFICIENTE |
| CONTABILIDAD | cualquier asiento generado | Debe = Haber, redondeo a centavos |
| COMPROBANTES | 100 comprobantes concurrentes | 100 números distintos y consecutivos |
| COMPRA_ATOMICA | compra con fallo intermedio | rollback total |
| COBRO_SIN_PARCIAL | cobro con dos medios, falla el segundo | ninguno registrado |
| CTA_CTE | venta con "Pendiente de pago" | saldo del cliente = total − cobros |

## Estado por adaptador

| Invariante | Firestore (actual) | Postgres (nuevo) |
|---|---|---|
| FALLO_INTERMEDIO | known-failing (ver RISKS R1) | debe pasar |
| CONCURRENCIA | known-failing (ver RISKS R1) | debe pasar |
| resto | por verificar en FASE 1 | debe pasar |
