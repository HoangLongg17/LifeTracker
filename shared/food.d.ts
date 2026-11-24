export type FoodUnit = 'g' | 'mL' | 'serving';
export type Nutrient = 'energyKcal' | 'proteinGrams' | 'carbsGrams' | 'fatGrams' | 'fiberGrams' | 'sodiumMg';

export type Food = Record<Nutrient, number | null> & {
  foodId: string;
  foodName: string;
  nameNormalized: string;
  aliasesNormalized: string[];
  foodSource: string;
  sourceFoodId: string | null;
  sourceUrl: string | null;
  sourceVersion: string | null;
  retrievedAt: string | null;
  sourceDescription: string | null;
  dataType: string | null;
  foodState: string | null;
  category: string | null;
  referenceBasis: '100g' | '100mL' | 'serving';
  referenceAmount: number;
  referenceUnit: FoodUnit;
  servingSize: number | null;
  servingUnit: 'g' | 'mL' | null;
  servingLabel: string | null;
  densityGramsPerMl: number | null;
  densitySourcePortionId: string | null;
  version: number;
  completeness: Record<Nutrient, 'complete' | 'unknown'>;
};
export type FoodPage = { items: Food[]; nextCursor: string | null };

export type PortionInput =
  | { consumedGrams: number; consumedMl?: never; quantity?: never }
  | { consumedMl: number; consumedGrams?: never; quantity?: never }
  | { quantity: number; consumedGrams?: never; consumedMl?: never };
export type PortionItem = { foodId: string } & PortionInput;
export type NutrientValues = Record<Nutrient, number | null>;
export type NutritionPreview = {
  items: (NutrientValues & {
    foodId: string;
    foodName: string;
    foodSource: string;
    foodVersion: number;
    amount: number;
    unit: 'g' | 'mL';
    calculationMethod: 'source_scaled';
    formulaVersion: 1;
  })[];
  totals: NutrientValues;
  nutrientCompleteness: Record<Nutrient, 'complete' | 'partial' | 'unknown'>;
  warnings: ('HIGH_PORTION_MASS' | 'HIGH_MEAL_ENERGY')[];
};

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type MealWarning = NutritionPreview['warnings'][number] | 'HIGH_DAY_ENERGY';
export type MealDraft = {
  entryId: string;
  loggedAt: string;
  timeZone: string;
  mealType: MealType;
  items: PortionItem[];
  previewTag?: string;
  note?: string;
  warningConfirmed?: boolean;
};
export type MealJournalItem = {
  foodName: string;
  amount: number | null;
  unit: FoodUnit | null;
  converted?: { amount: number; unit: 'g' | 'mL' };
};
export type MealJournalEntry = {
  entryId: string;
  loggedAt: string;
  timeZone: string;
  mealType: MealType;
  items: MealJournalItem[];
  totals: NutrientValues;
  nutrientCompleteness: NutritionPreview['nutrientCompleteness'];
  version: number;
};

export type MealEditLine = { food: Food; currentFood: Food | null; input: PortionItem };
export type MealEditor = {
  entryId: string; version: number; localDate: string; loggedAt: string; timeZone: string; mealType: MealType;
  lines: MealEditLine[];
};
