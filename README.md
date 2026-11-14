# Cuadra

Divide una cuenta entre varias personas y que **cada quien pague su parte con CoDi**. Sin juntar comprobantes: una sola pantalla muestra quién ya pagó y cuánto falta, y un pago cuenta **solo cuando pey avisa al servidor**.

En producción: <https://dema-beryl.vercel.app>

## Cómo funciona

1. Quien pagó la cuenta la abre en `/nuevo` y enseña el QR de la mesa.
2. Cada persona lo escanea, entra y ve su parte. Se reparte en partes iguales al centavo, con montos que pone el admin o con lo que cada quien escribe.
3. El admin pulsa **Activar cobros** y el reparto se congela.
4. Cada quien paga su parte: le llega una solicitud CoDi a la app de su banco (con su celular) o escanea un QR CoDi por el monto exacto.
5. pey manda un webhook firmado, el servidor lo verifica y lo guarda, y la persona queda pagada. La barra avanza en todos los teléfonos en tiempo real.
6. Con el último pago, la cuenta queda **saldada**. El admin ve en **Eventos de pago** cada aviso que llegó, incluidos los repetidos que se ignoraron.

`/g/<id>?mesa` es la vista para una tele o laptop: solo lectura, sin necesidad de entrar.

### Las reglas del dinero

- Todo el dinero se maneja en centavos enteros. pey recibe pesos con decimales, y la conversión ocurre en un solo lugar (`src/lib/money.ts`).
- El navegador nunca marca a nadie como pagado. Solo el webhook lo hace.
- Ninguna orden se aplica dos veces: un cobro pasa a `paid` con un solo `UPDATE … WHERE status IN ('pending','expired')`.
- Un **pago tardío**, que llega después de vencer la solicitud, se aplica igual.
- Un **doble pago** se registra como "requiere devolución" y no cambia montos. pey no documenta un endpoint de devoluciones, así que se resuelve a mano.
- Si falla la base de datos, el webhook responde 500 y pey reintenta. El aviso no se pierde ni se toma por duplicado.

## Correrlo en local con `PEY_MOCK=1`

```bash
npm install
cp .env.local.example .env.local   # llena las de Supabase; las de pey pueden ir vacías
PEY_MOCK=1 npm run dev
```

Con `PEY_MOCK=1` nada llega a pey y todo dice **SIMULADO**. En la tarjeta de pago aparece "Hacer de pey": simula el pago, el aviso repetido y el QR pagado dos veces. Esos botones llaman a `/api/dev/simulate-payment`, que corre **el mismo código** que el webhook real y responde 404 si `PEY_MOCK` no es `1`.

Para probar con dos personas en una sola máquina, abre una ventana en `http://localhost:3000` y otra en `http://127.0.0.1:3000`. Son orígenes distintos, así que cada una es una persona.

```bash
npm test        # pruebas: reparto, dinero, netting, webhook, cobros, firma
npm run build
```

## Supabase

1. Crea un proyecto en Supabase.
2. En el SQL Editor, corre [`supabase/schema.sql`](supabase/schema.sql). Crea `groups`, `members`, `member_secrets`, `charges` y `webhook_events`, con RLS y Realtime.
3. Copia la URL, la anon key y la service role key desde Project Settings → API.

El navegador solo puede **leer** `groups`, `members` y `charges`. Los secretos, los celulares y los avisos crudos de pey (traen la CLABE de quien paga) solo los ve el servidor.

## Variables (Vercel → Settings → Environment Variables → Production)

| Variable | Qué es |
|---|---|
| `PEY_API_KEY` | API key de pey (portal.mipey.mx → Desarrollador) |
| `PEY_API_URL` | `https://api.pey.mx` |
| `PEY_WEBHOOK_SECRET` | Secreto `whsec_…` que muestra pey al crear el webhook |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto de Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key (pública; la protege RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (solo servidor) |
| `NEXT_PUBLIC_APP_URL` | Dominio de producción, p. ej. `https://dema-beryl.vercel.app` |
| `PEY_MOCK` | `1` para simular. **Vacío en producción** |

## Webhook de pey

En pey → Desarrollador → engrane de la API key → *Crear Webhook*:

```
https://<proyecto>.vercel.app/api/webhooks/pey
```

Usa el dominio de **producción**, no el de un preview. Las URLs de preview cambian con cada despliegue y pueden tener Deployment Protection, que bloquearía el aviso. pey admite un solo webhook por API key. Las firmas siguen Standard Webhooks y se verifican con el paquete oficial `standardwebhooks`.

Para comprobar que llegó un aviso, corre esto en el SQL Editor de Supabase:

```sql
select received_at, type, processed, result from webhook_events order by received_at desc limit 10;
```

También se ve en la pantalla del admin, en **Eventos de pago**, y en pey → *Webhook Logs*.

## Documentación de pey

[`docs/pey-api.md`](docs/pey-api.md) es la referencia que sigue el código. Se armó con el OpenAPI y las páginas de webhooks de docs.pey.mx. Lo que pey no documenta está marcado `TODO(pey-docs)` en el código.

---

Basado en el motor de división de cuentas de Squash (proyecto previo del equipo).
