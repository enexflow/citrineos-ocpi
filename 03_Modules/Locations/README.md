<!-- SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project -->
<!--                                                                       -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Locations Module (OCPI 2.2.1)

Implementation of the [OCPI 2.2.1 Locations module](https://github.com/ocpi/ocpi/blob/2.2.1/mod_locations.asciidoc).

**Data owner:** CPO (for Sender), partner CPO records (for Receiver)

Full HTTP paths are prefixed with a role namespace and version, e.g. `/{role}/{version}/locations` where:

- Sender (CPO): `/ocpi/cpo/2.2.1/...`
- Receiver (eMSP): `/ocpi/emsp/2.2.1/...`

## Receiver URL shape (OCPI)

The Receiver interface follows OCPI:

`/{country_code}/{party_id}/{location_id}[/{evse_uid}][/{connector_id}]`

under the locations module base path (e.g. `/ocpi/emsp/2.2.1/locations/...`).

### Routing note

`country_code` is matched as exactly two letters (`[A-Za-z]{2}`) and `party_id` as three alphanumeric characters (`[A-Za-z0-9]{3}`). That avoids clashes with **Sender** routes that also use three path segments (`:location_id/:evse_uid/:connector_id`). Requests such as `/{numeric}/…` are handled by the Sender; requests like `/FR/HYX/LOC1` match the Receiver.

## Endpoints

### Sender Interface

| Method | Path                                                        | Description                     |
| ------ | ----------------------------------------------------------- | ------------------------------- |
| GET    | `/cpo/2.2.1/locations`                                      | Paginated list of locations     |
| GET    | `/cpo/2.2.1/locations/:location_id`                         | Fetch one location              |
| GET    | `/cpo/2.2.1/locations/:location_id/:evse_uid`               | Fetch one EVSE for a location   |
| GET    | `/cpo/2.2.1/locations/:location_id/:evse_uid/:connector_id` | Fetch one connector for an EVSE |

### Receiver Interface

| Method | Path                                                                                 | Description                               |
| ------ | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| GET    | `/emsp/2.2.1/locations/:country_code/:party_id/:location_id`                         | Retrieve stored partner location          |
| GET    | `/emsp/2.2.1/locations/:country_code/:party_id/:location_id/:evse_uid`               | Retrieve stored partner EVSE              |
| GET    | `/emsp/2.2.1/locations/:country_code/:party_id/:location_id/:evse_uid/:connector_id` | Retrieve stored partner connector         |
| PUT    | `/emsp/2.2.1/locations/:country_code/:party_id/:location_id`                         | Upsert full location from partner CPO     |
| PUT    | `/emsp/2.2.1/locations/:country_code/:party_id/:location_id/:evse_uid`               | Upsert EVSE from partner CPO              |
| PUT    | `/emsp/2.2.1/locations/:country_code/:party_id/:location_id/:evse_uid/:connector_id` | Upsert connector from partner CPO         |
| PATCH  | `/emsp/2.2.1/locations/:country_code/:party_id/:location_id`                         | Partial location update from partner CPO  |
| PATCH  | `/emsp/2.2.1/locations/:country_code/:party_id/:location_id/:evse_uid`               | Partial EVSE update from partner CPO      |
| PATCH  | `/emsp/2.2.1/locations/:country_code/:party_id/:location_id/:evse_uid/:connector_id` | Partial connector update from partner CPO |

Successful **PUT** and **PATCH** Receiver responses use the standard OCPI empty success envelope (`status_code` 1000, `timestamp`, no `data` object), consistent with other modules (e.g. Sessions).

## Mapper Design (Critical)

This module intentionally uses **two distinct mapper paths**. They are not interchangeable.

### Sender mapping path

Used by `LocationsService` for Sender GET endpoints:

- `LocationMapper.fromGraphql(...)`
- `EvseMapper.fromGraphql(...)`
- `ConnectorMapper.fromGraphql(...)`

This path maps our own CPO-side records to OCPI output for partner eMSPs.

### Receiver mapping path

Used by `LocationReceiverService` for Receiver GET endpoints:

- `LocationMapper.fromGraphqlReceiver(...)`
- `EvseMapper.fromGraphqlReceiver(...)`
- `ConnectorMapper.fromGraphqlReceiver(...)`

This path maps partner-owned rows (stored with OCPI ids such as `ocpiId` / `ocpiUid`) back to OCPI responses.

> Important: keep these two paths separate when adding fields. If you only update one path, Sender and Receiver responses diverge.

## Service Layer

### `LocationsService` (Sender)

Main responsibilities:

- apply OCPI header and date filters for sender queries
- query location/evse/connector data from GraphQL
- map data with Sender mapper path (`fromGraphql`)
- build OCPI success/error responses

### `LocationReceiverService` (Receiver)

Main responsibilities:

- validate tenant partner authorization for Receiver endpoints
- validate `country_code` / `party_id` in the URL against the authenticated partner and (for PUT location) against the Location body
- upsert/persist partner location, EVSE, connector payloads
- perform partial updates for PATCH endpoints (`last_updated` required per OCPI)
- map responses with Receiver mapper path (`fromGraphqlReceiver`)
- build OCPI success/error responses

## Events and Broadcasting

`LocationsModule` extends `AbstractDtoModule` and handles location/evse/connector insert/update events for broadcasting.

Broadcast safeguards currently rely on ownership checks (for example OCPI ids and owner partner markers) so partner-owned receiver records are not re-broadcast as sender-originated updates.
