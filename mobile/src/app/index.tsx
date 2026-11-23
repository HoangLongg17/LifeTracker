import { Redirect } from 'expo-router';

import { useSession } from '@/hooks/use-session';

export default function IndexScreen() {
  const { session } = useSession();
  return <Redirect href={session.status === 'active' ? '/today' : '/login'} />;
}
