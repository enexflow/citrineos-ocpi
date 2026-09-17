// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { readEnv } from '@/config';
import { useAuthStore } from '@/stores/auth';

const GRAPHQL_URL = readEnv('VITE_GRAPHQL_URL') ?? '/graphql';

export class GraphqlError extends Error {
  constructor(
    message: string,
    readonly errors: unknown[],
  ) {
    super(message);
    this.name = 'GraphqlError';
  }
}

export async function graphqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = await useAuthStore().getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL HTTP ${response.status}: ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (payload.errors?.length) {
    throw new GraphqlError(
      payload.errors.map((e) => e.message).join('; '),
      payload.errors,
    );
  }

  if (!payload.data) {
    throw new Error('GraphQL response had no data');
  }

  return payload.data;
}
