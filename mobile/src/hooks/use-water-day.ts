
import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import type { User } from 'firebase/auth';

import {
  getWaterDay,
  type WaterDayResponse,
} from '@/services/waterApi';

interface WaterFetchState {
  uid: string;
  dateKey: string;
  revision: number;
  data: WaterDayResponse | null;
  error: string | null;
}

export function useWaterDay(
  dateKey: string,
  user: User
) {
  const [result, setResult] =
    useState<WaterFetchState | null>(null);

  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => {
    setRevision(value => value + 1);
  }, []);

  useEffect(() => {
    let active = true;

    getWaterDay(dateKey, user)
      .then(data => {
        if (!active) return;

        setResult({
          uid: user.uid,
          dateKey,
          revision,
          data,
          error: null,
        });
      })
      .catch(cause => {
        if (!active) return;

        setResult({
          uid: user.uid,
          dateKey,
          revision,
          data: null,
          error:
            cause instanceof Error
              ? cause.message
              : 'WATER_LOAD_FAILED',
        });
      });

    return () => {
      active = false;
    };
  }, [dateKey, user, revision]);

  const isCurrent =
    result !== null &&
    result.uid === user.uid &&
    result.dateKey === dateKey &&
    result.revision === revision;

  return {
    data: isCurrent ? result.data : null,
    error: isCurrent ? result.error : null,
    loading: !isCurrent,
    refresh,
  };
}
