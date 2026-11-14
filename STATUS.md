# Estado — 14 de noviembre de 2026

Hackathon de Cursor, cierre el domingo 15 de noviembre a la 1:00 pm (CDMX). Reto: "un pago confirmado activa una acción verificable", con pey y CoDi.

## Funciona y está verificado

| | Evidencia |
|---|---|
| Crear cuenta, QR real de la mesa, entrar desde otro teléfono | Probado en navegador, dos orígenes |
| Reparto: iguales al centavo, montos del admin, cada quien lo suyo | `split.ts`, 15 pruebas |
| Activar cobros: congela el reparto; quien pagó y las partes en $0 quedan pagados | Probado en navegador |
| Cobro CoDi por push (celular) o por QR, contra pey | `pey.ts`, según `docs/pey-api.md` |
| No crea un segundo cobro si hay uno vigente | `collect.test.ts`; en vivo devolvió `reused: true` |
| Webhook firmado (Standard Webhooks), guardado antes de aplicar | `pey.test.ts`; en producción, un aviso sin firma da 401 |
| Pago normal, duplicado ignorado, pago tardío, doble pago → devolución, último pago → saldada | `payments.test.ts` (9 pruebas) y simulado en navegador |
| Barra "$X de $Y · faltan N", lista en tiempo real, animación "Cuenta saldada" | Probado en navegador; se actualiza en la otra ventana |
| Vista de mesa para pantalla grande (`?mesa`) | Probado en navegador |
| Eventos de pago para el admin, incluidos duplicados | Probado en navegador |
| `PEY_MOCK=1` etiquetado "SIMULADO"; `/api/dev/simulate-payment` da 404 sin él | En producción da 404 |
| Desplegado en Vercel, conectado a GitHub | <https://dema-beryl.vercel.app> |
| **Pago real con pey, $0.01 por QR CoDi** | Webhook firmado `codi.qr.payment_received` recibido en producción, procesado como "pagado · cuenta saldada"; pey consulta el cobro como `PAID` (cuenta `iw4uhcts`, 14 nov) |
| Cero web3 | `grep -ri "hedera\|x402\|privy\|worldcoin\|hashscan\|tusd" src` no devuelve nada |

## Falta

- **Pago real por notificación push.** El pago real se hizo por QR. Las solicitudes push se crean en pey (`PENDING`), pero falta confirmar que una aceptada en el banco llegue por webhook.
- **Rotar el secreto del webhook** antes de la demo pública: el actual se compartió en un chat.
- **Devoluciones.** pey no documenta un endpoint. Un doble pago queda marcado "requiere devolución" y se devuelve a mano.

## TODO(pey-docs): lo que pey no documenta

- Largo máximo de `concept`. Se recorta a 40 caracteres.
- Si el `amount` del webhook incluye la comisión del pagador. Por eso se marca pagado si es **mayor o igual** a la parte.
- Ventana de reintentos y tolerancia del timestamp del webhook. Aplica la del SDK de Standard Webhooks.
- No hay evento ni estado de pago fallido o vencido (`status` solo es `PENDING`/`PAID`). El vencimiento lo calcula la app con `expires_at`.

## Decisiones que difieren del plan original

- **El celular vive en `member_secrets`, no en `members`.** `members` es de lectura pública (QR y Realtime) y expondría los teléfonos.
- **`webhook_events.pey_event_id` no es UNIQUE.** Así un reintento queda como su propia fila "duplicado, ignorado" y se ve. Lo que impide cobrar dos veces es el `UPDATE` condicional sobre `charges`.
