# Admin Module: partner onboarding

All routes are under `/ocpi/admin` and need an admin token.

## Concepts

- **TenantPartner**: a party we're directly connected to over OCPI, either a hub (e.g. Gireve FR·107) or a direct partner. It is created manually before the credentials exchange. **The routes below never create one.**
- **RoamingPartner**: a party behind a hub, attached to the hub's TenantPartner. Its roles are `["CPO"]`, `["EMSP"]` or both.

## Routes

| Route                                | When to use it                                            | Writes to OCPI                                     | Side effects                                                                                                                                                | Response                                                   |
| ------------------------------------ | --------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `POST /create-roaming-partner-cpo`   | Register a CPO behind a hub, **without** pulling its data | RoamingPartner with role `CPO`                     | none                                                                                                                                                        | `{status}`                                                 |
| `POST /create-roaming-partner-emsp`  | Register an EMSP behind a hub, **without** billing        | RoamingPartner with role `EMSP`                    | none                                                                                                                                                        | `{status}`                                                 |
| `POST /onboard-roaming-partner-cpo`  | Full onboarding of a CPO behind a hub                     | RoamingPartner with role `CPO`                     | **Background** pull of tariffs, then locations                                                                                                              | `{status: "accepted"}`, or `"already onboarded"` (no pull) |
| `POST /onboard-roaming-partner-emsp` | Full onboarding of an EMSP behind a hub                   | RoamingPartner with role `EMSP`                    | Creates the Pennylane customer (`tenant_partner_id` + `roaming_partner_id`) **only if the partner is new**, and adds it to patterm `pennylane_ocpi_partner` | `{status}`                                                 |
| `POST /onboard-tenant-partner-emsp`  | Billing for a **direct** EMSP (no hub)                    | **nothing** (the TenantPartner must already exist) | Creates the Pennylane customer (`tenant_partner_id` only)                                                                                                   | `{status, pennylaneCustomerId}`                            |

## Shared behaviour

- **Idempotent upsert.** A RoamingPartner is identified by (hub TenantPartner, countryCode, partyId). Calling a route again with another role adds that role. Calling it with the same role does nothing. If the name or contract dates differ from the existing row, the route returns 400 and leaves the contract data untouched.
- **Bodies are validated.** `@BodyWithSchema` only feeds OpenAPI, so validation is done explicitly. An invalid body returns 400 with the list of fields at fault.
- **Billing is validated before anything is written.** A bad billing body never leaves a partner without its Pennylane customer.
- **The caller's token is forwarded** to the TS API (same Keycloak patterm realm).
- **Errors:** unknown TenantPartner → 404. Invalid body or contract conflict → 400. TS API error on `onboard-tenant-partner-emsp` → 400 with the TS API's detail.
