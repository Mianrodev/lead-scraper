// Chains and franchises: an agency sells to independent local businesses, so these are
// flagged (leads.is_chain = 1) and can be hidden with the "Chains" filter.
// A business is a chain when its name starts with a well-known brand below, or (worked out
// in src/scoring.ts) its website is shared by businesses in 3 or more cities.

export const FRANCHISE_BRANDS: string[] = [
  // Home services
  "roto-rooter", "mr. rooter", "mr rooter", "benjamin franklin plumbing", "one hour heating", "one hour air",
  "aire serv", "mister sparky", "mr. electric", "mr electric", "service experts", "abc home services",
  "terminix", "orkin", "truly nolen", "aptive", "rentokil", "arrow exterminators", "massey services",
  "mr. handyman", "mr handyman", "ace handyman", "handyman connection", "two men and a truck", "college hunks",
  "1-800-got-junk", "1-800 got junk", "junk king", "junkluggers", "the junkluggers", "servpro", "servicemaster",
  "paul davis", "puroclean", "rainbow restoration", "belfor", "stanley steemer", "chem-dry", "chemdry", "zerorez",
  "molly maid", "merry maids", "maid pro", "maidpro", "two maids", "mosquito joe", "mosquito authority",
  "mosquito squad", "weed man", "lawn doctor", "trugreen", "the grounds guys", "window genie", "fish window cleaning",
  "budget blinds", "sears home services", "home depot", "lowe's", "lowes", "the home depot",
  "leaf filter", "leaffilter", "window world", "renewal by andersen", "five star painting",
  "certapro", "certa pro", "sherwin-williams", "sherwin williams", "precision garage door", 
  "a1 garage door", "pop-a-lock", "pop a lock", "mr. appliance", "mr appliance", "glass doctor", "dryer vent wizard",
  "culligan", "rainsoft", "kinetico", "ars rescue rooter", "rescue rooter", 
  "len the plumber", "rooter-man", "rooterman", "mr. drain", 
  "mighty dog roofing", "window nation", "bath fitter", "re-bath", "rebath", "kitchen tune-up", "floor coverings international",
  "empire today", "u-haul", "uhaul", "public storage", "extra space storage", "cubesmart", "life storage",
  "adt", "vivint", "brinks home", "frontpoint", "sunrun", "tesla energy", 
  
  // Retail, food and other big national brands that show up in local searches
  "walmart", "costco", "sam's club", "best buy", "cvs", "walgreens", "rite aid", "7-eleven", "7 eleven",
  "mcdonald's", "mcdonalds", "burger king", "wendy's", "starbucks", "dunkin", "subway", "taco bell", "chick-fil-a",
  "domino's", "dominos", "pizza hut", "papa john's", "kfc", "chipotle", "panera", "ace hardware", "true value",
  "autozone", "o'reilly auto", "advance auto parts", "napa auto parts", "jiffy lube", "valvoline", "midas", "meineke",
  "firestone", "goodyear", "pep boys", "discount tire", "safelite", "maaco", "caliber collision", "gerber collision",
  "enterprise rent", "hertz", "state farm", "allstate", "geico", "farmers insurance", 
  "h&r block", "jackson hewitt", "liberty tax", "edward jones", "re/max", "remax", "keller williams", "coldwell banker",
  "century 21", "sotheby's", "exp realty", "berkshire hathaway", "planet fitness", "anytime fitness",
  "orangetheory", "la fitness", "gold's gym", "crunch fitness", "snap fitness", "great clips", "supercuts", "sport clips",
  "fantastic sams", "european wax center", "massage envy", "hand & stone", "the joint chiropractic", "aspen dental",
  "western dental", "heartland dental", "pearle vision", "lenscrafters", "banfield", "vca animal", "petsmart", "petco",
  "ups store", "the ups store", "fedex", "usps", "kumon", "mathnasium", "sylvan learning", "huntington learning",
  "kindercare", "goddard school", "primrose school", "the learning experience", "la petite academy", "bright horizons",
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

const BRANDS = [...new Set(FRANCHISE_BRANDS.map(norm))].sort((a, b) => b.length - a.length);

/** True when the business name starts with (or is) a known chain / franchise brand. */
export function looksLikeChain(name: string): boolean {
  const n = norm(name).replace(/^the /, "");
  if (!n) return false;
  return BRANDS.some((b) => {
    const brand = b.replace(/^the /, "");
    if (!n.startsWith(brand)) return false;
    const next = n.charAt(brand.length);
    // Word boundary: "Orkin Pest Control" yes, "Orkinson's Roofing" no.
    return next === "" || !/[a-z0-9]/.test(next);
  });
}
