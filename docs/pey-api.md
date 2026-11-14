# pey — referencia de la API (CoDi)

Fuente única de verdad para la integración. Todo lo de aquí sale de la
documentación pública, descargada el 14 nov 2026:

- OpenAPI: <https://docs.pey.mx/openapi.json> (`info.version: 2026-10-20`)
- Webhooks: <https://docs.pey.mx/docs/webhooks/introduction>,
  <https://docs.pey.mx/docs/webhooks/codi/pn>,
  <https://docs.pey.mx/docs/webhooks/codi/qr>
- Tutoriales: <https://docs.pey.mx/docs/tutorials/getting-started/set-up-webhooks>,
  <https://docs.pey.mx/docs/tutorials/getting-started/create-an-api-key>,
  <https://docs.pey.mx/docs/tutorials/use-cases/display-codi-qr>

Lo que la documentación **no dice** está marcado **NO DOCUMENTADO**. En el
código eso es un `// TODO(pey-docs)`.

---

## Ambiente y autenticación

| | |
|---|---|
| Base URL | `https://api.pey.mx` — el único servidor del OpenAPI ("Production environment") |
| Auth | `Authorization: Bearer <API key>` (esquema `http` / `bearer`) |
| Content-Type | `application/json` |
| Sandbox | **No existe todavía.** pey recomienda probar en producción con montos pequeños (p. ej. `$0.01 MXN`). "Pronto tendremos un entorno de pruebas dedicado." |

Cuenta de pruebas que se activa al instante (del tutorial *Crear una API key*):
los pagos enviados ahí **no se devuelven**, así que solo montos pequeños.

## Montos

**Pesos MXN como `number` con decimales** (`150.00`), no centavos. La app
convierte centavos enteros → pesos solo en el borde, al llamar a pey, y
pesos → centavos con redondeo al leer.

## Formato de error (todos los endpoints)

```json
{ "error": { "message": "…", "type": "INVALID_AMOUNT", "requestId": "abc123-…" } }
```

Códigos HTTP: `400`, `404` (consultas), `500` (`INTERNAL_SERVER_ERROR`),
`503` (`SERVICE_UNAVAILABLE` | `FLAGS_UNAVAILABLE` — "under maintenance").

---

## POST `/codi/pn` — Create Push Notification

Envía una solicitud de cobro CoDi al celular del pagador.

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `amount` | number | sí | MXN, `> 0` y `≤ 1,000,000` |
| `phoneNumber` | string | sí | `^[0-9]{10}$` |
| `concept` | string | no | lo ve el pagador |
| `expiration` | integer | no | segundos, **mínimo 360**, default 360 |
| `numRef` | string | no | `^[0-9]{1,7}$`, default `"0"` |
| `bankAccountId` | string | no | ULID; si se omite va a la cuenta CoDi de la API key |
| `metadata` | object | no | ≤50 pares, llaves ≤40 car., valores escalares ≤500 car.; **se regresan como strings** |

Respuesta **200**:

```json
{ "transactionId": "01J5KXYZ1234567890ABCD", "codiId": "12345678901234567890" }
```

- `transactionId`: ULID para rastrear el pago → `GET /transaction/{id}`.
- `codiId`: folio CoDi de Banxico (20 dígitos).

Errores 400: `INVALID_REQUEST`, `INCOMPLETE_PARAMETERS`, `INVALID_PARAMETER`,
`INVALID_AMOUNT`, `INVALID_STATE` ("API key does not have CoDi enabled"),
`PEY_CONSISTENCY_ERROR`, `BAD_REQUEST`.

## POST `/codi/qr` — Create QR

| Campo | Tipo | Req. | Notas |
|---|---|---|---|
| `amount` | number | sí | MXN, `≥ 0`; `0` = el pagador escribe el monto |
| `concept` | string | no | |
| `expiration` | integer | no | segundos; `0` = no vence; si se pone, **mínimo 360** |
| `numRef` | string | no | `^[0-9]{1,7}$` |
| `generateImage` | boolean | no | `true` → `qrImage` PNG base64 (más lento; recomiendan generar el QR del lado del cliente con `qrString`) |
| `bankAccountId` | string | no | igual que en PN |
| `metadata` | object | no | igual que en PN |

Respuesta **201**:

```json
{ "id": "AB12CD34EF", "qrString": "{\"TYP\":1,…}", "qrImage": "iVBOR…" }
```

- `id`: IDC del QR asignado por Banxico. **Un QR no es una transacción.**
- `qrString`: lo que se codifica en la imagen QR.

## GET `/transaction/{id}` — Get Transaction

`id` = ULID de la transacción. Solo transacciones de tu API key; las demás → 404.

```json
{
  "id": "01HXYZTXN1234567890ABCDE00",
  "status": "PAID",
  "amount": 102.5,
  "amountBreakdown": { "base": 100, "tip": 0, "fee": 2.5 },
  "currency": "MXN",
  "paymentMethod": "CODI",
  "payableType": "API_CODI_PN",
  "payableId": "01HXYZ1234567890ABCDEFGH00",
  "applicationFee": 7.5,
  "dateCreated": 1704067200,
  "datePaid": 1704067260,
  "metadata": { "clabe": "…", "bankCode": 40012, "accountType": 40,
                "description": "…", "trackingKey": "…", "externalMetadata": { } }
}
```

- `status`: **solo `PENDING` | `PAID`.**
- `amount` incluye propina y comisión; `amountBreakdown.base` es el monto cobrado.
- `payableType`: `PAYMENT_LINK` | `API_CODI_QR` | `API_CODI_PN`.
- `datePaid` solo existe una vez pagada.

## GET `/transaction/codi/qr/{id}` — Get CoDi QR Transactions

`id` = IDC del QR. Hasta 20 transacciones, más recientes primero,
paginadas con `nextToken` (query). Respuesta `{ "items": [ … ], "nextToken": string | null }`.
Cada item tiene la misma forma que *Get Transaction* (sin `payableType`).

## Otros endpoints (no los usamos)

`POST /bank-account`, `GET /bank-account/{id}`, `POST /payment-link/create`,
`POST /payment-link/update`, `GET /payment-link/{id}`,
`GET /transaction/api-key`, `GET /transaction/bank-account/{id}`.

---

## Webhooks

### Configuración

- Se registra **una URL por API key** en el portal (sección Desarrollador →
  engrane de la API key → "Crear Webhook").
- Al crearlo se muestra el **secreto** para validar firmas (formato
  `whsec_…`). Se puede rotar.
- Historial de entregas: Desarrollador → engrane → "Webhook Logs".

### Firma — Standard Webhooks

"Usamos Standard Webhooks para firmar todas las solicitudes." Recomiendan los
SDKs oficiales de Standard Webhooks (<https://www.standardwebhooks.com>). En
su ejemplo:

- Se verifica con el **cuerpo crudo como string**, no el JSON parseado.
- Encabezado `webhook-id`: "Esta es la clave de idempotencia, puedes usarla
  para deduplicar solicitudes".
- Responden 200 si la firma es válida.

La app usa el paquete npm oficial `standardwebhooks` (`new Webhook(secret).verify(rawBody, headers)`).

### `codi.pn.payment_received`

"Este webhook se dispara cuando se completa un pago de notificación push CoDi."

```json
{
  "amount": 100,
  "apiKeyId": "01M3QMMR6X9CBVDY1SF3G8QWNW",
  "bankAccountId": "01JBAVWE4NS5TGXHWGMX3KH23Q",
  "concept": "(dev) Order 45",
  "datePaid": 1790724758,
  "metadata": { "…": "…", "externalMetadata": { "orderId": "12345" } },
  "numRef": "4567",
  "transactionId": "01M3QR5E7XHXMNZDEPFH3JAWS0",
  "type": "codi.pn.payment_received"
}
```

`transactionId` es el mismo que devolvió `POST /codi/pn`.

### `codi.qr.payment_received`

"Este webhook se dispara cuando se recibe un pago en un QR CoDi creado a
través de la API." Igual que el de PN más `codiQrId` (el IDC del QR).
`transactionId` es la transacción nueva que generó ese pago.

---

## NO DOCUMENTADO

| Tema | Consecuencia en la app |
|---|---|
| **Devoluciones / reembolsos** — no hay endpoint | Un doble pago se registra como "requiere devolución" y se resuelve a mano |
| **Pago fallido / rechazado** — no hay evento ni estado (`status` solo `PENDING`/`PAID`) | `failed` solo se usa si `createCharge` falla en nuestro lado |
| **Vencimiento** — no hay evento ni estado `EXPIRED` | La app marca `expired` sola cuando pasa `expiration` |
| **Reintentos** — cuántos, con qué intervalo, qué respuesta los detiene | Respondemos 2xx en cuanto el evento queda guardado |
| **Tolerancia de `webhook-timestamp`** | La que aplique el SDK de Standard Webhooks |
| Si la PN acepta pagar **después** de `expiration` | Un pago tardío se aplica igual |
| Ambiente de pruebas | No hay; modo `PEY_MOCK=1` en la app |
