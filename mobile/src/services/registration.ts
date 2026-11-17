import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';

import { getRegistrationAuth } from '@/config/firebase';
import { bootstrapAccount } from '@/services/session';

export async function createAccount(email: string, password: string): Promise<'complete' | 'profile-pending'> {
  const signupAuth = getRegistrationAuth();
  const { user } = await createUserWithEmailAndPassword(signupAuth, email.trim(), password);
  try {
    await bootstrapAccount(user);
    return 'complete';
  } catch {
    // The account exists. The next explicit login retries profile setup for this UID.
    return 'profile-pending';
  } finally {
    if (signupAuth.currentUser === user) await signOut(signupAuth);
  }
}
