# MicoPay Café — Plan v0.1 (2026-10-12)

Plataforma web para que las cooperativas de café paguen a sus productores sobre **Stellar**, con mensajería ISO 20022 y escrow contra calidad. Es la sucesora en Stellar de [`Micopay/coffee-payments`](https://github.com/Micopay/coffee-payments), que se queda intacto como la versión XRPL.

## Qué se trae de `coffee-payments` y qué no

| Se porta (lógica probada) | Se reescribe | Se deja atrás |
|---|---|---|
| Generador ISO 20022: `pacs.008`, `pacs.002`, `camt.054`, `camt.053` (`core/iso_generator.py`) | UI: de PySide6 a web (React + Vite) | XRPL, Xaman, seeds en el cliente |
| Reglas del escrow de calidad: aprobar → liberar, rechazar → reembolso tras vencimiento | Persistencia: de SQLite a Postgres | Usuarios propios con contraseña |
| Registro de productores, precio diario, historial, métricas, cierre de día | Firma: todo pasa por la app de MicoPay | `backend/` de Xaman |
| Decisiones ya validadas: MemoHash con el UETR (D8), `CreateAccount` si la cuenta no existe (D7) | | |

## Arquitectura

```
 navegador (operador/admin de la cooperativa)
        │
        ▼
 apps/web  (React + Vite)
        │  REST
        ▼
 apps/api  (Fastify + Postgres propio) ──── Horizon / Soroban RPC (testnet)
        │
        │  /sign-requests  (device key de "cafe")
        ▼
 micopay/backend  ──push──▶  app de MicoPay (aprueba y firma)
```

- **Identidad compartida = dirección de Stellar.** No hay tabla de contraseñas. Un operador es un usuario de MicoPay con un rol en una cooperativa. Por ahora la tabla local es `memberships(stellar_address, cooperative_id, role)`.
- **Iniciar sesión con MicoPay:** la API arma un challenge SEP-10, que es una transacción con `manage_data` y nunca se envía a la red, y lo manda por `POST /sign-requests` con `identifier = username`. El usuario aprueba en la app, la API verifica la firma con `stellar-sdk` y emite su propia sesión. **No requiere cambios en micopay/backend.** Solo queda pendiente que la app muestre ese tipo de solicitud como "Iniciar sesión en MicoPay Café" en lugar de "transacción".
- **Pagos:** la API arma el XDR (pago en USDC con MemoHash del UETR), lo manda como sign-request a la app del operador, recupera el XDR firmado y lo envía a Horizon. Ninguna llave privada toca la plataforma.
- **Productores:** basta su dirección de Stellar. Si usan la app de MicoPay, la app ya activa la trustline de USDC (#425). Si no, se les muestra "cuenta sin activar" (D7).

## El problema del escrow de calidad

El contrato `micopay/contracts/escrow` **no sirve tal cual**, por tres razones:

1. `release()` exige `require_auth()` de quien recibe. El productor tendría que firmar para cobrar, y en el modelo de café el productor solo recibe.
2. El que libera es quien conoce el secreto. En café la decisión es de la cooperativa: aprueba la calidad.
3. Un solo `TokenId` por despliegue.

**Opciones:**
- **A. Contrato `escrow-v2` compartido con Rentas (recomendado).** Beneficiario fijo al bloquear (cumple I3 del plan XRPL: los fondos solo pueden terminar en el productor o de regreso con quien pagó), `release` sin firma del beneficiario y autorizado por un árbitro, reembolso permisionless tras el vencimiento. Ver `../micopay-rentas/PLAN.md` § Escrow.
- B. Cuenta efímera con dos transacciones preautorizadas (D4 de `PLAN_STELLAR.md`). Funciona sin Soroban, pero el spike XLM-02 nunca se hizo.

## Fases

| Fase | Entrega | Verificación |
|---|---|---|
| C0 | Monorepo (`apps/api`, `apps/web`, `packages/iso20022`), docker-compose con Postgres, CI de tests | `npm test` verde |
| C1 | Port del generador ISO 20022 a TS con pruebas que comparan contra XML producido por el Python actual | XML idéntico byte a byte para los mismos datos |
| C2 | Login con MicoPay (SEP-10 + sign-requests) contra un micopay/backend local | inicio de sesión real desde el teléfono |
| C3 | Cooperativas, membresías y productores (alta, dirección Stellar, estado de cuenta) | — |
| C4 | Pago directo en USDC testnet firmado en la app + `pacs.008`/`camt.054` | hash en stellar.expert |
| C5 | Escrow de calidad (depende de la opción A o B) | ciclo aprobar y ciclo rechazar/reembolsar en testnet |
| C6 | Historial, métricas, precio diario, `camt.053` de cierre | — |
| C7 | Conexión a micopay/backend en AWS | — |

## Abierto

- Nombre del repo en GitHub (propuesta: `Micopay/micopay-cafe`).
- `PLAN_FIRA.md` (financiamiento de segundo piso) vive sin commit en la copia local de `coffee-payments`. ¿Entra a este repo?
- Activo: USDC por defecto. MXNe queda como opción.
