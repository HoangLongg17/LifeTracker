import { createUserWithEmailAndPassword, type User } from 'firebase/auth';
import { auth } from '@/config/firebase';

export function createAccount(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email.trim(), password);
}

// Idempotent: retry this after a timeout or after restoring the Firebase session.
export async function completeProfile(user: User) {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('Missing API URL');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}/users/bootstrap`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Profile unavailable');
    const result = await response.json();
    if (result.ready !== true || result.uid !== user.uid) throw new Error('Invalid profile response');
  } finally {
    clearTimeout(timeout);
  }
}
