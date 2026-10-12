# MicoPay Café — Plan v0.2 (2026-10-12)

Plataforma web para que las cooperativas **paguen a sus productores por lo que entregan**: kilos de café hoy, otros productos mañana. Liquida en **Stellar** y se firma con la app de MicoPay. Es la sucesora en Stellar de [`Micopay/coffee-payments`](https://github.com/Micopay/coffee-payments), que se queda intacto como la versión XRPL.

## Qué es lo central

```
Entrega (productor, producto, cantidad, calidad) → Liquidación (cantidad × precio − castigos)
   → Corrida de pago (la cooperativa aprueba un lote de liquidaciones)
   → Firma en la app de MicoPay → Stellar → recibo al productor + mensajes ISO 20022
```

Todo lo demás (escrow, métricas, FIRA) se construye alrededor de esto, no al revés.

### Modelo de datos: producto genérico desde el día uno

| Tabla | Campos clave | Nota |
|---|---|---|
| `products` | `name`, `unit` (`kg`, `l`, `pza`…), `quality_schema` (JSON) | Café pergamino, café cereza, cacao, miel… Las variables de calidad (humedad, rendimiento, defectos) se declaran por producto, no en el código |
| `prices` | `product_id`, `cooperative_id`, `price_per_unit`, `currency`, `valid_from` | precio del día (ya existía como `daily_price`) |
| `deduction_rules` | `product_id`, `attribute`, `rule` | castigos por calidad: "humedad > 12% → −X%". Por ahora solo se registran; la regla automática es opcional |
| `deliveries` | `producer_id`, `product_id`, `quantity` (decimal), `quality` (JSON), `lot` | la entrega en la báscula |
| `settlements` | `delivery_ids`, `gross`, `deductions[]`, `net`, `currency` | el monto se redondea **una vez**, aquí |
| `payment_runs` | `cooperative_id`, `status`, `approved_by` | una corrida = un `pain.001` |
| `payments` | `settlement_id`, `stellar_tx`, `status`, `msg_ids` | un pago por productor por corrida |

Las cantidades y el dinero se manejan con decimales exactos (nunca `float`), que era un error del código anterior.

## Diseño: dirección "Mercado / Rótulo" de la app de MicoPay

Se reutiliza tal cual la capa de tokens de `micopay/frontend/src/index.css` y las primitivas de `src/components/ui` (`Button`, `Card`, `MoneyBlock`, `AmountField`, `Badge`, `Pill`, `TextField`, `Label`):

- **Papel y tinta** (`#fffdf8` / `#16130f`): nunca blanco frío ni negro puro.
- **Verde = lo digital** (saldos, tokens). **Naranja = el efectivo y la acción.** Son direccionales: verde/naranja sobre claro, verde-brillo/naranja-claro sobre oscuro.
- **Archivo** variable, empaquetada (no CDN). La jerarquía sale del ancho (`wdth` 105–118 en títulos) y del peso.
- Canto vivo (radios de 2–4 px), sombra sólida desplazada sin blur, sin gradientes, glows ni tarjetas dentro de tarjetas.
- Toda cifra con `.num` (números tabulares).
- Material Symbols empaquetados.

Diferencia con la app: aquí el usuario principal es un operador de cooperativa en **escritorio o tableta**, con tablas largas (productores, entregas, corridas). Las tablas siguen el mismo sistema: líneas `--color-linea`, sin cebra de colores, montos alineados a la derecha. Antes de construir pantallas se leen `docs/PLAN_REDISENO_VISUAL_APK_2026-08.md` y `PENDIENTES_REDISENO_VISUAL_2026-08.md` de micopay-protocol.

## Arquitectura

```
 navegador (operador / admin de la cooperativa)
        │
 apps/web  (React 19 + Vite + Tailwind 4, tokens de MicoPay)
        │  REST
 apps/api  (Fastify + Postgres propio) ──── Horizon (testnet)
        │  /sign-requests  (device key "cafe")
 micopay/backend  ──push──▶  app de MicoPay (aprueba y firma)
```

- **Identidad compartida = dirección de Stellar.** Sin contraseñas. `memberships(stellar_address, cooperative_id, role)`.
- **Iniciar sesión con MicoPay:** challenge SEP-10 (una transacción con `manage_data` que nunca se envía) mandado por `POST /sign-requests`. La API verifica la firma y emite su propia sesión. No requiere cambios en micopay/backend.
- **Pagar:** la API arma el XDR de la corrida, la app del operador lo firma y la API lo envía a Horizon. Una transacción de Stellar admite hasta 100 operaciones, así que una corrida chica cabe en **una sola firma**; las grandes se parten en lotes.
- **Activo:** se instruye en **MXN** (el productor piensa en pesos por kilo). Se liquida en MXNe o en USDC con tipo de cambio registrado; está por decidir cuál por defecto.
- Productores sin la app de MicoPay: basta su dirección de Stellar, con aviso de "cuenta sin activar" o "sin trustline".

## ISO 20022 — ver `docs/ISO20022.md`

Resumen: los mensajes de `coffee-payments` no validan contra sus XSD (10 de 10 casos) y usaban la familia equivocada. Aquí:

- `pain.001` por corrida de pago, con los kilos, el precio y los castigos en `RmtInf/Strd`.
- `pain.002` con el resultado de cada pago en Stellar.
- `camt.054` como recibo del productor y aviso de cargo a la cooperativa.
- `camt.053` con saldos reales de Horizon y entradas `DBIT`.
- Cada mensaje se valida contra su XSD en las pruebas y antes de guardarse.

## Escrow de calidad: opcional, no central

No está estudiado cómo lo usaría una cooperativa, así que **no bloquea nada**. Si se construye, usa el contrato `escrow-v2` compartido con Rentas (`../micopay-rentas/PLAN.md` § 4):

- la cooperativa es el árbitro;
- el productor cobra sin firmar nada;
- el destino queda fijo al bloquear;
- se permite un reparto parcial con un **descuento máximo** fijado al bloquear;
- **si la cooperativa no rechaza dentro de la ventana, el dinero va al productor**;
- el `pacs.002`/`pain.002` y el hash del reporte de calidad quedan como evidencia.

Antes de construirlo hay que preguntarle a una cooperativa real si lo usaría.

## Fases

| Fase | Entrega | Verificación |
|---|---|---|
| C0 | Monorepo (`apps/api`, `apps/web`, `packages/iso20022`, `packages/ui` con los tokens de MicoPay), docker-compose con Postgres | `npm test` verde |
| C1 | `packages/iso20022`: `pain.001`, `pain.002`, `camt.054`, `camt.053` con validación XSD en las pruebas | todos los casos válidos contra los XSD oficiales |
| C2 | Login con MicoPay (SEP-10 + sign-requests) contra un micopay/backend local | inicio de sesión real desde el teléfono |
| C3 | Cooperativas, membresías, productores, **productos genéricos**, precio del día | alta de café y de un segundo producto sin tocar código |
| C4 | Entregas → liquidaciones → corrida de pago firmada en la app, en testnet | hash en stellar.expert + `pain.001`/`camt.054` válidos |
| C5 | Historial, recibo del productor, `camt.053` de cierre, métricas | — |
| C6 | Conexión a micopay/backend en AWS | — |
| C7 | (Opcional) escrow de calidad con `escrow-v2` | ciclos aprobar / reparto / vencimiento en testnet |

## Abierto

- Activo de liquidación por defecto: MXNe o USDC.
- `PLAN_FIRA.md` (financiamiento de segundo piso) vive sin commit en la copia local de `coffee-payments`. ¿Entra a este repo?
- Documento fiscal de la compra al productor (nota de compra / CFDI emitido por el comprador para el sector primario): verificar la regla vigente del SAT antes de C4.
