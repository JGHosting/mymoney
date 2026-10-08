/** Feste Icon-Zuordnung für Kategorien (nur benötigte Icons → kleines Bundle). */
import {
  House, KeyRound, Receipt, Zap, Wifi, ShoppingBasket, Utensils, Bike, Car, Fuel, TrainFront, CarTaxiFront, Mountain, Tv, Cloud,
  Gamepad2, Clapperboard, Dumbbell, Palette, ShoppingBag, Shirt, Smartphone, Sofa, Package, HeartPulse, Pill, Stethoscope, Sparkles,
  ShieldCheck, Plane, Banknote, CircleDashed, Wallet, Briefcase, Undo2, Plus, ArrowLeftRight, Tag, PiggyBank, GraduationCap, Gift, Baby, PawPrint,
  type LucideIcon
} from 'lucide-react';

export const ICONS: Record<string, LucideIcon> = {
  home: House, 'key-round': KeyRound, receipt: Receipt, zap: Zap, wifi: Wifi, 'shopping-basket': ShoppingBasket, utensils: Utensils, bike: Bike,
  car: Car, fuel: Fuel, 'train-front': TrainFront, 'car-taxi-front': CarTaxiFront, mountain: Mountain, tv: Tv, cloud: Cloud, 'gamepad-2': Gamepad2,
  clapperboard: Clapperboard, dumbbell: Dumbbell, palette: Palette, 'shopping-bag': ShoppingBag, shirt: Shirt, smartphone: Smartphone, sofa: Sofa,
  package: Package, 'heart-pulse': HeartPulse, pill: Pill, stethoscope: Stethoscope, sparkles: Sparkles, 'shield-check': ShieldCheck, plane: Plane,
  banknote: Banknote, 'circle-dashed': CircleDashed, wallet: Wallet, briefcase: Briefcase, 'undo-2': Undo2, plus: Plus, 'arrow-left-right': ArrowLeftRight,
  tag: Tag, 'piggy-bank': PiggyBank, 'graduation-cap': GraduationCap, gift: Gift, baby: Baby, 'paw-print': PawPrint
};
/** Auswahl für eigene Kategorien. */
export const PICKABLE_ICONS = ['tag', 'gift', 'graduation-cap', 'piggy-bank', 'baby', 'paw-print', 'palette', 'mountain', 'plane', 'car', 'home', 'utensils', 'shopping-bag', 'heart-pulse', 'briefcase', 'wallet'];
export const iconFor = (name: string | undefined): LucideIcon => ICONS[name ?? ''] ?? Tag;
