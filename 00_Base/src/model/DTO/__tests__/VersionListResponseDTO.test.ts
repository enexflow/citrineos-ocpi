// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { VersionListResponseDTOSchema } from '../VersionListResponseDTO';
import { VersionNumber } from '../../VersionNumber';

const base = 'https://partner.example.com/ocpi/emsp/versions';

describe('VersionListResponseDTOSchema', () => {
  it('ignores unknown versions advertised by the partner (e.g. 2.3.0)', () => {
    const result = VersionListResponseDTOSchema.parse({
      status_code: 1000,
      timestamp: '2026-10-26T09:19:37.570Z',
      data: [
        { version: '2.3.0', url: `${base}/2.3.0` },
        { version: '2.2.1', url: `${base}/2.2.1` },
        { version: '2.1.1', url: `${base}/2.1.1` },
      ],
    });

    expect(result.data).toEqual([
      { version: VersionNumber.TWO_DOT_TWO_DOT_ONE, url: `${base}/2.2.1` },
      { version: VersionNumber.TWO_DOT_ONE_DOT_ONE, url: `${base}/2.1.1` },
    ]);
  });

  it('still rejects a known version with an invalid url', () => {
    expect(() =>
      VersionListResponseDTOSchema.parse({
        status_code: 1000,
        timestamp: '2026-10-26T09:19:37.570Z',
        data: [{ version: '2.2.1', url: 'not-a-url' }],
      }),
    ).toThrow();
  });
});
