// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

jest.mock('@citrineos/ocpi-base', () => ({
  InvalidParamException: class InvalidParamException extends Error {},
}));

import { InvalidParamException } from '@citrineos/ocpi-base';
import { selectNetworkOperations } from '../module/network.js';

const greenflux = (id: string, name = `GreenFlux Assets B.V. | ${id}`) => ({
  'Operation Emi3': id,
  'Operation Name': name,
  'Operation Owner': 'GreenFlux Assets B.V.',
});

describe('selectNetworkOperations', () => {
  it('splits each eMI3 operator id into country code and party id', () => {
    expect(
      selectNetworkOperations([
        greenflux('FR*S13'),
        greenflux('NL*EVN', 'Evnet.nl | NL*EVN'),
        greenflux('FR*190'),
      ]),
    ).toEqual({
      selected: [
        { operation: 'FR*S13', countryCode: 'FR', partyId: 'S13' },
        { operation: 'NL*EVN', countryCode: 'NL', partyId: 'EVN' },
        { operation: 'FR*190', countryCode: 'FR', partyId: '190' },
      ],
      skipped: [],
    });
  });

  it('keeps only the operations of operationOwner, ignoring case and spaces', () => {
    const { selected, skipped } = selectNetworkOperations(
      [
        greenflux('FR*S13'),
        {
          'Operation Emi3': 'FR*TCB',
          'Operation Owner': 'Other CPO SAS',
        },
        { 'Operation Emi3': 'FR*NOO' },
      ],
      '  greenflux assets b.v. ',
    );

    expect(selected.map((o) => o.operation)).toEqual(['FR*S13']);
    expect(skipped).toEqual([
      { operation: 'FR*TCB', reason: 'owned by Other CPO SAS' },
      { operation: 'FR*NOO', reason: 'no owner' },
    ]);
  });

  it('takes every operation without operationOwner when they share one owner', () => {
    const { selected } = selectNetworkOperations([
      greenflux('FR*S13'),
      { 'Operation Emi3': 'FR*ABA' },
    ]);

    expect(selected).toHaveLength(2);
  });

  it('rejects operations of several owners without operationOwner', () => {
    expect(() =>
      selectNetworkOperations([
        greenflux('FR*S13'),
        { 'Operation Emi3': 'FR*TCB', 'Operation Owner': 'Other CPO SAS' },
      ]),
    ).toThrow(InvalidParamException);
  });

  it('rejects when no operation belongs to operationOwner', () => {
    expect(() =>
      selectNetworkOperations([greenflux('FR*S13')], 'Other CPO SAS'),
    ).toThrow('no operation owned by Other CPO SAS');
  });
});
