import type { Quantity } from "./quantity";
import type { Recipe, RecipeStep } from "../recipe";
export const KITCHEN_KEY = "cooksync:kitchen:v3";
export const LEGACY_MUTABLE = ["fridge-app:items:v2", "fridge-app:items:v1", "fridge-app:shopping:v1", "fridge-app:meals:v1", "fridge-app:recipes:v1"];
export type Compartment = "冷蔵" | "冷凍" | "常温" | "未確認";
export type Presence = "ある" | "ない" | "見当たらない" | "未確認";
export interface Location { id: string; name: string; createdAt: string; timeZone?: string }
export interface Lot {
  id: string; locationId: string; ingredient: string; name: string; kind: "raw" | "prepared";
  quantity: Quantity | null; originalQuantity: string; presence: Presence; compartment: Compartment;
  condition: string; revision: number; createdAt: string; availableAt: string;
  expiresOn?: string; expiryBasis?: string; legacy?: Record<string, unknown>;
  storageMethod?: string; storedAt?: string; cookedAt?: string; recipeId?: string;
  weightEvidence?: { quantity: Quantity; grams: Quantity; estimated: boolean; basis: string };
}
export interface Demand { ingredient: string; name: string; quantity: Quantity | null; originalQuantity: string; kind: "raw" | "prepared"; lotId?: string }
export interface Plan {
  id: string; locationId: string; name: string; recipe: Recipe; demands: Demand[]; cookAt: string;
  status: "planned" | "partial" | "cooked" | "skipped"; consumed: Demand[]; revision: number;
  eatMinutes?: number; cleanupMinutes?: number;
  reviewNeeded?: string;
  mealId?: string;
  equipmentUsage?: EquipmentUse[];
}
export interface Meal { id: string; locationId: string; name: string; eatAt: string }
export interface EatingPlan { id: string; locationId: string; lotId: string; quantity: Quantity; eatAt: string; status: "planned" | "eaten" | "cancelled"; transactionId?: string }
export interface EquipmentUse { equipmentId: string; count: number; amount?: string; fromStep?: number; throughStep?: number }
export interface ShoppingRow { id: string; locationId: string; name: string; ingredient: string; quantity: Quantity | null; originalQuantity: string; source: "manual" | "plan" | "legacy"; planIds: string[]; purchasedBy?: string; archived?: boolean; product: string; store: string; packageContents?: Quantity; packageUnit?: string; availableAt?: string; legacy?: Record<string, unknown> }
export interface PackageProfile { id: string; ingredient: string; product: string; store: string; contents: Quantity; unit: string; updatedAt: string; active: boolean }
export interface Allocation { lotId: string; revision: number; basis: Quantity; quantity: Quantity; demand: Demand }
export interface Cooking { id: string; locationId: string; planId: string; planRevision: number; startedAt: string; recipe: Recipe; steps: RecipeStep[]; allocations: Allocation[]; checked: number[]; activeStep?: number; heldEquipment?: EquipmentUse[]; correction?: string; completedBy?: string }
export interface LotChange { lotId: string; delta: Quantity; beforeRevision: number }
export interface Transaction { id: string; commandId: string; locationId: string; type: string; at: string; changes: LotChange[]; createdLots: string[]; planId?: string; shoppingId?: string; cookingId?: string; reversedBy?: string; reverses?: string; note?: string; beforePlan?: Plan; metadataBefore?: Lot[]; original?: Record<string, unknown> }
export interface Feedback { id: string; locationId: string; recipeId: string; recipeBasis?: string; at: string; salt: string; amount: string; eaten: string; notes: string; active: boolean }
export interface Equipment { id: string; locationId: string; name: string; capacity: string; slots?: number }
export interface KitchenState {
  schema: 3; owner: string; revision: number; locations: Location[]; lots: Lot[]; plans: Plan[];
  shopping: ShoppingRow[]; packages: PackageProfile[]; cooking: Cooking[]; transactions: Transaction[];
  feedback: Feedback[]; equipment: Equipment[];
  recipes: Recipe[];
  meals?: Meal[];
  eatingPlans?: EatingPlan[];
  preferences: { variety: boolean; servingNote: string; retiredRules: string[] };
  operations: Record<string, { fingerprint: string; revision: number; cancelled?: boolean }>;
  migration: { version: 1; at: string; legacyRevision: number; original: Record<string, unknown>; signedDeviceCopy?: { sourceOwner: string; digest: string; sourceRevision: number; copiedAt: string } };
}
export interface KitchenCommand { id: string; locationId: string; expectedRevision: number; type: string; payload: Record<string, unknown> }
