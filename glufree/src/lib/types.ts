export type GlutenFreeLevel = "dedicated" | "certified" | "options";

export type PlaceCategory =
  | "ristorante"
  | "pizzeria"
  | "pasticceria"
  | "gelateria"
  | "bar"
  | "panetteria";

export type VerificationStatus = "verified" | "pending" | "community";

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  /** dedicated = cucina 100% senza glutine, certified = certificato AIC, options = menu GF dedicato */
  glutenFreeLevel: GlutenFreeLevel;
  verification: VerificationStatus;
  lat: number;
  lng: number;
  address: string;
  city: string;
  /** Paese in italiano; assente o "Italia" per i locali italiani */
  country?: string;
  rating: number;
  reviews: number;
  priceLevel: 1 | 2 | 3 | 4;
  description: string;
  phone?: string;
  website?: string;
  /** id Google Places, presente quando il dato arriva dall'API Google */
  googlePlaceId?: string;
  source: "glufree" | "google";
  /** Inserzione a pagamento "In evidenza": solo per locali verificati. */
  featured?: boolean;
}

export interface OwnerSubmission {
  id: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  business: {
    name: string;
    category: PlaceCategory;
    address: string;
    city: string;
    lat?: number;
    lng?: number;
    phone: string;
    website?: string;
    description: string;
    glutenFreeLevel: GlutenFreeLevel;
  };
  owner: {
    fullName: string;
    email: string;
    vatNumber: string;
  };
  proof: {
    type: "aic" | "menu" | "training" | "other";
    note: string;
    fileName?: string;
  };
  /** Codice invito (?invito=...) con cui il ristoratore è arrivato */
  referral?: string;
  /** Il ristoratore ha chiesto info sull'inserzione "In evidenza" (a pagamento). */
  wantsFeatured?: boolean;
}
