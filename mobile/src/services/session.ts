import Constants from 'expo-constants';
import type { User } from 'firebase/auth';
import { Platform } from 'react-native';

export class AccountRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function apiBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
  if (configured && !configured.includes('YOUR_LOCAL_IP')) return configured;
  if (__DEV__) {
    const hostUri = Constants.expoConfig?.hostUri;
    const host = Platform.OS === 'web' ? globalThis.location?.hostname
      : hostUri && new URL('http://' + hostUri).hostname;
    if (host) return `http://${host}:3000`;
  }
  throw new Error('API URL unavailable');
}

type AccountResponse = { uid: string; ready: true; status?: string; displayName?: unknown };

async function accountRequest(user: User, path: string, method: 'GET' | 'POST', refresh = false): Promise<AccountResponse> {
  const baseUrl = apiBaseUrl();
  const token = await user.getIdToken(refresh);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AccountRequestError(response.status, data?.code ?? 'API_UNAVAILABLE');
    }
    if (data?.uid !== user.uid || data.ready !== true) throw new Error('Invalid account response');
    return data;
  } catch (error) {
    if (!refresh && error instanceof AccountRequestError && error.status === 401 && error.code === 'TOKEN_EXPIRED') {
      return accountRequest(user, path, method, true);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function bootstrapAccount(user: User) {
  await accountRequest(user, '/me/bootstrap', 'POST');
}

export async function loadAccount(user: User): Promise<{ displayName: string | null }> {
  let data;
  try {
    data = await accountRequest(user, '/me', 'GET');
  } catch (error) {
    if (!(error instanceof AccountRequestError && error.status === 404 && error.code === 'ACCOUNT_NOT_INITIALIZED')) {
      throw error;
    }
    await bootstrapAccount(user);
    data = await accountRequest(user, '/me', 'GET');
  }
  if (data.status !== 'active') throw new Error('Unexpected account status');
  return { displayName: typeof data.displayName === 'string' ? data.displayName.trim() || null : null };
}
