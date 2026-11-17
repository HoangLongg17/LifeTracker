import type { User } from 'firebase/auth';

import { apiRequest } from '@/services/session';

export type PreferredUnits = {
  weight: 'kg' | 'lb';
  height: 'cm' | 'in';
  water: 'mL' | 'L';
};

export type PersonalProfile = {
  uid: string;
  version: number;
  displayName: string;
  birthDate: string | null;
  birthYear: number | null;
  heightCm: number | null;
  currentWeightKg: number | null;
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active' | null;
  preferredUnits: PreferredUnits;
  timeZone: string;
};

export type ProfilePatch = {
  version: number;
  displayName?: string;
  birthDate?: string | null;
  birthYear?: number | null;
  heightCm?: number | null;
  activityLevel?: PersonalProfile['activityLevel'];
  preferredUnits?: Partial<PreferredUnits>;
  timeZone?: string;
  warningConfirmed?: boolean;
};

export type WeightMeasurement = {
  entryId: string;
  weightKg: number;
  measuredAt: string;
  timeZone: string;
  warningConfirmed?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readProfile(value: unknown, uid: string): PersonalProfile {
  if (!isRecord(value) || value.uid !== uid || !Number.isInteger(value.version)
      || typeof value.displayName !== 'string'
      || (value.birthDate !== null && typeof value.birthDate !== 'string')
      || (value.birthYear !== null && typeof value.birthYear !== 'number')
      || (value.heightCm !== null && typeof value.heightCm !== 'number')
      || (value.currentWeightKg !== null && typeof value.currentWeightKg !== 'number')
      || (value.activityLevel !== null && typeof value.activityLevel !== 'string')
      || typeof value.timeZone !== 'string' || !isRecord(value.preferredUnits)) {
    throw new Error('Invalid profile response');
  }
  const units = value.preferredUnits;
  if (units.weight !== 'kg' && units.weight !== 'lb'
      || units.height !== 'cm' && units.height !== 'in'
      || units.water !== 'mL' && units.water !== 'L') {
    throw new Error('Invalid profile units');
  }
  const levels = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
  if (value.activityLevel !== null && !levels.includes(value.activityLevel as string)) {
    throw new Error('Invalid profile activity level');
  }
  return {
    uid,
    version: value.version as number,
    displayName: value.displayName,
    birthDate: value.birthDate as string | null,
    birthYear: value.birthYear as number | null,
    heightCm: value.heightCm as number | null,
    currentWeightKg: value.currentWeightKg as number | null,
    activityLevel: value.activityLevel as PersonalProfile['activityLevel'],
    preferredUnits: {
      weight: units.weight,
      height: units.height,
      water: units.water,
    },
    timeZone: value.timeZone,
  };
}

export async function loadProfile(user: User) {
  return readProfile(await apiRequest(user, '/me/profile', 'GET'), user.uid);
}

export async function updateProfile(user: User, patch: ProfilePatch) {
  return readProfile(await apiRequest(user, '/me/profile', 'PATCH', patch), user.uid);
}

export async function addWeightMeasurement(user: User, measurement: WeightMeasurement) {
  const result = await apiRequest(user, '/me/weights', 'POST', measurement);
  if (!isRecord(result) || result.entryId !== measurement.entryId) {
    throw new Error('Invalid weight response');
  }
}
