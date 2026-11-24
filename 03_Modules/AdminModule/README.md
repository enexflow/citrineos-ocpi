<!-- SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project -->
<!--                                                                       -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Admin Module: partner onboarding

All routes are under `/ocpi/admin` and need an admin token.

## Concepts

- **TenantPartner**: a party we're directly connected to over OCPI, either a hub (e.g. Gireve FR·107) or a direct partner. It is created manually before the credentials exchange. **The routes below never create one.**
- **RoamingPartner**: a party behind a hub, attached to the hub's TenantPartner. Its roles are `["CPO"]`, `["EMSP"]` or both.

## Routes

| Route                                | When to use it                                                       | Writes to OCPI                                     | Side effects                                                                                                                                                | Response                                                      |
| ------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `POST /create-roaming-partner-cpo`   | Register a CPO behind a hub, **without** pulling its data            | RoamingPartner with role `CPO`                     | none                                                                                                                                                        | `{status}`                                                    |
| `POST /create-roaming-partner-emsp`  | Register an EMSP behind a hub, **without** billing                   | RoamingPartner with role `EMSP`                    | none                                                                                                                                                        | `{status}`                                                    |
| `POST /onboard-roaming-partner-cpo`  | Full onboarding of a CPO behind a hub                                | RoamingPartner with role `CPO`                     | **Background** pull of tariffs, then locations                                                                                                              | `{status: "accepted"}`, or `"already onboarded"` (no pull)    |
| `POST /onboard-roaming-partner-emsp` | Full onboarding of an EMSP behind a hub                              | RoamingPartner with role `EMSP`                    | Creates the Pennylane customer (`tenant_partner_id` + `roaming_partner_id`) **only if the partner is new**, and adds it to patterm `pennylane_ocpi_partner` | `{status}`                                                    |
| `POST /onboard-tenant-partner-emsp`  | Billing for a **direct** EMSP (no hub)                               | **nothing** (the TenantPartner must already exist) | Creates the Pennylane customer (`tenant_partner_id` only)                                                                                                   | `{status, pennylaneCustomerId}`                               |
| `POST /onboard-roaming-network-cpo`  | Full onboarding of a **whole CPO network** behind a hub (see below)  | One RoamingPartner with role `CPO` per operation   | **Background** pull of tariffs, then locations, **one partner after another**                                                                               | `{status, failed, pullQueued, operations, skipped}`           |
| `POST /onboard-roaming-network-emsp` | Full onboarding of a **whole EMSP network** behind a hub (see below) | One RoamingPartner with role `EMSP` per operation  | Links every operation to the **same** Pennylane customer, one after another                                                                                 | `{status, failed, pennylaneCustomerIds, operations, skipped}` |

## Shared behaviour

- **Idempotent upsert.** A RoamingPartner is identified by (hub TenantPartner, countryCode, partyId). Calling a route again with another role adds that role. Calling it with the same role does nothing. If the name or contract dates differ from the existing row, the route returns 400 and leaves the contract data untouched.
- **Bodies are validated.** `@BodyWithSchema` only feeds OpenAPI, so validation is done explicitly. An invalid body returns 400 with the list of fields at fault.
- **Billing is validated before anything is written.** A bad billing body never leaves a partner without its Pennylane customer.
- **The caller's token is forwarded** to the TS API (same Keycloak patterm realm).
- **Errors:** unknown TenantPartner → 404. Invalid body or contract conflict → 400. TS API error on `onboard-tenant-partner-emsp` → 400 with the TS API's detail.

## Network onboarding

A hub operations export (e.g. the Gireve CSV, converted to JSON as is) is sent as `operations`. Each selected operation becomes one RoamingPartner, all with the **same** `roamingPartnerName` and contract dates, so the network can be found by name.

```json
{
  "ourCountryCode": "FR",
  "ourPartyId": "ZTA",
  "partnerCountryCode": "FR",
  "partnerPartyId": "107",
  "roamingPartnerName": "GreenFlux",
  "roamingPartnerSignatureDate": "2026-11-01",
  "roamingPartnerContractStartDate": "2026-11-01",
  "operationOwner": "GreenFlux Assets B.V.",
  "operations": [
    {
      "Operation Emi3": "FR*S13",
      "Operation Name": "GreenFlux Assets B.V. | FR*S13",
      "Operation Owner": "GreenFlux Assets B.V."
    },
    {
      "Operation Emi3": "NL*EVN",
      "Operation Name": "Evnet.nl | NL*EVN",
      "Operation Owner": "GreenFlux Assets B.V."
    }
  ]
}
```

The EMSP route also takes the billing fields and `contractNb` of `onboard-roaming-partner-emsp`.

- **Operations.** Only `Operation Emi3` (`FR*S13` → country `FR`, party `S13`) is used; `Operation Name` is ignored. Duplicates are rejected. At most 500 per call for the CPO route, 50 for the EMSP route.
- **`operationOwner`** (optional) keeps only the operations of that owner (trimmed, case insensitive); the others are returned in `skipped`. Without it, the operations must all have the same owner, otherwise 400.
- **Per-operation result.** One failing operation (e.g. a contract conflict) does not stop the others: it is reported with `status: "failed"` and its `error`. Calling the route again is safe. The response is 200 even if every operation failed; `failed` gives the count.
- **CPO route.** Partners are registered during the request; only new partners (or a new `CPO` role) are pulled, unless `forcePull: true`, which also pulls the ones already onboarded (e.g. after a restart interrupted a pull). Pulls run in the background, tariffs then locations, one partner after another; progress and a final `Network pull completed {network, success, total, failed}` are logged (`success` is false if any pull failed). Only one network pull runs at a time (in memory, so one OCPI replica): a second call during a pull returns 400.
- **EMSP route.** Runs during the request, in order, forwarding the caller's token. The first operation creates the Pennylane customer named `roamingPartnerName`; the TS API finds it by VAT number or name for the next ones and only adds the partner link. `pennylaneCustomerIds` lists the customers used; more than one is logged as a warning. A long list can take minutes (each TS API call scans the Pennylane customers), so give the HTTP client a long timeout. The run logs `Network EMSP onboarding started` and always ends with one `Network EMSP onboarding completed {network, success, total, failed, ...}` (`success` is false if any operation failed or the run stopped, with `error` in that case), so it can be followed in the logs even if the HTTP client gave up. Only one EMSP network runs at a time (in memory, so one OCPI replica): a second call meanwhile, e.g. a retry after a proxy timeout, returns 400. Larger networks: split `operations` into several calls with the same body, one after another (wait for each response). Operations already linked are reported as such, not as failures. Check that every response has the same `pennylaneCustomerIds`.
