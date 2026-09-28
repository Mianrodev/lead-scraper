// Builds data/category-map.json: each Google business type (src/taxonomy.ts) -> the Overture
// Maps place categories that hold the same businesses (data/overture-categories-us.json, from
// scripts/overture_collect.py --list-categories). Run: npx tsx scripts/build-category-map.ts
//
// Matching, in order: hand-made synonyms for common trades; the same words (snake_case,
// singular); then word overlap with the Overture name, preferring bigger categories.

import { readFileSync, writeFileSync } from "node:fs";
import { INDUSTRIES } from "../src/taxonomy";

type OvCat = { cat: string; basic: string | null; hier: string | null; n: number };
const overture: OvCat[] = JSON.parse(readFileSync("data/overture-categories-us.json", "utf8"));
const byName = new Map(overture.map((c) => [c.cat, c]));

// Google type (lower case) -> Overture categories. Checked by hand for the trades agencies target most.
const SYNONYMS: Record<string, string[]> = {
  plumber: ["plumbing"],
  "emergency plumber": ["plumbing"],
  electrician: ["electrician"],
  "electrical contractor": ["electrician"],
  "roofing contractor": ["roofing"],
  roofer: ["roofing"],
  "hvac contractor": ["hvac_service"],
  "air conditioning contractor": ["hvac_service"],
  "air conditioning repair service": ["hvac_service"],
  "heating contractor": ["hvac_service"],
  "furnace repair service": ["hvac_service"],
  landscaper: ["landscaping"],
  "landscape designer": ["landscaping", "landscape_architect"],
  "lawn care service": ["landscaping", "lawn_service"],
  "tree service": ["tree_service"],
  "pest control service": ["pest_control_service", "pest_control"],
  "general contractor": ["contractor", "general_contractor"],
  "construction company": ["construction_services", "contractor"],
  "home builder": ["home_builder", "construction_services"],
  "painter": ["painting", "painter"],
  "painting": ["painting"],
  "house cleaning service": ["house_cleaning", "cleaning_service"],
  "cleaning service": ["cleaning_service", "house_cleaning"],
  "carpet cleaning service": ["carpet_cleaning"],
  "pressure washing service": ["pressure_washing"],
  "garage door supplier": ["garage_door_service"],
  "garage door service": ["garage_door_service"],
  locksmith: ["locksmith"],
  "pool cleaning service": ["pool_cleaning", "swimming_pool_service"],
  "fence contractor": ["fence_contractor", "fencing"],
  "flooring contractor": ["flooring_contractor", "flooring"],
  "handyman/handywoman/handyperson": ["handyman"],
  handyman: ["handyman"],
  "moving company": ["movers", "moving_company"],
  "auto repair shop": ["automotive_repair"],
  "car repair and maintenance service": ["automotive_repair"],
  "auto body shop": ["body_shop", "automotive_body_shop"],
  "car dealer": ["car_dealer"],
  "used car dealer": ["used_car_dealer", "car_dealer"],
  "towing service": ["towing_service"],
  dentist: ["dentist"],
  "dental clinic": ["dentist", "dental_clinic"],
  "cosmetic dentist": ["cosmetic_dentist", "dentist"],
  orthodontist: ["orthodontist"],
  chiropractor: ["chiropractor"],
  "physical therapist": ["physical_therapy"],
  "medical spa": ["medical_spa"],
  "day spa": ["day_spa", "spa"],
  spa: ["spa", "day_spa"],
  "massage therapist": ["massage_therapy", "massage"],
  "hair salon": ["hair_salon"],
  "beauty salon": ["beauty_salon"],
  "nail salon": ["nail_salon"],
  barber_shop: ["barber"],
  "barber shop": ["barber"],
  gym: ["gym"],
  "fitness center": ["gym", "fitness_center"],
  "yoga studio": ["yoga_studio"],
  veterinarian: ["veterinarian"],
  "pet groomer": ["pet_groomer", "pet_grooming"],
  "real estate agency": ["real_estate_agent", "real_estate_agency", "real_estate_service"],
  "real estate agent": ["real_estate_agent"],
  "insurance agency": ["insurance_agency"],
  lawyer: ["lawyer", "attorney"],
  attorney: ["lawyer", "attorney"],
  "personal injury attorney": ["personal_injury_law", "lawyer"],
  accountant: ["accountant", "accounting"],
  "tax preparation service": ["tax_services", "tax_preparation"],
  "financial planner": ["financial_advising", "financial_planner"],
  restaurant: ["restaurant"],
  cafe: ["cafe", "coffee_shop"],
  "coffee shop": ["coffee_shop", "cafe"],
  bakery: ["bakery"],
  bar: ["bar"],
  "pizza restaurant": ["pizza_restaurant"],
  "mexican restaurant": ["mexican_restaurant"],
  "italian restaurant": ["italian_restaurant"],
  "chinese restaurant": ["chinese_restaurant"],
  "wedding venue": ["wedding_venue", "venue_and_event_space"],
  "event venue": ["venue_and_event_space"],
  photographer: ["photographer"],
  "wedding photographer": ["wedding_photographer", "photographer"],
  "florist": ["florist"],
  "funeral home": ["funeral_services_and_cemeteries", "funeral_home"],
  "solar energy company": ["solar_installation", "solar_energy_equipment_supplier"],
  "solar energy system service": ["solar_installation"],
  "window installation service": ["window_installation", "windows_installation"],
  "kitchen remodeler": ["kitchen_remodeling", "remodeling"],
  "bathroom remodeler": ["bathroom_remodeling", "remodeling"],
  "remodeler": ["remodeling"],
  "concrete contractor": ["concrete_contractor", "masonry_concrete"],
  "masonry contractor": ["masonry_contractor", "masonry_concrete"],
  "gutter cleaning service": ["gutter_service"],
  "water damage restoration service": ["water_damage_restoration", "damage_restoration"],
  "junk removal service": ["junk_removal_and_hauling"],
  "septic system service": ["septic_services"],
  "window cleaning service": ["window_washing"],
  "appliance repair service": ["appliance_repair_service"],
  "self-storage facility": ["self_storage", "storage_facility"],
  "hotel": ["hotel"],
  "motel": ["motel"],
  "church": ["christian_place_of_worship", "church_cathedral"],
  "school": ["school"],
  "preschool": ["preschool", "child_care_and_day_care"],
  "child care agency": ["child_care_and_day_care"],
  "day care center": ["child_care_and_day_care"],
  "tattoo shop": ["tattoo"],
  "car wash": ["car_wash"],
  "optometrist": ["optometrist"],
  "pharmacy": ["pharmacy"],
  "doctor": ["doctor"],
  "family practice physician": ["family_practice", "doctor"],
  "pediatrician": ["pediatrician"],
  "dermatologist": ["dermatologist"],
  "plastic surgeon": ["plastic_surgeon"],
  "marketing agency": ["marketing_agency", "advertising_agency"],
  "web designer": ["web_designer", "website_design"],
  "mortgage broker": ["mortgage_broker"],
  "mortgage lender": ["mortgage_lender"],
  "property management company": ["property_management"],
  "home inspector": ["home_inspector"],
  "interior designer": ["interior_design"],
  "cabinet maker": ["cabinetry", "cabinet_maker"],
  "countertop store": ["countertop_installation"],
  "tile contractor": ["tiling"],
  "drywall contractor": ["drywall"],
  "insulation contractor": ["insulation_installation"],
  "irrigation equipment supplier": ["irrigation"],
  "sprinkler contractor": ["irrigation"],
  // Names checked against the 2026-09 Overture list.
  dentist: ["dental_clinic", "general_dentistry"],
  "dental clinic": ["dental_clinic", "general_dentistry"],
  "cosmetic dentist": ["cosmetic_dentistry", "dental_clinic"],
  "pediatric dentist": ["pediatric_dentistry"],
  "emergency dental service": ["dental_clinic", "general_dentistry"],
  locksmith: ["key_and_locksmith"],
  "emergency locksmith service": ["key_and_locksmith"],
  "car dealer": ["auto_dealer", "used_auto_dealer"],
  "used car dealer": ["used_auto_dealer"],
  "moving company": ["mover"],
  "moving service": ["mover"],
  "moving and storage service": ["mover", "storage_facility"],
  "dry cleaner": ["dry_cleaning"],
  lawyer: ["attorney_or_law_firm"],
  attorney: ["attorney_or_law_firm"],
  "law firm": ["attorney_or_law_firm"],
  "personal injury attorney": ["personal_injury_law"],
  "divorce lawyer": ["divorce_and_family_law"],
  "family law attorney": ["divorce_and_family_law"],
  "criminal justice attorney": ["criminal_defense_law"],
  "bankruptcy attorney": ["bankruptcy_law"],
  "immigration attorney": ["immigration_law"],
  chiropractor: ["chiropractic"],
  "gym": ["gym"],
  "fitness center": ["gym", "sport_or_fitness_facility"],
  "personal trainer": ["fitness_trainer"],
  "house cleaning service": ["home_cleaning"],
  "cleaning service": ["cleaning_service", "home_cleaning"],
  "commercial cleaning service": ["office_cleaning", "cleaning_service"],
  "janitorial service": ["office_cleaning", "cleaning_service"],
  "pool cleaning service": ["pool_cleaning", "pool_and_hot_tub_service"],
  "swimming pool contractor": ["pool_and_hot_tub_service"],
  "fence contractor": ["fence_and_gate_sales_service"],
  "concrete contractor": ["masonry_concrete"],
  "masonry contractor": ["masonry_concrete"],
  "lawn care service": ["lawn_service", "landscaping"],
  "kitchen remodeler": ["kitchen_remodeling"],
  "bathroom remodeler": ["bathroom_remodeling"],
  remodeler: ["altering_and_remodeling_contractor", "kitchen_remodeling", "bathroom_remodeling"],
  "water damage restoration service": ["fire_and_water_damage_restoration"],
  "fire damage restoration service": ["fire_and_water_damage_restoration"],
  "septic system service": ["septic_service"],
  "self-storage facility": ["self_storage_facility"],
  "storage facility": ["storage_facility", "self_storage_facility"],
  optometrist: ["optometry"],
  doctor: ["doctors_office"],
  "family practice physician": ["doctors_office"],
  "medical clinic": ["doctors_office"],
  "tax preparation service": ["tax_service", "tax_office"],
  "tax preparation": ["tax_service"],
  "photographer": ["photography_service", "event_photography_service"],
  "wedding photographer": ["event_photography_service"],
  "church": ["christian_place_of_worship"],
  "auto repair shop": ["automotive_repair"],
  "auto body shop": ["auto_body_shop"],
  "car detailing service": ["auto_detailing"],
  "tire shop": ["tire_dealer_and_repair"],
  "insurance agency": ["insurance_agency"],
  "auto insurance agency": ["auto_insurance"],
  "life insurance agency": ["life_insurance"],
  "junk removal service": ["junk_removal_and_hauling"],
  "internet marketing service": ["internet_marketing_service", "marketing_agency"],
  "website designer": ["web_designer"],
  "web designer": ["web_designer"],
  "solar energy company": ["solar_installation"],
  "solar energy system service": ["solar_installation"],
  "preschool": ["preschool", "day_care_preschool"],
  "day care center": ["day_care_preschool", "child_care_and_day_care"],
  orthodontist: ["orthodontics"],
  dermatologist: ["dermatology"],
  "urgent care center": ["urgent_care_clinic", "emergency_or_urgent_care_facility"],
  pediatrician: ["pediatric_clinic"],
  "obstetrician-gynecologist": ["obstetrics_and_gynecology"],
  psychologist: ["psychology"],
  "estate planning attorney": ["estate_planning_law", "wills_trusts_and_probate"],
  "bookkeeping service": ["bookkeeper"],
  "event planner": ["party_and_event_planning"],};

const words = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ")
    .filter((w) => w && !["and", "service", "services", "shop", "store", "company", "contractor", "the", "of"].includes(w))
    .map((w) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
const snake = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const ovWords = overture.map((c) => ({ c, w: new Set(words(c.cat.replace(/_/g, " "))) }));
const map: Record<string, string[]> = {};
let bySynonym = 0, bySameName = 0, byOverlap = 0, none = 0;
const unmatched: string[] = [];

for (const ind of INDUSTRIES) {
  for (const google of ind.categories) {
    const key = google.toLowerCase();
    const syn = SYNONYMS[key]?.filter((c) => byName.has(c));
    if (syn?.length) { map[google] = syn; bySynonym++; continue; }
    const s = snake(google);
    const direct = [s, s.replace(/_service$/, ""), s.replace(/s$/, ""), s + "s"].filter((c) => byName.has(c));
    if (direct.length) { map[google] = [...new Set(direct)]; bySameName++; continue; }
    const gw = new Set(words(google));
    if (!gw.size) { none++; unmatched.push(google); continue; }
    // Every word of the Overture name must be in the Google name (and at least half the Google words used).
    const hits = ovWords
      .filter(({ w }) => w.size > 0 && [...w].every((x) => gw.has(x)) && w.size / gw.size >= 0.5)
      .sort((a, b) => b.w.size - a.w.size || b.c.n - a.c.n)
      .slice(0, 2)
      .map(({ c }) => c.cat);
    if (hits.length) { map[google] = hits; byOverlap++; } else { none++; unmatched.push(google); }
  }
}

writeFileSync("data/category-map.json", JSON.stringify(map));
console.log(`matched: ${bySynonym} by hand, ${bySameName} by name, ${byOverlap} by word overlap; not available in free data: ${none}`);
console.log("sample unmatched:", unmatched.slice(0, 25).join(" | "));
const check = ["Plumber", "Roofing contractor", "HVAC contractor", "Electrician", "Landscaper", "Dentist", "Spa", "Handyman/Handywoman/Handyperson", "Window installation service", "Air conditioning repair service", "Car dealer", "Hair salon"];
for (const c of check) console.log(`  ${c} -> ${JSON.stringify(map[c] ?? null)}`);
